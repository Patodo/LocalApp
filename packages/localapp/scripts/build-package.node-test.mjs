import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLocalAppPackage } from "./build-package.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(projectDirectory, "tmp/task-1-package-test");
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

test("CLI bundle resolves both Server contracts from source without prebuilt dist", async () => {
  const source = await fs.readFile(path.join(packageDirectory, "scripts/build-package.mjs"), "utf8");
  assert.match(source, /"@localapp\/server\/app-package-api": path\.join\(projectDirectory, "packages\/server\/src\/app-package-api\.ts"\)/);
  assert.match(source, /"@localapp\/server\/device-action-ticket": path\.join\(projectDirectory, "packages\/server\/src\/device-action-ticket\.ts"\)/);
});

test("Windows sync command builder uses explicit cmd.exe invocation for a spaced special-character path", () => {
  const { buildSyncInvocation } = require("../src/template/sync-template-command.cjs");
  const executable = "C:\\Program Files\\Local & App!^(test)\\localapp.cmd";

  assert.deepEqual(buildSyncInvocation(executable, "win32", "C:\\Windows\\System32\\cmd.exe"), {
    command: "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/v:off", "/c", '""C:\\Program Files\\Local & App!^(test)\\localapp.cmd" sync-template --quiet"'],
    spawnOptions: { shell: false, windowsHide: true, windowsVerbatimArguments: true },
  });
  assert.throws(
    () => buildSyncInvocation("C:\\unsafe%PATH%\\localapp.cmd", "win32", "cmd.exe"),
    /unsafe Windows command path/,
  );
});

test("packed product exposes one localapp binary without workspace references", async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));

  const outputDirectory = path.join(testRoot, "artifact with spaces");
  const result = await buildLocalAppPackage({ outputDirectory });
  const manifest = JSON.parse(await fs.readFile(path.join(result.outputDirectory, "package.json"), "utf8"));
  const artifact = JSON.parse(await fs.readFile(path.join(result.outputDirectory, ".localapp-artifact.json"), "utf8"));

  assert.equal(manifest.name, "@patodo/localapp");
  assert.deepEqual(manifest.bin, { localapp: "bin/localapp.mjs" });
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal(await run(result.outputDirectory, ["--version"]), "localapp 0.2.4");
  assert.match(await run(result.outputDirectory, ["-h"]), /Commands:\n[\s\S]*server \[start\][\s\S]*app install/);
  assert.match(await run(result.outputDirectory, ["server", "run", "--help"]), /--data-dir <path>[\s\S]*--host <address>[\s\S]*--port <number>/);
  assert.match(await run(result.outputDirectory, ["help", "app", "sync"]), /--peer <name>[\s\S]*--with-data[\s\S]*--confirm-app <name>/);
  assert.equal(await fs.stat(path.join(result.outputDirectory, "template/runtime/server-core/dist/index.js")).then(() => true, () => false), true);
  assert.equal(artifact.schemaVersion, 2);
  assert.equal(artifact.name, "@patodo/localapp");
  assert.equal(artifact.bootstrapEntrypoint, "runtime/bootstrap/localapp-daemon-bootstrap.mjs");
  assert.equal(artifact.files.some((entry) => entry.path === artifact.entrypoint), true);
  assert.equal(artifact.files.some((entry) => entry.path === artifact.bootstrapEntrypoint), true);
  const daemonBootstrap = await fs.readFile(path.join(result.outputDirectory, artifact.bootstrapEntrypoint), "utf8");
  assert.match(daemonBootstrap, /windows-user-task\.json/);
  assert.match(daemonBootstrap, /LOCALAPP_RUNTIME_DIR/);
  assert.match(daemonBootstrap, /Object\.assign\(process\.env, service\.environment\)/);
  const nativeManifest = JSON.parse(await fs.readFile(path.join(result.outputDirectory, "runtime/native/adapter-manifest.json"), "utf8"));
  assert.equal(nativeManifest.target, `${process.platform}-${process.arch}`);
  assert.equal(nativeManifest.assets.every((entry) => entry.path.startsWith(`${nativeManifest.target}/`)), true);
  assert.equal((await fs.readdir(path.join(result.outputDirectory, "runtime/native"))).sort().join(","), `adapter-manifest.json,${nativeManifest.target}`);
  const { artifactDigest, ...artifactDescriptor } = artifact;
  assert.equal(
    artifactDigest,
    (await import("node:crypto")).createHash("sha256").update(JSON.stringify(artifactDescriptor)).digest("hex"),
  );

  const projectRoot = path.join(testRoot, "project");
  await fs.mkdir(projectRoot, { recursive: true });
  await run(result.outputDirectory, ["init", "packed-app", "--skip-install", "--skip-deploy"], projectRoot);
  assert.equal(await fs.stat(path.join(projectRoot, "packed-app/.localapp/runtime/server-core/dist/index.js")).then(() => true, () => false), true);
});

test("direct builder execution works from a source path containing spaces", async (t) => {
  const sourceDirectory = path.join(testRoot, "source package with spaces");
  const outputDirectory = path.join(testRoot, "built package");
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));
  await fs.cp(packageDirectory, sourceDirectory, {
    recursive: true,
    filter: (source) => !["node_modules", "dist"].includes(path.basename(source)),
  });
  await fs.symlink(path.join(packageDirectory, "node_modules"), path.join(sourceDirectory, "node_modules"));

  const result = await runNode(path.join(sourceDirectory, "scripts/build-package.mjs"), {
    LOCALAPP_PACKAGE_DIR: outputDirectory,
    LOCALAPP_REPOSITORY_ROOT: projectDirectory,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).outputDirectory, outputDirectory);
  assert.equal(await run(outputDirectory, ["--version"]), "localapp 0.2.4");
});

test("builder rejects a source package identity that diverges from the shared release target", async (t) => {
  const sourceDirectory = path.join(testRoot, "source package with mismatched identity");
  const outputDirectory = path.join(testRoot, "mismatched identity package");
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));
  await fs.cp(packageDirectory, sourceDirectory, {
    recursive: true,
    filter: (source) => !["node_modules", "dist"].includes(path.basename(source)),
  });
  await fs.symlink(path.join(packageDirectory, "node_modules"), path.join(sourceDirectory, "node_modules"));
  const sourceManifestPath = path.join(sourceDirectory, "package.json");
  const sourceManifest = JSON.parse(await fs.readFile(sourceManifestPath, "utf8"));
  sourceManifest.name = "@patodo/mismatched-localapp";
  await fs.writeFile(sourceManifestPath, `${JSON.stringify(sourceManifest, null, 2)}\n`);

  const result = await runNode(path.join(sourceDirectory, "scripts/build-package.mjs"), {
    LOCALAPP_PACKAGE_DIR: outputDirectory,
    LOCALAPP_REPOSITORY_ROOT: projectDirectory,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /release target.*package manifest/i);
});

test("packed tarball keeps the builtin runtime available to init", async (t) => {
  const packDirectory = path.join(testRoot, "packed tarball");
  const unpackDirectory = path.join(testRoot, "unpacked tarball");
  const projectDirectory = path.join(testRoot, "tarball project");
  await fs.mkdir(packDirectory, { recursive: true });
  await fs.mkdir(projectDirectory, { recursive: true });
  t.after(() => fs.rm(packDirectory, { recursive: true, force: true }));
  t.after(() => fs.rm(unpackDirectory, { recursive: true, force: true }));
  t.after(() => fs.rm(projectDirectory, { recursive: true, force: true }));

  await runProcess("pnpm", ["-C", packageDirectory, "pack", "--pack-destination", packDirectory]);
  const tarball = path.join(packDirectory, "patodo-localapp-0.2.4.tgz");
  await fs.mkdir(unpackDirectory, { recursive: true });
  await runProcess("tar", ["-xzf", tarball, "-C", unpackDirectory]);
  const packedPackage = path.join(unpackDirectory, "package");
  await run(packedPackage, ["init", "tarball-app", "--skip-install", "--skip-deploy"], projectDirectory);
  assert.equal(await fs.stat(path.join(projectDirectory, "tarball-app/.localapp/runtime/server-core/dist/index.js")).then(() => true, () => false), true);
  assert.match(await fs.readFile(path.join(projectDirectory, "tarball-app/.npmrc"), "utf8"), /public-hoist-pattern\[\]=pdfjs-dist/);
});

test("packed postinstall wrapper treats only a missing localapp executable as a warning", async (t) => {
  const outputDirectory = path.join(testRoot, "wrapper package");
  const emptyPath = path.join(testRoot, "empty executable path");
  const failingPath = path.join(testRoot, "failing executable path");
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  t.after(() => fs.rm(emptyPath, { recursive: true, force: true }));
  t.after(() => fs.rm(failingPath, { recursive: true, force: true }));
  await fs.mkdir(emptyPath, { recursive: true });
  await fs.mkdir(failingPath, { recursive: true });
  const result = await buildLocalAppPackage({ outputDirectory });
  const wrapper = path.join(result.outputDirectory, "template/runtime/sync-template.cjs");

  const execution = await runNode(wrapper, { PATH: emptyPath });

  assert.equal(execution.code, 0, execution.stderr);
  assert.match(execution.stderr, /localapp executable was not found; managed template sync was skipped/i);

  const failingExecutable = path.join(failingPath, process.platform === "win32" ? "localapp.cmd" : "localapp");
  await fs.writeFile(failingExecutable, process.platform === "win32" ? "@exit /b 23\r\n" : "#!/bin/sh\nexit 23\n");
  if (process.platform !== "win32") await fs.chmod(failingExecutable, 0o755);
  const failure = await runNode(wrapper, { PATH: failingPath });
  assert.equal(failure.code, 23, failure.stderr);
});

test("pnpm-packed tarball wrapper handles missing executable and genuine child failure", async (t) => {
  const packDirectory = path.join(testRoot, "wrapper packed tarball");
  const unpackDirectory = path.join(testRoot, "wrapper unpacked tarball");
  const emptyPath = path.join(testRoot, "wrapper empty path");
  const failingPath = path.join(testRoot, "wrapper & failing path (special)!");
  for (const cleanupPath of [packDirectory, unpackDirectory, emptyPath, failingPath]) {
    t.after(() => fs.rm(cleanupPath, { recursive: true, force: true }));
    await fs.mkdir(cleanupPath, { recursive: true });
  }

  await runProcess("pnpm", ["-C", packageDirectory, "pack", "--pack-destination", packDirectory]);
  await runProcess("tar", ["-xzf", path.join(packDirectory, "patodo-localapp-0.2.4.tgz"), "-C", unpackDirectory]);
  const wrapper = path.join(unpackDirectory, "package/template/runtime/sync-template.cjs");

  const missing = await runNode(wrapper, { PATH: emptyPath });
  assert.equal(missing.code, 0, missing.stderr);
  assert.match(missing.stderr, /localapp executable was not found; managed template sync was skipped/i);

  const failingExecutable = path.join(failingPath, process.platform === "win32" ? "localapp.cmd" : "localapp");
  await fs.writeFile(failingExecutable, process.platform === "win32" ? "@exit /b 29\r\n" : "#!/bin/sh\nexit 29\n");
  if (process.platform !== "win32") await fs.chmod(failingExecutable, 0o755);
  const failure = await runNode(wrapper, { PATH: failingPath });
  assert.equal(failure.code, 29, failure.stderr);
});

test("Windows packed wrapper executes a cmd shim from a spaced special-character PATH entry", { skip: process.platform !== "win32" }, async (t) => {
  const outputDirectory = path.join(testRoot, "windows wrapper package");
  const executableDirectory = path.join(testRoot, "windows & wrapper path (special)!");
  t.after(() => fs.rm(outputDirectory, { recursive: true, force: true }));
  t.after(() => fs.rm(executableDirectory, { recursive: true, force: true }));
  await fs.mkdir(executableDirectory, { recursive: true });
  const result = await buildLocalAppPackage({ outputDirectory });
  const wrapper = path.join(result.outputDirectory, "template/runtime/sync-template.cjs");
  await fs.writeFile(path.join(executableDirectory, "localapp.cmd"), "@exit /b 31\r\n");

  const failure = await runNode(wrapper, { PATH: executableDirectory });

  assert.equal(failure.code, 31, failure.stderr);
});

function run(directory, args, cwd = directory) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(directory, "bin/localapp.mjs"), ...args], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`localapp exited ${code}: ${stderr}`));
    });
  });
}

function runNode(script, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout: stdout.trim(), stderr }));
  });
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr}`)));
  });
}
