import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = path.join(projectDirectory, "tmp/check-npm-release-test");
const expectedTargets = ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"];

test("checkNpmRelease accepts only a complete safe release candidate", async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));
  const { checkNpmRelease, npmPublishDryRunArgs } = await import("./check-npm-release.mjs");

  await t.test("constructs only the public npm dry-run command", () => {
    assert.deepEqual(npmPublishDryRunArgs("/candidate/localapp.tgz"), [
      "publish", "--dry-run", "--access", "public", "/candidate/localapp.tgz",
    ]);
  });

  await t.test("accepts the exact public package and runs npm dry-run", async () => {
    const tarball = await createFixture("valid");
    const calls = [];
    const result = await checkNpmRelease({
      tarballPath: tarball,
      expectedTag: "v0.1.0",
      runNpmDryRun: async (candidate) => calls.push(candidate),
    });
    assert.deepEqual(result, { name: "localapp", version: "0.1.0", targets: expectedTargets });
    assert.deepEqual(calls, [tarball]);
  });

  for (const [name, mutate, message, expectedTag = "v0.1.0"] of [
    ["rejects a wrong package name", (value) => { value.packageJson.name = "other"; }, /package name/i],
    ["rejects a tag and version mismatch", () => {}, /tag.*version/i, "v0.2.0"],
    ["rejects a missing README", (value) => { value.omit.add("README.md"); }, /README\.md/],
    ["rejects a missing LICENSE", (value) => { value.omit.add("LICENSE"); }, /LICENSE/],
    ["rejects an incomplete adapter matrix", (value) => { value.targets.pop(); }, /native adapter/i],
    ["rejects an extra adapter target", (value) => { value.targets.push("freebsd-x64"); }, /native adapter/i],
    ["rejects lifecycle scripts", (value) => { value.packageJson.scripts = { preinstall: "echo unsafe" }; }, /lifecycle/i],
    ["rejects workspace dependencies", (value) => { value.packageJson.dependencies = { bad: "workspace:*" }; }, /dependencies/i],
    ["rejects a second binary", (value) => { value.packageJson.bin.extra = "bin/extra.mjs"; }, /binary/i],
  ]) {
    await t.test(name, async () => {
      const tarball = await createFixture(name.replaceAll(" ", "-"), mutate);
      await assert.rejects(
        checkNpmRelease({ tarballPath: tarball, expectedTag, runNpmDryRun: async () => {} }),
        message,
      );
    });
  }

  await t.test("rejects an unsafe archive path before extraction", async () => {
    const tarball = path.join(testRoot, "unsafe.tgz");
    await fs.writeFile(tarball, gzipSync(createTarEntry("package/../escape", "unsafe")));
    await assert.rejects(
      checkNpmRelease({ tarballPath: tarball, expectedTag: "v0.1.0", runNpmDryRun: async () => {} }),
      /unsafe archive path/i,
    );
  });

  await t.test("surfaces npm dry-run failure", async () => {
    const tarball = await createFixture("dry-run-failure");
    await assert.rejects(
      checkNpmRelease({
        tarballPath: tarball,
        expectedTag: "v0.1.0",
        runNpmDryRun: async () => { throw new Error("npm rejected candidate"); },
      }),
      /npm rejected candidate/,
    );
  });
});

async function createFixture(name, mutate = () => {}) {
  const fixtureRoot = path.join(testRoot, name);
  const packageRoot = path.join(fixtureRoot, "package");
  const state = {
    omit: new Set(),
    targets: [...expectedTargets],
    packageJson: {
      name: "localapp",
      version: "0.1.0",
      description: "Local-first application platform and unified Server CLI",
      license: "MIT",
      type: "module",
      bin: { localapp: "bin/localapp.mjs" },
      engines: { node: ">=24" },
      repository: { type: "git", url: "git+https://github.com/Patodo/LocalApp.git" },
      homepage: "https://github.com/Patodo/LocalApp#readme",
      bugs: { url: "https://github.com/Patodo/LocalApp/issues" },
    },
  };
  mutate(state);
  await fs.mkdir(packageRoot, { recursive: true });
  const files = {
    "package.json": `${JSON.stringify(state.packageJson)}\n`,
    "README.md": "# LocalApp\n",
    LICENSE: "MIT\n",
    ".localapp-artifact.json": `${JSON.stringify({
      schemaVersion: 2,
      name: state.packageJson.name,
      version: state.packageJson.version,
      nativeAdapters: state.targets.map((target) => ({ target })),
    })}\n`,
    "bin/localapp.mjs": "#!/usr/bin/env node\n",
    "runtime/server/bin/server.mjs": "export {};\n",
    "runtime/native/adapter-manifest.json": `${JSON.stringify({
      schemaVersion: 2,
      adapters: state.targets.map((target) => ({ target })),
    })}\n`,
    "template/package.json": "{}\n",
  };
  for (const [relative, contents] of Object.entries(files)) {
    if (state.omit.has(relative)) continue;
    const destination = path.join(packageRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, contents);
  }
  const tarball = path.join(testRoot, `${name}.tgz`);
  const packed = await run("tar", ["-czf", tarball, "-C", fixtureRoot, "package"]);
  assert.equal(packed.code, 0, packed.stderr);
  return tarball;
}

function createTarEntry(name, contents) {
  const body = Buffer.from(contents);
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  header.write("0000644\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(0x20, 148, 156);
  header.write("0", 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = [...header].reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding, Buffer.alloc(1024)]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectDirectory, stdio: ["ignore", "pipe", "pipe"] });
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
