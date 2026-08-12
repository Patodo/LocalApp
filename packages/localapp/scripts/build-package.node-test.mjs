import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildLocalAppPackage } from "./build-package.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(projectDirectory, "tmp/task-1-package-test");

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
