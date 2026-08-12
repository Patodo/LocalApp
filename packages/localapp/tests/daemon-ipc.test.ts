import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createIpcClient } from "../src/daemon/ipc-client.js";
import { createIpcServer } from "../src/daemon/ipc-server.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-7b-ipc-tests");
const directories: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

beforeAll(async () => { await fs.mkdir(testRoot, { recursive: true }); });
afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("private daemon IPC", () => {
  it.skipIf(process.platform === "win32")("dispatches one strict frame and immediately closes the Unix socket", async () => {
    const root = await fixtureRoot();
    const endpoint = path.join(root, "control.sock");
    let calls = 0;
    const server = await createIpcServer({ endpoint, async handle(request) {
      calls += 1;
      return request.type === "status"
        ? { ok: true, type: "status", data: { bootId: "boot_0123456789abcdef", pid: 42, server: { status: "stopped" } } }
        : { ok: true, type: request.type };
    } });
    servers.push(server);

    await expect(createIpcClient({ endpoint }).request({ type: "status" })).resolves.toMatchObject({ ok: true, type: "status" });
    await writeRaw(endpoint, '{"type":"status"}\n{"type":"stop"}\n');
    expect(calls).toBe(1);
  });

  it.skipIf(process.platform === "win32")("rejects a nonprivate Unix endpoint parent before listening", async () => {
    const root = await fixtureRoot();
    await fs.chmod(root, 0o755);
    await expect(createIpcServer({ endpoint: path.join(root, "control.sock"), async handle() {
      return { ok: true, type: "stop" };
    } })).rejects.toMatchObject({ code: "ipc_path_unsafe" });
  });

  it.skipIf(process.platform === "win32")("bounds a dispatched handler that never settles", async () => {
    const root = await fixtureRoot();
    const endpoint = path.join(root, "control.sock");
    const server = await createIpcServer({ endpoint, timeoutMs: 50, async handle() {
      return await new Promise<never>(() => undefined);
    } });
    servers.push(server);

    await expect(createIpcClient({ endpoint, timeoutMs: 500 }).request({ type: "status" }))
      .resolves.toMatchObject({ ok: false, code: "IPC_TIMEOUT" });
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(testRoot, "fixture-"));
  directories.push(root);
  if (process.platform !== "win32") await fs.chmod(root, 0o700);
  return root;
}

async function writeRaw(endpoint: string, data: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection(endpoint);
    socket.once("error", reject);
    socket.once("connect", () => { socket.resume(); socket.write(data); });
    socket.once("close", () => resolve());
  });
}
