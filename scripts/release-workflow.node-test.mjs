import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const release = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const windows = fs.readFileSync(new URL("../.github/workflows/native-windows.yml", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const dockerSmoke = fs.readFileSync(new URL("./docker-release-smoke.sh", import.meta.url), "utf8");

test("release gates one npm tarball behind source and native-adapter verification", () => {
  assert.match(release, /NODE_VERSION: "24"/);
  assert.match(release, /^  native-adapters:\n    needs: source-gate\n/m);
  assert.match(release, /^  package:\n    needs: \[source-gate, native-adapters\]\n/m);
  assert.match(release, /actions\/download-artifact@v4[\s\S]*pattern: localapp-native-\*/);
  assert.match(release, /LOCALAPP_PREBUILT_NATIVE_ADAPTERS_DIR:/);
  assert.match(release, /pnpm package:localapp/);
  assert.match(release, /localapp-\$\{version\}\.tgz/);
  assert.doesNotMatch(release, /packages\/cli|@localapp\/desktop|tauri|nsis|desktop-windows|kind:\s*desktop/i);
});

test("ordinary CI uses Node 24 and delegates native boundaries to package scripts", () => {
  assert.match(ci, /NODE_VERSION: "24"/);
  assert.match(ci, /pnpm -C packages\/localapp test/);
  assert.match(ci, /pnpm -C packages\/localapp test:native/);
  assert.match(ci, /pnpm package:localapp[\s\S]*docker build --tag localapp-ci/);
  assert.doesNotMatch(ci, /packages\/cli|packages\/localapp-core|@localapp\/desktop|tauri|nsis/i);
});

test("Windows workflow builds only the localapp native adapter", () => {
  assert.match(windows, /build-windows-release\.ps1/);
  assert.match(windows, /packages\/localapp\/native\/windows/);
  assert.doesNotMatch(windows, /packages\/cli|packages\/desktop|@localapp\/desktop|tauri|nsis/i);
});

test("Docker installs the packed npm product and runs its public server command", () => {
  assert.match(dockerfile, /^FROM node:24-slim AS runtime$/m);
  assert.match(dockerfile, /COPY tmp\/localapp-package\/localapp-\*\.tgz \/dist\/localapp\.tgz/);
  assert.match(dockerfile, /npm install --global \/dist\/localapp\.tgz/);
  assert.match(dockerfile, /CMD \["localapp", "server", "run"/);
  assert.doesNotMatch(dockerfile, /packages\/desktop|packages\/cli|localapp-server\.mjs|pnpm|cargo|rustup|npm pack|package:localapp/);
  assert.match(dockerSmoke, /state_dir="\$\{PWD\}\/tmp\/docker-release-smoke-/);
  assert.match(dockerSmoke, /chmod 0777 "\$\{state_dir\}"/);
});

test("the release image is loaded and smoke tested before its first push", () => {
  assert.match(release, /^  image:[\s\S]*actions\/download-artifact@v4[\s\S]*name: localapp-release[\s\S]*path: tmp\/localapp-package/m);
  const load = release.indexOf("load: true");
  const smoke = release.indexOf("docker-release-smoke.sh");
  const push = release.indexOf("docker push");
  assert.ok(load >= 0, "release image must be loaded locally");
  assert.ok(smoke > load, "release image must be smoke tested after loading");
  assert.ok(push > smoke, "release image must not be pushed before checks pass");
  assert.doesNotMatch(release, /push:\s*true/);
});
