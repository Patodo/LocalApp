import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lifecycleError } from "../errors.js";
import { createIpcClient, type IpcClient } from "../daemon/ipc-client.js";
import { publishRelease, readCurrentRelease, verifyReleaseArtifact, type CurrentRelease } from "../daemon/release-store.js";
import { createRuntimeLayout, type RuntimeLayout } from "../daemon/runtime-layout.js";
import { createCurrentUserServiceManager, type ServiceManager } from "../service/service-manager.js";
import { spawnOwnedProcess } from "../process/process-tree.js";
import { createNativeAdapter, type NativeAdapter, type NativeAdapterOptions } from "../native/native-adapter.js";

export type ServerCommandAction = "start" | "stop" | "restart" | "status" | "logs" | "uninstall";
export interface RunServerCommandOptions { action: ServerCommandAction; }
export interface ServerCommandDependencies {
  layout?: RuntimeLayout;
  artifactDirectory?: string;
  publishRelease?: typeof publishRelease;
  verifyReleaseArtifact?: typeof verifyReleaseArtifact;
  createServiceManager?: () => ServiceManager;
  createNativeAdapter?: (root: string, options?: NativeAdapterOptions) => Promise<Pick<NativeAdapter, "installScheme">>;
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
    const native = await (dependencies.createNativeAdapter ?? createNativeAdapter)(path.join(release.releasePath, "runtime", "native"), { supportDir: layout.supportDir });
    await native.installScheme();
    const manager = service();
    const installed = await manager.install();
    if (installed.mode === "foreground") return { action: "start", mode: "foreground", reason: installed.reason };
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
    await waitForStopped(layout, ipc());
    await service().uninstall();
    await removeTransientRuntimeFiles(layout);
    return { action: "uninstall", stopped };
  }
  if (options.action === "stop") {
    const stopped = await stopViaIpcOrService(ipc(), service());
    await waitForStopped(layout, ipc());
    return { action: "stop", stopped };
  }
  const response = await requestControl(ipc(), { type: "restart" }, service(), "restart");
  await waitForReady(ipc(), health);
  return { action: "restart", ...response };
}

export async function runServerForeground(options: { dataDir?: string; host?: string; port?: number }, dependencies: {
  layout?: RuntimeLayout; artifactDirectory?: string;
  spawnOwnedProcess?: typeof spawnOwnedProcess;
} = {}): Promise<number> {
  const layout = dependencies.layout ?? createRuntimeLayout();
  const artifact = dependencies.artifactDirectory ?? defaultArtifactDirectory();
  const manifest = await verifyReleaseArtifact(artifact);
  if (typeof manifest.serverEntrypoint !== "string") throw lifecycleError("canonical_server_unavailable", "The packed canonical LocalApp Server runtime is unavailable");
  const entrypoint = path.join(artifact, ...manifest.serverEntrypoint.split("/"));
  const child = (dependencies.spawnOwnedProcess ?? spawnOwnedProcess)(process.execPath, [entrypoint, "start", "--data-dir", options.dataDir ?? layout.dataDir,
    "--host", options.host ?? "127.0.0.1", "--port", String(options.port ?? 0)], { stdio: "inherit" });
  return await new Promise<number>((resolve, reject) => {
    let termination: Promise<void> | undefined;
    let settled = false;
    const finish = (error?: unknown, code = 0) => {
      if (settled) return;
      settled = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      error === undefined ? resolve(code) : reject(error);
    };
    const stop = () => {
      termination ??= child.terminate();
      void termination.then(() => finish(undefined, 0), (error) => finish(error));
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.exited.then(async (exit) => {
      // A process exit only proves the supervisor exited. Always wait for the
      // owned-tree terminator, which reaps its process group/descendants.
      try {
        await (termination ??= child.terminate());
        finish(exit.error, exit.error === undefined ? (exit.code ?? 1) : 1);
      } catch (error) { finish(error); }
    }, finish);
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
  catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ipc_unreachable") throw lifecycleError("daemon_unreachable", "The LocalApp daemon is unreachable");
    throw error;
  }
  if (!response.ok || response.type !== "status" || response.data.server.status !== "ready" || response.data.server.listenUrl === undefined) {
    throw lifecycleError("daemon_unhealthy", "The LocalApp daemon has not proven Server health");
  }
  await health(response.data.server.listenUrl);
  return response;
}

async function waitForStopped(layout: RuntimeLayout, ipc: IpcClient): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const lockMissing = await fs.lstat(layout.lockPath).then(() => false, (error: NodeJS.ErrnoException) => error.code === "ENOENT");
    try { await ipc.request({ type: "status" }); } catch (error) {
      if (lockMissing && typeof error === "object" && error !== null && "code" in error && error.code === "ipc_unreachable") return;
      if (typeof error === "object" && error !== null && "code" in error && error.code !== "ipc_unreachable") throw error;
    }
    await delay(100);
  }
  throw lifecycleError("daemon_stop_incomplete", "The LocalApp daemon did not release ownership after stop");
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
  return createCurrentUserServiceManager(layout);
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
  // A stopped daemon removes only the lock/socket inode it owns. Uninstall has
  // no boot identity for a concurrent replacement, so it deliberately leaves
  // any remaining transient node in place rather than unlinking unproven state.
  await Promise.all([layout.lockPath, layout.controlEndpoint].map(async (target) => {
    const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (stat !== undefined) throw lifecycleError("daemon_ownership_unproven", "LocalApp refuses to remove an unproven daemon ownership artifact");
  }));
}

function delay(ms: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, ms)); }
