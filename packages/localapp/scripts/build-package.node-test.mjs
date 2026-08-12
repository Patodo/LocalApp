import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLocalAppPackage } from "./build-package.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(projectDirectory, "tmp/task-1-package-test");
const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("packed product exposes one localapp binary without workspace references", async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));

  const outputDirectory = path.join(testRoot, "artifact with spaces");
  const result = await buildLocalAppPackage({ outputDirectory });
  const manifest = JSON.parse(await fs.readFile(path.join(result.outputDirectory, "package.json"), "utf8"));

  assert.equal(manifest.name, "localapp");
  assert.deepEqual(manifest.bin, { localapp: "bin/localapp.mjs" });
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal(await run(result.outputDirectory, ["--version"]), "localapp 0.1.0");
  assert.equal(await fs.stat(path.join(result.outputDirectory, "template/runtime/server-core/dist/index.js")).then(() => true, () => false), true);

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
  assert.equal(await run(outputDirectory, ["--version"]), "localapp 0.1.0");
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
  const tarball = path.join(packDirectory, "localapp-0.1.0.tgz");
  await fs.mkdir(unpackDirectory, { recursive: true });
  await runProcess("tar", ["-xzf", tarball, "-C", unpackDirectory]);
  const packedPackage = path.join(unpackDirectory, "package");
  await run(packedPackage, ["init", "tarball-app", "--skip-install", "--skip-deploy"], projectDirectory);
  assert.equal(await fs.stat(path.join(projectDirectory, "tarball-app/.localapp/runtime/server-core/dist/index.js")).then(() => true, () => false), true);
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
