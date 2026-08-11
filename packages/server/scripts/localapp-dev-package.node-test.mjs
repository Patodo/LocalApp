import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { buildServerPackage } from "./build-server-package.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(repoRoot, "tmp", "localapp-dev-package-e2e");
const workspace = path.join(testRoot, "workspace");
const appName = "canonical-dev-e2e";
const appDirectory = path.join(workspace, appName);
const cli = path.join(
  repoRoot,
  "packages",
  "cli",
  "target",
  "debug",
  process.platform === "win32" ? "localapp.exe" : "localapp",
);

test("published Server artifact runs a fresh builtin app through the real localapp dev lifecycle", { timeout: 240_000 }, async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  const artifact = await buildServerPackage({ outputDirectory: path.join(testRoot, "server-artifact") });
  const cliStat = await fs.stat(cli).catch(() => null);
  assert.equal(cliStat?.isFile(), true, `CLI must be built before this test: ${cli}`);

  const environment = {
    ...process.env,
    PATH: `${path.dirname(cli)}${path.delimiter}${process.env.PATH ?? ""}`,
    LOCALAPP_CONFIG_DIR: path.join(testRoot, "config"),
    LOCALAPP_SERVER_BIN: artifact.bin,
    LOCALAPP_NODE_BIN: process.execPath,
    CI: "1",
  };
  const init = await execFileAsync(
    cli,
    ["init", "--name", appName, "--skip-deploy", "--builtin-repo"],
    { cwd: workspace, env: environment, timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.match(init.stdout, new RegExp(`"created":"${appName}"`));

  let child;
  let output = "";
  let observedDescendants = [];
  try {
    child = spawn(cli, ["dev"], {
      cwd: appDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    const appUrl = await waitForOutput(child, () => output.match(/App URL:\s+(http:\/\/localhost:\d+\/)/)?.[1], 120_000, () => output);
    const serverUrl = await waitForOutput(child, () => output.match(/Local Server:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1], 120_000, () => output);
    const index = await waitForHttp(appUrl, 60_000);
    assert.equal(index.status, 200);
    const cookie = index.headers.get("set-cookie")?.split(";", 1)[0];
    assert.match(cookie ?? "", /^localapp_dev_csrf=/);
    const origin = new URL(appUrl).origin;
    observedDescendants = process.platform === "win32" ? [] : await descendantPids(child.pid);

    const me = await getJson(new URL("api/me", appUrl), cookie);
    assert.equal(me.response.status, 200, me.text);
    assert.equal(me.body.success, true);

    const context = await getJson(new URL("api/dev/context", appUrl), cookie);
    assert.equal(context.response.status, 200, context.text);
    assert.equal(context.body.data?.pageName, appName);
    assert.equal(context.body.data?.pageOwnerId, "dev-user");

    const issues = await getJson(new URL(`api/issues?pagePath=${encodeURIComponent(`dev-user/${appName}`)}`, appUrl), cookie);
    assert.equal(issues.response.status, 200, issues.text);
    const platformUsers = await getJson(new URL("api/platform/users", appUrl), cookie);
    assert.equal(platformUsers.response.status, 200, platformUsers.text);

    const title = "created through real localapp dev";
    const create = await postJson(
      new URL("api/mutations/$work_items.create", appUrl),
      { params: { title, status: "todo" } },
      { cookie, origin },
    );
    assert.equal(create.response.status, 200, create.text);
    assert.equal(create.body.success, true);

    const snapshot = await postJson(new URL("api/dev/data/snapshots", appUrl), {}, { cookie, origin });
    assert.equal(snapshot.response.status, 201, snapshot.text);
    const snapshotId = snapshot.body.data?.id;
    assert.equal(typeof snapshotId, "string");

    const reset = await postJson(new URL("api/dev/data/reset", appUrl), {}, { cookie, origin });
    assert.equal(reset.response.status, 200, reset.text);
    const empty = await listWorkItems(appUrl, cookie, origin);
    assert.equal(empty.some((row) => row.title === title), false);

    const restore = await postJson(
      new URL(`api/dev/data/snapshots/${encodeURIComponent(snapshotId)}/restore`, appUrl),
      {},
      { cookie, origin },
    );
    assert.equal(restore.response.status, 200, restore.text);
    const restored = await listWorkItems(appUrl, cookie, origin);
    assert.equal(restored.some((row) => row.title === title), true);

    assert.ok(process.platform === "win32" || observedDescendants.length >= 2, `expected Server and Vite descendants; got ${observedDescendants.join(", ")}\n${output}`);

    child.kill("SIGINT");
    await waitForExit(child, 15_000);
    await waitUntilUnreachable(appUrl, 10_000);
    await waitUntilUnreachable(serverUrl, 10_000);
    for (const pid of observedDescendants) {
      assert.equal(await waitUntilProcessGone(pid, 10_000), true, `child process ${pid} survived localapp dev shutdown`);
    }
    assert.equal(child.exitCode === 0 || child.signalCode === "SIGINT", true, output);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGINT");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
    if (process.platform !== "win32") {
      await terminateProcesses(observedDescendants);
    }
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

async function listWorkItems(appUrl, cookie, origin) {
  const result = await postJson(
    new URL("api/queries/$work_items.list", appUrl),
    { params: { limit: 50, offset: 0 } },
    { cookie, origin },
  );
  assert.equal(result.response.status, 200, result.text);
  return result.body.data?.rows ?? [];
}

async function getJson(url, cookie) {
  const response = await fetch(url, { headers: cookie ? { Cookie: cookie } : undefined });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

async function postJson(url, body, { cookie, origin }) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Cookie: cookie,
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

async function waitForOutput(child, read, timeoutMs, diagnostics) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`localapp dev exited before readiness\n${diagnostics()}`);
    }
    await delay(50);
  }
  throw new Error(`timed out waiting for localapp dev output\n${diagnostics()}`);
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return response;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${url}: ${lastError}`);
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs).then(() => { throw new Error(`process ${child.pid} did not exit`); }),
  ]);
}

async function waitUntilUnreachable(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await delay(100);
  }
  throw new Error(`${url} remained reachable after localapp dev exited`);
}

async function descendantPids(rootPid) {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,ppid="]);
  const children = new Map();
  for (const line of stdout.split("\n")) {
    const [pidText, parentText] = line.trim().split(/\s+/);
    const pid = Number(pidText);
    const parent = Number(parentText);
    if (!Number.isInteger(pid) || !Number.isInteger(parent)) continue;
    const entries = children.get(parent) ?? [];
    entries.push(pid);
    children.set(parent, entries);
  }
  const result = [];
  const pending = [...(children.get(rootPid) ?? [])];
  while (pending.length > 0) {
    const pid = pending.shift();
    result.push(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return result;
}

async function waitUntilProcessGone(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await delay(50);
  }
  return false;
}

async function terminateProcesses(pids) {
  for (const signal of ["SIGTERM", "SIGKILL"]) {
    for (const pid of [...pids].reverse()) {
      try { process.kill(pid, signal); }
      catch (error) { if (error?.code !== "ESRCH") throw error; }
    }
    if (signal === "SIGTERM") await delay(250);
  }
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
