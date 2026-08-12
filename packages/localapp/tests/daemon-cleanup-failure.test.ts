import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LocalAppDaemon } from "../src/daemon/daemon.js";
import { createIpcClient } from "../src/daemon/ipc-client.js";
import { publishRelease } from "../src/daemon/release-store.js";
import { createRuntimeLayout } from "../src/daemon/runtime-layout.js";
import { buildLocalAppPackage } from "../scripts/build-package.mjs";
import type { OwnedProcess } from "../src/process/process-tree.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-7b-cleanup-failure-tests");
const directories: string[] = [];

beforeAll(async () => { await fs.mkdir(testRoot, { recursive: true }); });
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("daemon cleanup failures", () => {
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
    }
  });

  it.skipIf(process.platform === "win32")("returns an IPC error rather than restart success when Server cleanup rejects", async () => {
    const fixture = await startDaemonWithFailingServer();
    await expect(createIpcClient({ endpoint: fixture.layout.controlEndpoint }).request({ type: "restart" }))
      .resolves.toMatchObject({ ok: false, code: "IPC_HANDLER_FAILED" });
    expect(fixture.terminate).toHaveBeenCalledTimes(1);
    await expect(fs.lstat(fixture.layout.lockPath)).resolves.toMatchObject({ isFile: expect.any(Function) });
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
