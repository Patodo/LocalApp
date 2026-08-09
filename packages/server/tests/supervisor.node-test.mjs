import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

async function availablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function nextReady(child, messages) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      child.off("ready", onMessage);
      child.off("exit", onExit);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for worker readiness"));
    }, 10_000);
    const onMessage = (message) => {
      if (message.type !== "ready") return;
      cleanup();
      resolve(message);
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Supervisor exited before worker readiness (code ${code})`));
    };
    child.on("ready", onMessage);
    child.once("exit", onExit);
    for (const message of messages.splice(0)) onMessage(message);
  });
}

function settleWithin(promise, milliseconds) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), milliseconds);
    promise.then(
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
      () => {
        clearTimeout(timeout);
        resolve(true);
      },
    );
  });
}

async function terminateProcessGroup(child) {
  if (child.exitCode !== null || !child.pid) return;
  const exited = once(child, "exit");
  const signalGroup = (signal) => {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };

  signalGroup("SIGTERM");
  if (await settleWithin(exited, 2_000)) return;
  signalGroup("SIGKILL");
  await settleWithin(exited, 2_000);
}

test("supervisor replaces the worker after a network rebind", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "localapp-supervisor-"));
  const initialPort = await availablePort();
  const replacementPort = await availablePort();
  const messages = [];
  const child = spawn(process.execPath, ["packages/server/dist/cli.js", "start", "--data-dir", dataDir, "--host", "127.0.0.1", "--port", String(initialPort)], {
    cwd: path.resolve(import.meta.dirname, "../../.."),
    env: { ...process.env, BOOTSTRAP_API_KEY: "supervisor-test-api-key" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const output = createInterface({ input: child.stdout });
  output.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (child.listenerCount("ready") > 0) child.emit("ready", message);
      else messages.push(message);
    } catch {
      // The supervisor may emit non-readiness diagnostics on stdout.
    }
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  try {
    const first = await nextReady(child, messages);
    assert.equal(first.url, `http://127.0.0.1:${initialPort}`);
    assert.ok(first.setupUrl);
    const setup = new URL(first.setupUrl);
    const initialized = await fetch(`${first.url}/api/setup/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: setup.searchParams.get("token"),
        username: "owner",
        password: "correct-horse-battery",
      }),
    });
    assert.equal(initialized.status, 201);
    const response = await fetch(`${first.url}/api/system/settings/network`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": "supervisor-test-api-key" },
      body: JSON.stringify({ listenHost: "127.0.0.1", listenPort: replacementPort, allowInsecureLan: false }),
    });
    assert.equal(response.status, 202);
    assert.equal(JSON.parse(await readFile(path.join(dataDir, "server.json"), "utf8")).listenPort, replacementPort);
    const second = await nextReady(child, messages);
    assert.equal(second.url, `http://127.0.0.1:${replacementPort}`, stderr.join(""));
    assert.equal((await fetch(`${second.url}/health`)).status, 200);
  } finally {
    output.close();
    await terminateProcessGroup(child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("supervisor test cleanup returns when the child has already exited", async () => {
  const child = Object.assign(new EventEmitter(), { exitCode: 1, pid: 12345 });
  await terminateProcessGroup(child);
  assert.equal(child.exitCode, 1);
});
