import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lifecycleError } from "../errors.js";
import { createIpcClient, type IpcClient } from "../daemon/ipc-client.js";
import { publishRelease, readCurrentRelease, verifyReleaseArtifact, type CurrentRelease } from "../daemon/release-store.js";
import { createRuntimeLayout, type RuntimeLayout } from "../daemon/runtime-layout.js";
import { createServiceManager, type ServiceManager } from "../service/service-manager.js";

export type ServerCommandAction = "start" | "stop" | "restart" | "status" | "logs" | "uninstall";
export interface RunServerCommandOptions { action: ServerCommandAction; }
export interface ServerCommandDependencies {
  layout?: RuntimeLayout;
  artifactDirectory?: string;
  publishRelease?: typeof publishRelease;
  verifyReleaseArtifact?: typeof verifyReleaseArtifact;
  createServiceManager?: () => ServiceManager;
  ipcClient?: () => IpcClient;
  health?: (listenUrl: string) => Promise<void>;
}

export async function runServerCommand(options: RunServerCommandOptions, dependencies: ServerCommandDependencies = {}): Promise<unknown> {
  const layout = dependencies.layout ?? createRuntimeLayout();
  const ipc = dependencies.ipcClient ?? (() => createIpcClient({ endpoint: layout.controlEndpoint }));
  const health = dependencies.health ?? verifyHealth;
  const service = dependencies.createServiceManager ?? (() => defaultServiceManager(layout));
  if (options.action === "start") {
    const artifactDirectory = dependencies.artifactDirectory ?? defaultArtifactDirectory();
    await (dependencies.verifyReleaseArtifact ?? verifyReleaseArtifact)(artifactDirectory);
    const release = await (dependencies.publishRelease ?? publishRelease)({ sourceDirectory: artifactDirectory, layout });
    const manager = service();
    await manager.install();
    try {
      const status = await readyStatus(ipc(), health);
      return { action: "start", release: publicRelease(release), status: status.data };
    } catch {
      // Service activation is needed only when IPC and health cannot already
      // prove an existing daemon. This avoids replacing a healthy older daemon.
    }
    await manager.start();
    const status = await waitForReady(ipc(), health);
    return { action: "start", release: publicRelease(release), status: status.data };
  }
  if (options.action === "status") {
    const status = await readyStatus(ipc(), health);
    return { action: "status", status: status.data };
  }
  if (options.action === "logs") return { action: "logs", logs: await service().logs() };
  if (options.action === "uninstall") {
    const stopped = await stopViaIpcOrService(ipc(), service());
    await service().uninstall();
    await removeTransientRuntimeFiles(layout);
    return { action: "uninstall", stopped };
  }
  if (options.action === "stop") return { action: "stop", stopped: await stopViaIpcOrService(ipc(), service()) };
  const response = await requestControl(ipc(), { type: "restart" }, service(), "restart");
  if (response.via === "ipc") await readyStatus(ipc(), health);
  return { action: "restart", ...response };
}

export async function runServerForeground(options: { dataDir?: string; host?: string; port?: number }, dependencies: {
  layout?: RuntimeLayout; artifactDirectory?: string;
} = {}): Promise<number> {
  const layout = dependencies.layout ?? createRuntimeLayout();
  const artifact = dependencies.artifactDirectory ?? defaultArtifactDirectory();
  const manifest = await verifyReleaseArtifact(artifact);
  if (typeof manifest.serverEntrypoint !== "string") throw lifecycleError("canonical_server_unavailable", "The packed canonical LocalApp Server runtime is unavailable");
  const entrypoint = path.join(artifact, ...manifest.serverEntrypoint.split("/"));
  const child = spawn(process.execPath, [entrypoint, "start", "--data-dir", options.dataDir ?? layout.dataDir,
    "--host", options.host ?? "127.0.0.1", "--port", String(options.port ?? 0)], { stdio: "inherit", shell: false, windowsHide: true });
  return await new Promise<number>((resolve, reject) => {
    const stop = (signal: NodeJS.Signals) => child.kill(signal);
    process.once("SIGINT", () => stop("SIGINT"));
    process.once("SIGTERM", () => stop("SIGTERM"));
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}

async function waitForReady(ipc: IpcClient, health: (listenUrl: string) => Promise<void>): Promise<Extract<Awaited<ReturnType<IpcClient["request"]>>, { ok: true; type: "status" }>> {
  const deadline = Date.now() + 15_000;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      const status = await readyStatus(ipc, health);
      return status;
    } catch (error) { last = error; await delay(100); }
  }
  throw last instanceof Error ? last : lifecycleError("daemon_unreachable", "The LocalApp daemon did not become ready");
}

async function readyStatus(ipc: IpcClient, health: (listenUrl: string) => Promise<void>) {
  let response;
  try { response = await ipc.request({ type: "status" }); }
  catch { throw lifecycleError("daemon_unreachable", "The LocalApp daemon is unreachable"); }
  if (!response.ok || response.type !== "status" || response.data.server.status !== "ready" || response.data.server.listenUrl === undefined) {
    throw lifecycleError("daemon_unhealthy", "The LocalApp daemon has not proven Server health");
  }
  await health(response.data.server.listenUrl);
  return response;
}

async function stopViaIpcOrService(ipc: IpcClient, service: ServiceManager): Promise<{ via: "ipc" | "service" }> {
  return requestControl(ipc, { type: "stop" }, service, "stop");
}

async function requestControl(
  ipc: IpcClient,
  request: { type: "stop" | "restart" },
  service: ServiceManager,
  action: "stop" | "restart",
): Promise<{ via: "ipc" | "service" }> {
  try {
    const response = await ipc.request(request);
    if (!response.ok || response.type !== action) throw lifecycleError("daemon_control_failed", "The LocalApp daemon rejected the control request");
    return { via: "ipc" };
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ipc_unreachable") throw error;
    if (action === "stop") await service.stop(); else await service.restart();
    return { via: "service" };
  }
}

async function verifyHealth(listenUrl: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  timer.unref?.();
  try {
    const response = await fetch(`${listenUrl}/health`, { redirect: "error", signal: controller.signal });
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok || value === null || typeof value !== "object" || (value as { status?: unknown }).status !== "ok") {
      throw lifecycleError("server_health_invalid", "The LocalApp Server health check failed");
    }
  } finally { clearTimeout(timer); }
}

function defaultServiceManager(layout: RuntimeLayout): ServiceManager {
  return createServiceManager({
    layout, nodePath: process.execPath, homeDir: process.env.HOME ?? process.env.USERPROFILE ?? process.cwd(),
    run: async ({ command, args }) => await new Promise((resolve) => {
      const child = spawn(command, args, { shell: false, windowsHide: true });
      let stdout = ""; let stderr = "";
      child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
      child.once("error", () => resolve({ code: 1, stdout, stderr }));
      child.once("exit", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    }),
  });
}

function defaultArtifactDirectory(): string {
  const fromEntry = process.argv[1] === undefined ? undefined : path.resolve(path.dirname(process.argv[1]), "..");
  if (fromEntry !== undefined) return fromEntry;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

function publicRelease(release: CurrentRelease) {
  return { version: release.version, artifactDigest: release.artifactDigest };
}

async function removeTransientRuntimeFiles(layout: RuntimeLayout): Promise<void> {
  for (const target of [layout.lockPath, layout.controlEndpoint]) {
    const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (stat === undefined) continue;
    if (target === layout.lockPath && (!stat.isFile() || stat.isSymbolicLink() || (process.platform !== "win32" && (stat.mode & 0o077) !== 0))) continue;
    if (target === layout.controlEndpoint && (!stat.isSocket() || stat.isSymbolicLink())) continue;
    await fs.unlink(target);
  }
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
