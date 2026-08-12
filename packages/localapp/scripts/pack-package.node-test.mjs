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

  const packed = await run(process.execPath, [path.join(projectDirectory, "scripts/package-localapp.mjs")], projectDirectory);
  assert.equal(packed.code, 0, packed.stderr);
  const tarball = path.join(projectDirectory, "tmp/localapp-package/localapp-0.1.0.tgz");
  const extracted = path.join(testRoot, "extracted");
  await fs.mkdir(extracted, { recursive: true });
  const unpacked = await run("tar", ["-xzf", tarball, "-C", extracted], projectDirectory);
  assert.equal(unpacked.code, 0, unpacked.stderr);

  const binary = path.join(extracted, "package/bin/localapp.mjs");
  const manifest = JSON.parse(await fs.readFile(path.join(extracted, "package/package.json"), "utf8"));
  assert.equal((await fs.stat(binary)).isFile(), true);
  assert.equal((await fs.stat(path.join(extracted, "package/.localapp-artifact.json"))).isFile(), true);
  assert.deepEqual(manifest.dependencies ?? {}, {});
  assert.deepEqual(manifest.devDependencies ?? {}, {});
  assert.deepEqual(manifest.scripts ?? {}, {});
  assert.equal(JSON.stringify(manifest).includes("workspace:"), false);
  assert.equal((await fs.stat(path.join(extracted, "package/runtime/server/bin/server.mjs"))).isFile(), true);
  const nativeRoot = path.join(extracted, "package/runtime/native");
  const nativeManifest = JSON.parse(await fs.readFile(path.join(nativeRoot, "adapter-manifest.json"), "utf8"));
  const nativeEntries = await fs.readdir(nativeRoot);
  assert.deepEqual(nativeEntries.sort(), ["adapter-manifest.json", nativeManifest.target]);
  const packedFiles = await listFiles(path.join(extracted, "package"));
  assert.equal(packedFiles.some((file) => /(^|\/)(tauri|desktop|electron)(\/|$)/i.test(file)), false);
  const version = await run(process.execPath, [binary, "--version"], extracted);
  assert.equal(version.code, 0, version.stderr);
  assert.equal(version.stdout.trim(), "localapp 0.1.0");

  const installPrefix = path.join(testRoot, "clean npm prefix");
  const installed = await run("npm", ["install", "--prefix", installPrefix, "--ignore-scripts", tarball], projectDirectory);
  assert.equal(installed.code, 0, installed.stderr);
  const installedBinDirectory = path.join(installPrefix, "node_modules/.bin");
  const installedVersion = await run("localapp", ["--version"], installPrefix, {
    PATH: `${installedBinDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
  });
  assert.equal(installedVersion.code, 0, installedVersion.stderr);
  assert.equal(installedVersion.stdout.trim(), "localapp 0.1.0");
  const installedBins = (await fs.readdir(installedBinDirectory)).filter((entry) => !entry.startsWith("."));
  assert.equal(installedBins.length > 0, true);
  assert.equal(installedBins.every((entry) => entry.replace(/\.(?:cmd|ps1)$/i, "") === "localapp"), true);
  assert.equal(await fs.stat(path.join(installPrefix, "node_modules/localapp/runtime/server/bin/server.mjs")).then(() => true, () => false), true);
});

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

function run(command, args, cwd, environment = undefined) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: environment === undefined ? process.env : { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
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
