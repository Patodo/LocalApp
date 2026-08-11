import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

async function waitFor(condition, message, timeout = 3_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

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
    assert.equal(first.listenUrl, `http://127.0.0.1:${initialPort}`);
    assert.ok(Number.isInteger(first.workerPid));
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
    assert.equal(JSON.parse(await readFile(path.join(dataDir, "server.json"), "utf8")).listenPort, initialPort);
    const second = await nextReady(child, messages);
    assert.equal(second.url, `http://127.0.0.1:${replacementPort}`, stderr.join(""));
    assert.equal(second.listenUrl, `http://127.0.0.1:${replacementPort}`, stderr.join(""));
    assert.notEqual(second.workerPid, first.workerPid);
    assert.equal(JSON.parse(await readFile(path.join(dataDir, "server.json"), "utf8")).listenPort, replacementPort);
    assert.equal((await fetch(`${second.listenUrl}/health`)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(messages.filter((message) => message.type === "ready").length, 0, "supervisor emitted an unexpected additional worker readiness message");
  } finally {
    output.close();
    await terminateProcessGroup(child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("readiness separates a saved public URL from the actual listener after restart", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "localapp-supervisor-public-url-"));
  const initialPort = await availablePort();
  let firstChild;
  let firstOutput;
  let restarted;
  let restartedOutput;
  try {
    const firstMessages = [];
    firstChild = spawn(process.execPath, ["packages/server/dist/cli.js", "start", "--data-dir", dataDir, "--host", "127.0.0.1", "--port", String(initialPort)], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: { ...process.env, BOOTSTRAP_API_KEY: "supervisor-test-api-key" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    firstOutput = createInterface({ input: firstChild.stdout });
    firstOutput.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (firstChild.listenerCount("ready") > 0) firstChild.emit("ready", message);
        else firstMessages.push(message);
      } catch {}
    });
    const first = await nextReady(firstChild, firstMessages);
    const setup = new URL(first.setupUrl);
    assert.equal((await fetch(`${first.listenUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: setup.searchParams.get("token"), username: "owner", password: "correct-horse-battery" }),
    })).status, 201);
    firstOutput.close();
    await terminateProcessGroup(firstChild);

    const saved = JSON.parse(await readFile(path.join(dataDir, "server.json"), "utf8"));
    await writeFile(path.join(dataDir, "server.json"), JSON.stringify({ ...saved, publicUrl: "https://public.example" }));

    const restartedMessages = [];
    restarted = spawn(process.execPath, ["packages/server/dist/cli.js", "start", "--data-dir", dataDir, "--host", "127.0.0.1", "--port", "0"], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: { ...process.env, BOOTSTRAP_API_KEY: "supervisor-test-api-key" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    restartedOutput = createInterface({ input: restarted.stdout });
    restartedOutput.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (restarted.listenerCount("ready") > 0) restarted.emit("ready", message);
        else restartedMessages.push(message);
      } catch {}
    });
    const ready = await nextReady(restarted, restartedMessages);
    assert.equal(ready.url, "https://public.example");
    assert.match(ready.listenUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal((await fetch(`${ready.listenUrl}/health`)).status, 200);
  } finally {
    firstOutput?.close();
    restartedOutput?.close();
    if (firstChild) await terminateProcessGroup(firstChild);
    if (restarted) await terminateProcessGroup(restarted);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("supervisor recovers after hard death while a replacement worker is starting", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "localapp-supervisor-orphan-"));
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
    } catch {}
  });
  let recovery;
  let recoveryOutput;
  try {
    const first = await nextReady(child, messages);
    const setup = new URL(first.setupUrl);
    assert.equal((await fetch(`${first.url}/api/setup/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: setup.searchParams.get("token"), username: "owner", password: "correct-horse-battery" }),
    })).status, 201);
    assert.equal((await fetch(`${first.url}/api/system/settings/network`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": "supervisor-test-api-key" },
      body: JSON.stringify({ listenHost: "127.0.0.1", listenPort: replacementPort, allowInsecureLan: false }),
    })).status, 202);

    const starting = await waitFor(
      () => messages.find((message) => message.type === "starting" && message.workerPid !== first.workerPid),
      "Timed out waiting for the candidate worker to start",
    );
    process.kill(child.pid, "SIGKILL");
    await once(child, "exit");
    await waitFor(() => {
      try {
        process.kill(starting.workerPid, 0);
        return false;
      } catch (error) {
        return error?.code === "ESRCH";
      }
    }, "Candidate worker survived a hard supervisor death");

    const recoveryMessages = [];
    recovery = spawn(process.execPath, ["packages/server/dist/cli.js", "start", "--data-dir", dataDir], {
      cwd: path.resolve(import.meta.dirname, "../../.."),
      env: { ...process.env, BOOTSTRAP_API_KEY: "supervisor-test-api-key" },
      detached: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    recoveryOutput = createInterface({ input: recovery.stdout });
    recoveryOutput.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (recovery.listenerCount("ready") > 0) recovery.emit("ready", message);
        else recoveryMessages.push(message);
      } catch {}
    });
    const recovered = await nextReady(recovery, recoveryMessages);
    assert.equal(recovered.url, `http://127.0.0.1:${replacementPort}`);
    assert.notEqual(recovered.workerPid, first.workerPid);
    assert.notEqual(recovered.workerPid, starting.workerPid);
    assert.equal((await fetch(`${recovered.url}/health`)).status, 200);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(recoveryMessages.filter((message) => message.type === "ready").length, 0, "recovery supervisor replaced its worker unexpectedly");
  } finally {
    output.close();
    recoveryOutput?.close();
    await terminateProcessGroup(child);
    if (recovery) await terminateProcessGroup(recovery);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("supervisor supports a same-port host-only rebind", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "localapp-supervisor-same-port-"));
  const initialPort = await availablePort();
  const sharedPort = await availablePort();
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
    } catch {}
  });
  try {
    const first = await nextReady(child, messages);
    const setup = new URL(first.setupUrl);
    assert.equal((await fetch(`${first.url}/api/setup/initialize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: setup.searchParams.get("token"), username: "owner", password: "correct-horse-battery" }),
    })).status, 201);
    const wildcardRebind = await fetch(`${first.url}/api/system/settings/network`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": "supervisor-test-api-key" },
      body: JSON.stringify({ listenHost: "0.0.0.0", listenPort: sharedPort, allowInsecureLan: true }),
    });
    assert.equal(wildcardRebind.status, 202);
    const second = await nextReady(child, messages);
    assert.notEqual(second.workerPid, first.workerPid);
    const loopbackRebind = await fetch(`${second.url}/api/system/settings/network`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": "supervisor-test-api-key" },
      body: JSON.stringify({ listenHost: "127.0.0.1", listenPort: sharedPort, allowInsecureLan: false }),
    });
    assert.equal(loopbackRebind.status, 202, await loopbackRebind.text());
    const third = await nextReady(child, messages);
    assert.notEqual(third.workerPid, second.workerPid);
    assert.equal((await fetch(`http://127.0.0.1:${sharedPort}/health`)).status, 200);
  } finally {
    output.close();
    await terminateProcessGroup(child);
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("supervisor rolls back a pending candidate that fails to bind before readiness", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "localapp-supervisor-rollback-"));
  const oldPort = await availablePort();
  const blockedPort = await availablePort();
  const previous = { listenHost: "127.0.0.1", listenPort: oldPort, publicUrl: "", workspaceDir: path.join(dataDir, "workspaces"), allowInsecureLan: false };
  await writeFile(path.join(dataDir, "server.json"), `${JSON.stringify(previous)}\n`, { mode: 0o600 });
  await writeFile(path.join(dataDir, "server.pending.json"), `${JSON.stringify({ previous, candidate: { ...previous, listenPort: blockedPort } })}\n`, { mode: 0o600 });
  const blocker = createServer();
  blocker.listen(blockedPort, "127.0.0.1");
  await once(blocker, "listening");
  const messages = [];
  const child = spawn(process.execPath, ["packages/server/dist/cli.js", "start", "--data-dir", dataDir], {
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
    } catch {}
  });
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  try {
    const ready = await nextReady(child, messages);
    assert.equal(ready.url, `http://127.0.0.1:${oldPort}`);
    assert.equal((await fetch(`${ready.url}/health`)).status, 200);
    assert.deepEqual(JSON.parse(await readFile(path.join(dataDir, "server.json"), "utf8")), previous);
    await assert.rejects(access(path.join(dataDir, "server.pending.json")));
    assert.match(stderr.join(""), /candidate worker exited before readiness; rolling back/);
  } finally {
    output.close();
    await terminateProcessGroup(child);
    await new Promise((resolve, reject) => blocker.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("pre-setup CLI LAN options remain contained to loopback and the package main supervises setup", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "localapp-supervisor-setup-"));
  const port = await availablePort();
  const messages = [];
  const child = spawn(process.execPath, ["packages/server/dist/index.js", "--data-dir", dataDir, "--host", "0.0.0.0", "--port", String(port)], {
    cwd: path.resolve(import.meta.dirname, "../../.."),
    env: { ...process.env, BOOTSTRAP_API_KEY: "supervisor-test-api-key", PUBLIC_URL: "https://public.example" },
    detached: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  const output = createInterface({ input: child.stdout });
  output.on("line", (line) => {
    try {
      const message = JSON.parse(line);
      if (child.listenerCount("ready") > 0) child.emit("ready", message);
      else messages.push(message);
    } catch {}
  });

  try {
    const ready = await nextReady(child, messages);
    assert.equal(ready.url, `http://127.0.0.1:${port}`);
    assert.ok(ready.setupUrl?.startsWith(`http://127.0.0.1:${port}/setup?token=`));
    assert.equal(JSON.parse(await readFile(path.join(dataDir, "server.json"), "utf8")).listenHost, "127.0.0.1");
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
