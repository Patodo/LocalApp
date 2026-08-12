import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const packageDirectory = path.join(projectDirectory, "packages/localapp");
const testRoot = path.join(projectDirectory, "tmp/task-1-pack-test");

test("pnpm pack ships an executable localapp binary", async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));

  const packed = await run("pnpm", ["pack", "--pack-destination", testRoot], packageDirectory);
  assert.equal(packed.code, 0, packed.stderr);
  const tarball = path.join(testRoot, (await fs.readdir(testRoot)).find((file) => file.endsWith(".tgz")) ?? "missing.tgz");
  const extracted = path.join(testRoot, "extracted");
  await fs.mkdir(extracted, { recursive: true });
  const unpacked = await run("tar", ["-xzf", tarball, "-C", extracted], projectDirectory);
  assert.equal(unpacked.code, 0, unpacked.stderr);

  const binary = path.join(extracted, "package/bin/localapp.mjs");
  const manifest = JSON.parse(await fs.readFile(path.join(extracted, "package/package.json"), "utf8"));
  assert.equal((await fs.stat(binary)).isFile(), true);
  assert.equal((await fs.stat(path.join(extracted, "package/.localapp-artifact.json"))).isFile(), true);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal((await fs.stat(path.join(extracted, "package/runtime/server/bin/localapp-server.mjs"))).isFile(), true);
  const version = await run(process.execPath, [binary, "--version"], extracted);
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), "localapp 0.1.0");
});

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}
