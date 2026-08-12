import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { acquireDaemonLock, LocalAppDaemon } from "../src/daemon/daemon.js";
import { createIpcClient } from "../src/daemon/ipc-client.js";
import { publishRelease } from "../src/daemon/release-store.js";
import { createRuntimeLayout } from "../src/daemon/runtime-layout.js";
import { buildLocalAppPackage } from "../scripts/build-package.mjs";
import type { OwnedProcess } from "../src/process/process-tree.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-7b-cleanup-failure-tests");
const directories: string[] = [];
// Intentionally failed cleanup retains the lock's FileHandle. Keep the daemon
// strongly reachable for this test process so Node does not report a GC-close.
const retainedDaemons: LocalAppDaemon[] = [];

beforeAll(async () => { await fs.mkdir(testRoot, { recursive: true }); });
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("daemon cleanup failures", () => {
  it.skipIf(process.platform === "win32")("uses a distinct per-boot notification token and owns manager cleanup", async () => {
    const root = await fs.mkdtemp(path.join(testRoot, "n-"));
    directories.push(root);
    const artifact = path.join(root, "packed");
    await buildLocalAppPackage({ outputDirectory: artifact });
    const layout = createRuntimeLayout({ supportDir: path.join(root, "support"), runtimeDir: path.join(root, "run"), dataDir: path.join(root, "data") });
    await publishRelease({ sourceDirectory: artifact, layout });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })));
    let environment: NodeJS.ProcessEnv | undefined;
    const terminate = vi.fn(async () => undefined);
    const start = vi.fn();
    const stop = vi.fn(async () => undefined);
    let runtimeToken = "";
    const daemon = new LocalAppDaemon({
      layout,
      spawnOwnedProcess: (_command, _args, options) => { environment = options.env; return readyOwnedProcess(terminate, () => undefined); },
      createNotificationRuntime: async (options) => {
        runtimeToken = options.controlToken;
        return { manager: { start, stop, currentSource: () => undefined }, resolver: { resolve: vi.fn(async () => undefined) } };
      },
    });
    await daemon.start();
    expect(environment?.LOCALAPP_NOTIFICATION_CONTROL_TOKEN).toBe(runtimeToken);
    expect(runtimeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(runtimeToken).not.toBe(environment?.LOCALAPP_DEVICE_CONTROL_TOKEN);
    expect(start).toHaveBeenCalledTimes(1);
    await daemon.stop();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.platform === "win32")("retains the startup-owned Server and lock when readiness cleanup rejects", async () => {
    const root = await fs.mkdtemp(path.join(testRoot, "startup-"));
    directories.push(root);
    const artifact = path.join(root, "packed");
    await buildLocalAppPackage({ outputDirectory: artifact });
    const layout = createRuntimeLayout({ supportDir: path.join(root, "support"), runtimeDir: path.join(root, "run"), dataDir: path.join(root, "data") });
    await publishRelease({ sourceDirectory: artifact, layout });
    const failure = new Error("startup tree cleanup failed");
    const terminate = vi.fn(async () => { throw failure; });
    const daemon = new LocalAppDaemon({ layout, readinessTimeoutMs: 20, spawnOwnedProcess: () => silentOwnedProcess(terminate) });

    try {
      await expect(daemon.start()).rejects.toBe(failure);
      expect(terminate).toHaveBeenCalled();
      await expect(fs.lstat(layout.lockPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(acquireDaemonLock({ layout, bootId: "second_boot_0123456789" })).rejects.toMatchObject({ code: "daemon_lock_busy" });
    } finally { retainedDaemons.push(daemon); }
  });

  it.skipIf(process.platform === "win32")("reports unexpected post-ready Server exit only after owned cleanup", async () => {
    const root = await fs.mkdtemp(path.join(testRoot, "u-"));
    directories.push(root);
    const artifact = path.join(root, "packed");
    await buildLocalAppPackage({ outputDirectory: artifact });
    const layout = createRuntimeLayout({ supportDir: path.join(root, "support"), runtimeDir: path.join(root, "run"), dataDir: path.join(root, "data") });
    await publishRelease({ sourceDirectory: artifact, layout });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })));
    let exit!: () => void;
    const terminate = vi.fn(async () => undefined);
    const daemon = new LocalAppDaemon({ layout, spawnOwnedProcess: () => readyOwnedProcess(terminate, (resolve) => { exit = resolve; }) });
    await daemon.start();
    exit();
    await expect(daemon.stopped).rejects.toMatchObject({ code: "server_exited" });
    expect(terminate).toHaveBeenCalledTimes(1);
    await expect(fs.lstat(layout.lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.skipIf(process.platform === "win32")("seals a restart in teardown so concurrent stop cannot spawn another Server", async () => {
    const root = await fs.mkdtemp(path.join(testRoot, "r-"));
    directories.push(root);
    const artifact = path.join(root, "packed");
    await buildLocalAppPackage({ outputDirectory: artifact });
    const layout = createRuntimeLayout({ supportDir: path.join(root, "support"), runtimeDir: path.join(root, "run"), dataDir: path.join(root, "data") });
    await publishRelease({ sourceDirectory: artifact, layout });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })));
    let releaseTerminate!: () => void;
    const terminate = vi.fn(() => new Promise<void>((resolve) => { releaseTerminate = resolve; }));
    const spawn = vi.fn(() => readyOwnedProcess(terminate, () => undefined));
    const daemon = new LocalAppDaemon({ layout, spawnOwnedProcess: spawn });
    await daemon.start();
    const restarting = daemon.restart();
    while (terminate.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
    const stopping = daemon.stop();
    releaseTerminate();
    await expect(restarting).rejects.toMatchObject({ code: "daemon_stopping" });
    await expect(stopping).resolves.toBeUndefined();
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it.skipIf(process.platform === "win32")("keeps transient ownership and shares one terminal stop failure when Server cleanup rejects", async () => {
    const fixture = await startDaemonWithFailingServer();
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => { unhandled.push(error); };
    process.on("unhandledRejection", onUnhandled);
    try {
      const first = fixture.daemon.stop();
      const second = fixture.daemon.stop();

      await expect(first).rejects.toBe(fixture.failure);
      await expect(second).rejects.toBe(fixture.failure);
      expect(fixture.terminate).toHaveBeenCalledTimes(1);
      await expect(fs.lstat(fixture.layout.lockPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(createIpcClient({ endpoint: fixture.layout.controlEndpoint }).request({ type: "status" }))
        .rejects.toMatchObject({ code: "ipc_unreachable" });
      await Promise.resolve();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      retainedDaemons.push(fixture.daemon);
    }
  });

  it.skipIf(process.platform === "win32")("returns an IPC error rather than restart success when Server cleanup rejects", async () => {
    const fixture = await startDaemonWithFailingServer();
    try {
      await expect(createIpcClient({ endpoint: fixture.layout.controlEndpoint }).request({ type: "restart" }))
        .resolves.toMatchObject({ ok: false, code: "IPC_HANDLER_FAILED" });
      expect(fixture.terminate).toHaveBeenCalledTimes(1);
      await expect(fs.lstat(fixture.layout.lockPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
    } finally { retainedDaemons.push(fixture.daemon); }
  });
});

async function startDaemonWithFailingServer() {
  const root = await fs.mkdtemp(path.join(testRoot, "fixture-"));
  directories.push(root);
  const artifact = path.join(root, "packed");
  await buildLocalAppPackage({ outputDirectory: artifact });
  const layout = createRuntimeLayout({ supportDir: path.join(root, "support"), runtimeDir: path.join(root, "run"), dataDir: path.join(root, "data") });
  await publishRelease({ sourceDirectory: artifact, layout });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 })));
  const failure = new Error("owned Server cleanup failed");
  const terminate = vi.fn(async () => { throw failure; });
  const daemon = new LocalAppDaemon({ layout, spawnOwnedProcess: () => failingOwnedProcess(terminate) });
  await daemon.start();
  return { daemon, layout, terminate, failure };
}

function failingOwnedProcess(terminate: () => Promise<never>): OwnedProcess {
  const child = new EventEmitter() as EventEmitter & { stdout: Readable; pid: number };
  child.stdout = Readable.from(['{"type":"ready","listenUrl":"http://127.0.0.1:43127"}\n']);
  child.pid = 41_273;
  return { child: child as unknown as OwnedProcess["child"], pid: child.pid, exited: new Promise(() => undefined), terminate };
}

function silentOwnedProcess(terminate: () => Promise<never>): OwnedProcess {
  const child = new EventEmitter() as EventEmitter & { stdout: Readable; pid: number };
  child.stdout = new Readable({ read() {} });
  child.pid = 41_274;
  return { child: child as unknown as OwnedProcess["child"], pid: child.pid, exited: new Promise(() => undefined), terminate };
}

function readyOwnedProcess(terminate: () => Promise<void>, setExit: (resolve: () => void) => void): OwnedProcess {
  const child = new EventEmitter() as EventEmitter & { stdout: Readable; pid: number };
  child.stdout = Readable.from(['{"type":"ready","listenUrl":"http://127.0.0.1:43127"}\n']);
  child.pid = 41_275;
  const exited = new Promise<{ code: number }>((resolve) => setExit(() => resolve({ code: 1 })));
  return { child: child as unknown as OwnedProcess["child"], pid: child.pid, exited, terminate };
}
