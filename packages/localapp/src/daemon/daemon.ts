import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import { spawnOwnedProcess, type OwnedProcess } from "../process/process-tree.js";
import { waitForServerReady } from "../process/readiness.js";
import { parseControlResponseFrame, type DaemonControlResponse, type DaemonServerStatus } from "./control-protocol.js";
import { createIpcClient } from "./ipc-client.js";
import { createIpcServer, type IpcServer } from "./ipc-server.js";
import { readCurrentRelease, verifyReleaseArtifact } from "./release-store.js";
import type { RuntimeLayout } from "./runtime-layout.js";

export type DaemonPidProbe = (pid: number) => "present" | "absent" | "unknown";
export type DaemonEndpointProbe = (endpoint: string, bootId: string) => Promise<"same" | "unreachable" | "other" | "unknown">;

export interface DaemonLockOptions {
  layout: RuntimeLayout;
  bootId: string;
  pid?: number;
  probePid?: DaemonPidProbe;
  probeEndpoint?: DaemonEndpointProbe;
}

export interface DaemonLock {
  readonly reclaimed: boolean;
  release(): Promise<void>;
}

interface LockRecord {
  schemaVersion: 1;
  pid: number;
  bootId: string;
  endpoint: string;
  dataRootDigest: string;
  createdAt: string;
}
interface FileIdentity { dev: bigint; ino: bigint; }

export async function acquireDaemonLock(options: DaemonLockOptions): Promise<DaemonLock> {
  await ensurePrivateRuntimeDirectory(options.layout.runtimeDir);
  const pid = options.pid ?? process.pid;
  if (!Number.isSafeInteger(pid) || pid <= 1) throw lifecycleError("daemon_lock_invalid", "The LocalApp daemon process identity is invalid");
  const record: LockRecord = {
    schemaVersion: 1, pid, bootId: options.bootId, endpoint: options.layout.controlEndpoint,
    dataRootDigest: digestDataRoot(options.layout.dataDir), createdAt: new Date().toISOString(),
  };
  let reclaimed = false;
  while (true) {
    try {
      const handle = await fs.open(options.layout.lockPath, "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(record)}\n`);
        await handle.sync();
        const stat = await handle.stat({ bigint: true });
        if (!stat.isFile()) throw lifecycleError("daemon_lock_invalid", "The LocalApp daemon lock is not a regular file");
        const identity = { dev: stat.dev, ino: stat.ino };
        let released = false;
        return { reclaimed, async release() {
          if (released) return;
          released = true;
          await handle.close();
          await unlinkOwned(options.layout.lockPath, identity);
        } };
      } catch (error) {
        await handle.close().catch(() => undefined);
        await fs.unlink(options.layout.lockPath).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const existing = await readLock(options.layout.lockPath);
    if (existing.record.endpoint !== options.layout.controlEndpoint
      || existing.record.dataRootDigest !== digestDataRoot(options.layout.dataDir)) {
      throw lifecycleError("daemon_lock_invalid", "The LocalApp daemon lock belongs to a different runtime layout");
    }
    const pidState = (options.probePid ?? probePid)(existing.record.pid);
    const endpointState = await (options.probeEndpoint ?? probeEndpoint)(existing.record.endpoint, existing.record.bootId);
    if (pidState !== "absent" || endpointState !== "unreachable") {
      throw lifecycleError("daemon_lock_busy", "Another LocalApp daemon may own this data directory");
    }
    if (!await unlinkOwned(options.layout.lockPath, existing.identity)) {
      throw lifecycleError("daemon_lock_busy", "The LocalApp daemon lock changed during stale recovery");
    }
    reclaimed = true;
  }
}

export interface LocalAppDaemonOptions {
  layout: RuntimeLayout;
  bootId?: string;
  spawnOwnedProcess?: typeof spawnOwnedProcess;
  readinessTimeoutMs?: number;
  healthTimeoutMs?: number;
  verifyWindowsCurrentUser?: () => Promise<boolean> | boolean;
}

export class LocalAppDaemon {
  readonly bootId: string;
  private readonly options: LocalAppDaemonOptions;
  private lock: DaemonLock | undefined;
  private ipc: IpcServer | undefined;
  private server: OwnedProcess | undefined;
  private serverStatus: DaemonServerStatus = "stopped";
  private listenUrl: string | undefined;
  private deviceControlToken: string | undefined;
  private stopPromise: Promise<void> | undefined;
  private restartPromise: Promise<void> | undefined;
  private sealed = false;
  private unexpectedExit = false;
  private stoppedResolve!: () => void;
  private stoppedReject!: (error: unknown) => void;
  readonly stopped = new Promise<void>((resolve, reject) => { this.stoppedResolve = resolve; this.stoppedReject = reject; });

  constructor(options: LocalAppDaemonOptions) {
    this.options = options;
    this.bootId = options.bootId ?? crypto.randomBytes(24).toString("base64url");
    void this.stopped.catch(() => undefined);
  }

  async start(): Promise<void> {
    if (this.lock !== undefined) return;
    this.lock = await acquireDaemonLock({ layout: this.options.layout, bootId: this.bootId });
    try {
      await this.startServer();
      this.ipc = await createIpcServer({
        endpoint: this.options.layout.controlEndpoint,
        reclaimStaleEndpoint: async () => this.lock?.reclaimed === true,
        verifyWindowsCurrentUser: this.options.verifyWindowsCurrentUser,
        handle: async (request) => this.handle(request.type),
        afterResponse: async (request, response) => {
          if (request.type === "stop" && response.ok && response.type === "stop") await this.stop();
        },
      });
    } catch (error) {
      try { await this.cleanup(); } catch (cleanupError) { throw cleanupError; }
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise === undefined) {
      this.sealed = true;
      // Cleanup awaits unref'd process-tree deadlines. Keep the daemon alive until
      // it has released its lock and endpoint; awaiting a Promise alone does not.
      const hold = setInterval(() => undefined, 2 ** 30);
      this.stopPromise = (async () => { await this.restartPromise?.catch(() => undefined); await this.cleanup(); })().finally(() => clearInterval(hold));
    }
    return this.stopPromise;
  }

  async restart(): Promise<void> {
    this.restartPromise ??= (async () => {
      if (this.sealed) throw lifecycleError("daemon_stopping", "The LocalApp daemon is stopping");
      await this.stopServer();
      if (this.sealed) throw lifecycleError("daemon_stopping", "The LocalApp daemon is stopping");
      await this.startServer();
    })().finally(() => { this.restartPromise = undefined; });
    return this.restartPromise;
  }

  private async handle(type: "status" | "stop" | "restart"): Promise<DaemonControlResponse> {
    if (type === "status") return {
      ok: true, type: "status", data: {
        bootId: this.bootId, pid: process.pid, server: this.serverStatus === "ready" && this.listenUrl !== undefined
          ? { status: "ready", listenUrl: this.listenUrl } : { status: this.serverStatus },
      },
    };
    if (type === "restart") { await this.restart(); return { ok: true, type }; }
    return { ok: true, type };
  }

  private async startServer(): Promise<void> {
    this.serverStatus = "starting";
    this.listenUrl = undefined;
    this.deviceControlToken = crypto.randomBytes(32).toString("base64url");
    const current = await readCurrentRelease(this.options.layout);
    const manifest = await verifyReleaseArtifact(current.releasePath);
    if (typeof manifest.serverEntrypoint !== "string") throw lifecycleError("canonical_server_unavailable", "The packed canonical LocalApp Server runtime is unavailable");
    const entrypoint = path.join(current.releasePath, ...manifest.serverEntrypoint.split("/"));
    const spawn = this.options.spawnOwnedProcess ?? spawnOwnedProcess;
    const server = spawn(process.execPath, [entrypoint, "start", "--data-dir", this.options.layout.dataDir, "--host", "127.0.0.1", "--port", "0"], {
      cwd: current.releasePath,
      env: { ...process.env, LOCALAPP_DEVICE_CONTROL_TOKEN: this.deviceControlToken, LOCALAPP_DEV_TOOLS: undefined },
      stdio: ["ignore", "pipe", "inherit"],
    });
    this.server = server;
    try {
      const ready = await waitForServerReady(server, { timeoutMs: this.options.readinessTimeoutMs ?? 15_000 });
      await verifyHealth(ready.listenUrl, this.options.healthTimeoutMs ?? 5_000);
      this.listenUrl = ready.listenUrl;
      this.serverStatus = "ready";
      void server.exited.then(() => {
        if (this.server === server && this.stopPromise === undefined && this.serverStatus !== "stopping") {
          this.serverStatus = "error";
          this.unexpectedExit = true;
          void this.stop().catch(() => undefined);
        }
      }, () => undefined);
    } catch (error) {
      this.serverStatus = "error";
      // Keep the ownership reference until process-tree cleanup is proven.  A
      // failed terminate must reach the outer cleanup path, which then keeps
      // the daemon lock rather than allowing another daemon to reclaim it.
      await server.terminate();
      if (this.server === server) this.server = undefined;
      throw error;
    }
  }

  private async stopServer(): Promise<void> {
    const server = this.server;
    if (server === undefined) return;
    this.serverStatus = "stopping";
    await server.terminate();
    if (this.server === server) this.server = undefined;
    this.listenUrl = undefined;
    this.deviceControlToken = undefined;
    this.serverStatus = "stopped";
  }

  private async cleanup(): Promise<void> {
    this.serverStatus = "stopping";
    let failure: unknown;
    try { await this.ipc?.close(); } catch (error) { failure = error; }
    this.ipc = undefined;
    try { await this.stopServer(); } catch (error) { failure ??= error; }
    if (failure === undefined) {
      try { await this.lock?.release(); } catch (error) { failure = error; }
    }
    if (failure !== undefined) {
      this.serverStatus = "error";
      this.stoppedReject(failure);
      throw failure;
    }
    this.lock = undefined;
    this.serverStatus = "stopped";
    if (this.unexpectedExit) this.stoppedReject(lifecycleError("server_exited", "The LocalApp Server exited unexpectedly"));
    else this.stoppedResolve();
  }
}

async function verifyHealth(listenUrl: string, timeoutMs: number): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${listenUrl}/health`, { redirect: "error", signal: controller.signal });
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok || value === null || typeof value !== "object" || (value as { status?: unknown }).status !== "ok") {
      throw lifecycleError("server_health_invalid", "The LocalApp Server health check failed");
    }
  } catch (error) {
    if (error instanceof Error && "code" in error) throw error;
    throw lifecycleError("server_health_invalid", "The LocalApp Server health check failed");
  } finally { clearTimeout(timer); }
}

async function readLock(lockPath: string): Promise<{ record: LockRecord; identity: FileIdentity }> {
  const before = await fs.lstat(lockPath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || (Number(before.mode) & 0o077) !== 0) {
    throw lifecycleError("daemon_lock_invalid", "The LocalApp daemon lock is unsafe");
  }
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(lockPath, "utf8")); }
  catch { throw lifecycleError("daemon_lock_invalid", "The LocalApp daemon lock is malformed"); }
  const after = await fs.lstat(lockPath, { bigint: true });
  if (!after.isFile() || after.isSymbolicLink() || after.dev !== before.dev || after.ino !== before.ino) {
    throw lifecycleError("daemon_lock_invalid", "The LocalApp daemon lock changed while reading");
  }
  if (!isLockRecord(value)) throw lifecycleError("daemon_lock_invalid", "The LocalApp daemon lock is malformed");
  return { record: value, identity: { dev: before.dev, ino: before.ino } };
}

function isLockRecord(value: unknown): value is LockRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["bootId", "createdAt", "dataRootDigest", "endpoint", "pid", "schemaVersion"].sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
    && record.schemaVersion === 1 && Number.isSafeInteger(record.pid) && (record.pid as number) > 1
    && typeof record.bootId === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(record.bootId)
    && typeof record.endpoint === "string" && record.endpoint.length > 0 && record.endpoint.length <= 512
    && typeof record.dataRootDigest === "string" && /^[0-9a-f]{64}$/.test(record.dataRootDigest)
    && typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt));
}

function probePid(pid: number): "present" | "absent" | "unknown" {
  try { process.kill(pid, 0); return "present"; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH" ? "absent" : "unknown"; }
}

async function probeEndpoint(endpoint: string, bootId: string): Promise<"same" | "unreachable" | "other" | "unknown"> {
  try {
    const response = await createIpcClient({ endpoint, timeoutMs: 1_000 }).request({ type: "status" });
    return response.ok && response.type === "status" && response.data.bootId === bootId ? "same" : "other";
  } catch (error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ipc_unreachable" ? "unreachable" : "unknown";
  }
}

async function ensurePrivateRuntimeDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    throw lifecycleError("daemon_lock_invalid", "The LocalApp runtime directory is unsafe");
  }
}

async function unlinkOwned(filePath: string, identity: FileIdentity): Promise<boolean> {
  const current = await fs.lstat(filePath, { bigint: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (current === undefined || !current.isFile() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) return false;
  await fs.unlink(filePath);
  return true;
}

function digestDataRoot(dataDir: string): string { return crypto.createHash("sha256").update(path.resolve(dataDir)).digest("hex"); }
