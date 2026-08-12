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
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).outputDirectory, outputDirectory);
  assert.equal(await run(outputDirectory, ["--version"]), "localapp 0.1.0");
});

function run(directory, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(directory, "bin/localapp.mjs"), ...args], {
      cwd: directory,
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
