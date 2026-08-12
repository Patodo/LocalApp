import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createIpcClient } from "../src/daemon/ipc-client.js";
import { publishRelease } from "../src/daemon/release-store.js";
import { createRuntimeLayout } from "../src/daemon/runtime-layout.js";
import { buildLocalAppPackage } from "../scripts/build-package.mjs";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-7b-daemon-integration");
const directories: string[] = [];
const children: ChildProcess[] = [];

beforeAll(async () => { await fs.mkdir(testRoot, { recursive: true }); });
afterEach(async () => {
  for (const child of children.splice(0)) child.kill("SIGTERM");
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("packed daemon integration", () => {
  it.skipIf(process.platform === "win32")("runs the packed internal daemon through IPC, health, restart, and stop without a user service", async () => {
    const root = await fs.mkdtemp(path.join(testRoot, "fixture-"));
    directories.push(root);
    const artifact = path.join(root, "packed");
    await buildLocalAppPackage({ outputDirectory: artifact });
    const layout = createRuntimeLayout({ supportDir: path.join(root, "support"), runtimeDir: path.join(root, "run"), dataDir: path.join(root, "data") });
    await publishRelease({ sourceDirectory: artifact, layout });
    const daemon = spawn(process.execPath, [path.join(artifact, "bin/localapp.mjs"), "_daemon"], {
      env: { ...process.env, LOCALAPP_SUPPORT_DIR: layout.supportDir, LOCALAPP_RUNTIME_DIR: layout.runtimeDir, LOCALAPP_DATA_DIR: layout.dataDir },
      stdio: "ignore",
    });
    children.push(daemon);
    const client = createIpcClient({ endpoint: layout.controlEndpoint, timeoutMs: 10_000 });
    const first = await waitForStatus(client);
    expect(first.data.server.listenUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    await expect(fetch(`${first.data.server.listenUrl}/health`)).resolves.toMatchObject({ status: 200 });
    await expect(client.request({ type: "restart" })).resolves.toEqual({ ok: true, type: "restart" });
    const second = await waitForStatus(client);
    expect(second.data.bootId).toBe(first.data.bootId);
    await expect(fetch(`${second.data.server.listenUrl}/health`)).resolves.toMatchObject({ status: 200 });
    await expect(client.request({ type: "stop" })).resolves.toEqual({ ok: true, type: "stop" });
    await waitForExit(daemon);
    await expect(fs.lstat(layout.lockPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.lstat(layout.controlEndpoint)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(layout.dataDir)).resolves.toMatchObject({ isDirectory: expect.any(Function) });
  }, 90_000);
});

async function waitForStatus(client: ReturnType<typeof createIpcClient>) {
  let last: unknown;
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      const value = await client.request({ type: "status" });
      if (value.ok && value.type === "status" && value.data.server.status === "ready") return value;
    } catch (error) { last = error; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw last ?? new Error("daemon did not become ready");
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("daemon did not exit")), 10_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}
