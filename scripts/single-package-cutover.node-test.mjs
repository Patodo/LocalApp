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
  assert.equal(rootManifest.scripts["acceptance:local:start"], "node scripts/single-package-acceptance.mjs start");
  assert.equal(rootManifest.scripts["test:localapp-package"], "node --test --test-concurrency=1 packages/localapp/scripts/pack-package.node-test.mjs packages/localapp/scripts/build-package.node-test.mjs packages/localapp/scripts/merge-native-adapters.node-test.mjs scripts/single-package-cutover.node-test.mjs");
  for (const obsolete of ["package:server", "test:server-package", "build:cli", "build:cli:debug", "build:cli:only"]) {
    assert.equal(rootManifest.scripts[obsolete], undefined, `${obsolete} must not remain public`);
  }

  const serverManifest = await readJson("packages/server/package.json");
  assert.equal(serverManifest.private, true);
  assert.equal(serverManifest.bin, undefined);
  const localappManifest = await readJson("packages/localapp/package.json");
  assert.equal(localappManifest.name, "@patodo/localapp");
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

test("developer guidance documents only the supported TypeScript CLI", async () => {
  const guidance = await Promise.all([
    "README.md",
    "init-repo/AGENTS.md",
    "init-repo/CLAUDE.md",
    "init-repo/.claude/skills/localapp/SKILL.md",
  ].map(async (relative) => fs.readFile(path.join(repositoryRoot, relative), "utf8")));
  const combined = guidance.join("\n");
  for (const obsolete of [
    "localapp server add",
    "localapp server list",
    "localapp server use",
    "localapp server login",
    "localapp server remove",
    "localapp verify",
    "localapp db ",
    "localapp backend scaffold",
    "localapp pages ",
    "localapp groups ",
    "localapp update",
    "localapp sync --",
    "localapp eject`",
  ]) {
    assert.equal(combined.includes(obsolete), false, `obsolete CLI guidance remains: ${obsolete}`);
  }
  assert.match(combined, /localapp server(?:\s|`)/);
  assert.match(combined, /localapp sync-template/);
  assert.match(combined, /localapp eject-template/);
});

test("acceptance tooling redacts credentials and cannot reference block-scoped lifecycle output", async () => {
  const source = await fs.readFile(path.join(repositoryRoot, "scripts/single-package-acceptance.mjs"), "utf8");
  assert.doesNotMatch(source, /args\.join\(["'] ["']\)/);
  assert.match(source, /redactCommandArguments/);
  assert.doesNotMatch(source, /\$\{started\.stdout\}/);
});

test("runtime acceptance directories are ignored without hiding source fixtures", async () => {
  const ignore = await fs.readFile(path.join(repositoryRoot, ".gitignore"), "utf8");
  assert.match(ignore, /^\/tmp\/$/m);
  assert.match(ignore, /^\/examples\/\*\/tmp\/$/m);
  assert.doesNotMatch(ignore, /^\/examples\/$/m);
});

async function readJson(relative) {
  return JSON.parse(await fs.readFile(path.join(repositoryRoot, relative), "utf8"));
}

async function exists(relative) {
  return fs.access(path.join(repositoryRoot, relative)).then(() => true, () => false);
}
