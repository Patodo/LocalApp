import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildLocalAppPackage } from "../../localapp/scripts/build-package.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(repoRoot, "tmp/localapp-dev-package-e2e");
const productDirectory = path.join(testRoot, "product");
const packDirectory = path.join(testRoot, "pack");
const consumerDirectory = path.join(testRoot, "consumer");
const workspace = path.join(testRoot, "workspace");
const appName = "canonical-dev-e2e";
const appDirectory = path.join(workspace, appName);

test("npm-installed sole TypeScript localapp runs its embedded canonical Server and cleans every dev descendant", { timeout: 420_000 }, async (t) => {
  // Break caught: a package that resolves workspace Server/Rust code, leaks credentials, or kills only leaders cannot pass from an isolated npm install.
  await fs.rm(testRoot, { recursive: true, force: true });
  await Promise.all([
    fs.mkdir(packDirectory, { recursive: true }),
    fs.mkdir(consumerDirectory, { recursive: true }),
    fs.mkdir(workspace, { recursive: true }),
  ]);
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));

  const product = await buildLocalAppPackage({ outputDirectory: productDirectory });
  const serverManifest = JSON.parse(await fs.readFile(path.join(product.outputDirectory, "runtime/server/.localapp-server-artifact.json"), "utf8"));
  for (const required of [
    "bin/localapp-server.mjs",
    "bin/server-cli.cjs",
    "bin/worker.cjs",
    "runner/localapp-runner.mjs",
    "web/index.html",
    "node_modules/sql.js/dist/sql-wasm.js",
    "node_modules/sql.js/dist/sql-wasm.wasm",
  ]) {
    assert.equal(typeof serverManifest.files[required], "string", `embedded canonical Server missing ${required}`);
  }

  const packed = await run("npm", ["pack", product.outputDirectory, "--pack-destination", packDirectory], repoRoot, process.env, 120_000);
  assert.equal(packed.code, 0, packed.stderr);
  const tarballName = (await fs.readdir(packDirectory)).find((name) => name.endsWith(".tgz"));
  assert.ok(tarballName, "npm pack did not create a tarball");
  const tarball = path.join(packDirectory, tarballName);
  await fs.writeFile(path.join(consumerDirectory, "package.json"), '{"name":"isolated-localapp-consumer","private":true}\n');
  const installed = await run("npm", ["install", "--ignore-scripts", tarball], consumerDirectory, process.env, 120_000);
  assert.equal(installed.code, 0, installed.stderr);
  const cli = path.join(consumerDirectory, "node_modules/localapp/bin/localapp.mjs");
  const installedManifest = JSON.parse(await fs.readFile(path.join(consumerDirectory, "node_modules/localapp/package.json"), "utf8"));
  assert.equal(JSON.stringify(installedManifest).includes("workspace:"), false);
  assert.deepEqual(installedManifest.dependencies ?? {}, {});

  const environment = {
    ...process.env,
    PATH: `${path.join(consumerDirectory, "node_modules/.bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    LOCALAPP_CONFIG_DIR: path.join(appDirectory, "tmp/localapp-dev/config"),
    CI: "1",
  };
  const init = await execFileAsync(
    process.execPath,
    [cli, "init", appName, "--skip-install", "--skip-deploy"],
    { cwd: workspace, env: environment, timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.match(init.stdout, new RegExp(`"created":"${appName}"`));
  const appInstall = await run("npm", ["install", "--ignore-scripts"], appDirectory, environment, 300_000);
  assert.equal(appInstall.code, 0, appInstall.stderr);
  const appTests = await run("npm", ["test"], appDirectory, environment, 60_000);
  assert.equal(appTests.code, 0, `${appTests.stdout}\n${appTests.stderr}`);

  let child;
  let output = "";
  let observedDescendants = [];
  try {
    child = spawn(process.execPath, [cli, "dev"], {
      cwd: appDirectory,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });

    const appUrl = await waitForCondition(
      () => output.match(/App URL:\s+(http:\/\/127\.0\.0\.1:\d+\/)/)?.[1],
      "Vite app URL",
      180_000,
      () => output,
      child,
    );
    const serverUrl = await waitForCondition(
      () => output.match(/Local Server:\s+(http:\/\/127\.0\.0\.1:\d+)/)?.[1],
      "canonical Server URL",
      180_000,
      () => output,
      child,
    );
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

    const title = "created through packed TypeScript localapp dev";
    const create = await postJson(
      new URL("api/mutations/$work_items.create", appUrl),
      { params: { title, status: "todo" } },
      { cookie, origin },
    );
    assert.equal(create.response.status, 200, create.text);
    const snapshot = await postJson(new URL("api/dev/data/snapshots", appUrl), {}, { cookie, origin });
    assert.equal(snapshot.response.status, 201, snapshot.text);
    const reset = await postJson(new URL("api/dev/data/reset", appUrl), {}, { cookie, origin });
    assert.equal(reset.response.status, 200, reset.text);
    const restore = await postJson(
      new URL(`api/dev/data/snapshots/${encodeURIComponent(snapshot.body.data.id)}/restore`, appUrl),
      {},
      { cookie, origin },
    );
    assert.equal(restore.response.status, 200, restore.text);

    const stateRoot = path.join(appDirectory, "tmp/localapp-dev");
    assert.equal((await fs.stat(path.join(stateRoot, "server"))).isDirectory(), true);
    assert.equal((await fs.readdir(path.join(stateRoot, "packages"))).some((name) => name.endsWith(".localapp")), true);
    const apiKey = (await fs.readFile(path.join(stateRoot, "server-api-key"), "utf8")).trim();
    const password = (await fs.readFile(path.join(stateRoot, "server-password"), "utf8")).trim();
    const jwtSecret = (await fs.readFile(path.join(stateRoot, "server-jwt-secret"), "utf8")).trim();
    const devConfig = JSON.parse(await fs.readFile(path.join(appDirectory, ".localapp/dev-config.json"), "utf8"));
    assert.deepEqual(Object.keys(devConfig).sort(), ["appServerPort", "pageName", "serverUrl", "userId"]);
    assert.equal(JSON.stringify(devConfig).includes(apiKey), false);
    assert.equal(output.includes(apiKey) || output.includes(password) || output.includes(jwtSecret), false, output);
    if (process.platform !== "win32") {
      for (const credential of ["server-api-key", "server-password", "server-jwt-secret"]) {
        assert.equal((await fs.stat(path.join(stateRoot, credential))).mode & 0o777, 0o600);
      }
      assert.ok(observedDescendants.length >= 2, `expected Server and Vite descendants; got ${observedDescendants.join(", ")}\n${output}`);
    }

    t.diagnostic(JSON.stringify({ supervisorPid: child.pid, observedDescendants, appUrl, serverUrl, stateRoot }));
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
    if (process.platform !== "win32") await terminateProcesses(observedDescendants);
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await waitForExit(child, 5_000).catch(() => undefined);
    }
  }
});

async function getJson(url, cookie) {
  const response = await fetch(url, { headers: cookie ? { Cookie: cookie } : undefined });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

async function postJson(url, body, { cookie, origin }) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", Cookie: cookie, Origin: origin },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}

async function waitForCondition(read, label, timeoutMs, diagnostics, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    if (child && (child.exitCode !== null || child.signalCode !== null)) throw new Error(`localapp dev exited before ${label}\n${diagnostics()}`);
    await delay(50);
  }
  throw new Error(`timed out waiting for ${label}\n${diagnostics()}`);
}

async function waitForHttp(url, timeoutMs) {
  return waitForCondition(async () => {
    try {
      const response = await fetch(url, { redirect: "manual" });
      return response.status < 500 ? response : false;
    } catch {
      return false;
    }
  }, `HTTP ${url}`, timeoutMs, () => "", undefined);
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(timeoutMs).then(() => { throw new Error(`process ${child.pid} did not exit`); }),
  ]);
}

async function waitUntilUnreachable(url, timeoutMs) {
  return waitForCondition(async () => {
    try { await fetch(url); return false; } catch { return true; }
  }, `${url} to stop`, timeoutMs, () => "", undefined);
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
  try {
    return await waitForCondition(() => {
      try { process.kill(pid, 0); return false; }
      catch (error) { return error?.code === "ESRCH"; }
    }, `process ${pid} exit`, timeoutMs, () => "", undefined);
  } catch {
    return false;
  }
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

function run(command, args, cwd, env, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${command} timed out`)); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
