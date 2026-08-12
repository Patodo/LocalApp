import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the repository exposes only the localapp npm product", async () => {
  for (const relative of [
    "packages/desktop",
    "packages/cli",
    "packages/localapp-core",
    "packages/localapp-template",
    "scripts/release-cli.mjs",
    ".github/workflows/desktop-windows.yml",
    "packages/server/tests/e2e-cli/helpers.ts",
  ]) {
    assert.equal(await exists(relative), false, `${relative} is an obsolete product path`);
  }

  const rootManifest = await readJson("package.json");
  assert.equal(rootManifest.scripts["package:localapp"], "node scripts/package-localapp.mjs");
  assert.equal(rootManifest.scripts["test:localapp-package"], "node --test --test-concurrency=1 packages/localapp/scripts/pack-package.node-test.mjs packages/localapp/scripts/build-package.node-test.mjs packages/localapp/scripts/merge-native-adapters.node-test.mjs scripts/single-package-cutover.node-test.mjs");
  for (const obsolete of ["package:server", "test:server-package", "build:cli", "build:cli:debug", "build:cli:only"]) {
    assert.equal(rootManifest.scripts[obsolete], undefined, `${obsolete} must not remain public`);
  }

  const serverManifest = await readJson("packages/server/package.json");
  assert.equal(serverManifest.private, true);
  assert.equal(serverManifest.bin, undefined);
  const localappManifest = await readJson("packages/localapp/package.json");
  assert.deepEqual(localappManifest.bin, { localapp: "bin/localapp.mjs" });
  assert.equal(Object.values(localappManifest).join("\n").includes("postinstall"), false);

  const packageScript = await fs.readFile(path.join(repositoryRoot, "scripts/package-localapp.mjs"), "utf8");
  assert.match(packageScript, /packages\/server-core["],\s*"build/);
  assert.match(packageScript, /packages\/web["],\s*"build/);
  const packageBuilder = await fs.readFile(path.join(repositoryRoot, "packages/localapp/scripts/build-package.mjs"), "utf8");
  assert.match(packageBuilder, /LOCALAPP_PREBUILT_NATIVE_ADAPTERS_DIR/);

  const workspace = await fs.readFile(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  assert.doesNotMatch(workspace, /packages\/(?:desktop|cli|localapp-core|localapp-template)/);
});

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(repositoryRoot, relative), "utf8"));
}

async function exists(relative) {
  return fs.access(path.join(repositoryRoot, relative)).then(() => true, () => false);
}
