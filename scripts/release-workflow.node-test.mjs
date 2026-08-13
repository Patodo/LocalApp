import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const release = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");
const ci = fs.readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const windows = fs.readFileSync(new URL("../.github/workflows/native-windows.yml", import.meta.url), "utf8");
const dockerfile = fs.readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const dockerSmoke = fs.readFileSync(new URL("./docker-release-smoke.sh", import.meta.url), "utf8");
const readme = fs.readFileSync(new URL("../README.md", import.meta.url), "utf8");
const npmReleaseGuide = fs.readFileSync(new URL("../docs/npm-release.md", import.meta.url), "utf8");
const localRuntimeGuide = fs.readFileSync(new URL("../docs/local-runtime.md", import.meta.url), "utf8");
const windowsReleaseGuide = fs.readFileSync(new URL("../docs/windows-local-release.md", import.meta.url), "utf8");
const projectTmp = new URL("../tmp/", import.meta.url).pathname;

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

test("release validates npm identity without publishing to npm", () => {
  assert.match(release, /expected_tag="v\$\{version\}"/);
  assert.match(release, /GITHUB_REF_TYPE[\s\S]*GITHUB_REF_NAME[\s\S]*expected_tag/);
  assert.match(release, /node scripts\/check-npm-release\.mjs[\s\\]*--tarball[\s\S]*--tag/);
  assert.doesNotMatch(release, /NPM_TOKEN|NODE_AUTH_TOKEN|id-token:\s*write/i);
  assert.doesNotMatch(release, /npm\s+publish/);
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

test("public installation guidance uses the scoped registry package while retaining the localapp command", () => {
  assert.match(readme, /npm install --global @patodo\/localapp/);
  assert.match(readme, /npx --package @patodo\/localapp localapp/);
  assert.match(npmReleaseGuide, /npm view "@patodo\/localapp@\$\{version\}"/);
  assert.match(npmReleaseGuide, /npx --package @patodo\/localapp localapp --version/);
  assert.match(localRuntimeGuide, /npm install --global @patodo\/localapp/);
  assert.match(localRuntimeGuide, /npx --package @patodo\/localapp localapp/);
  assert.match(windowsReleaseGuide, /npm install --global @patodo\/localapp@<version>/);
  assert.match(windowsReleaseGuide, /npm update --global @patodo\/localapp/);

  for (const guide of [readme, npmReleaseGuide, localRuntimeGuide, windowsReleaseGuide]) {
    assert.doesNotMatch(guide, /npm (?:install|view|update)[^\n]*(?<!@patodo\/)(?<!\.)(?<!\/)(?<!\\)\blocalapp(?:@|\b)/);
  }

  assert.match(dockerSmoke, /\/usr\/local\/lib\/node_modules\/@patodo\/localapp/);
  assert.doesNotMatch(dockerSmoke, /\/usr\/local\/lib\/node_modules\/localapp/);
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

test("Docker smoke checks fresh setup on container loopback and cleans container-owned state", () => {
  fs.mkdirSync(projectTmp, { recursive: true });
  const root = fs.mkdtempSync(path.join(projectTmp, "docker-smoke-test-"));
  const bin = path.join(root, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env bash
set -euo pipefail
command="$1"
shift
case "$command" in
  run)
    arguments=" $* "
    if [[ "$arguments" == *" --entrypoint localapp "* ]]; then
      echo "localapp 0.1.0"
    elif [[ "$arguments" == *" -d "* ]]; then
      for ((index=1; index<=$#; index++)); do
        if [[ "\${!index}" == "-v" ]]; then
          next=$((index + 1))
          host_dir="\${!next%%:*}"
          mkdir -p "$host_dir/.verification/sessions"
          touch "$host_dir/.verification/sessions/container-owned"
          break
        fi
      done
      echo "container-id"
    elif [[ "$arguments" == *" --entrypoint sh "* ]]; then
      for ((index=1; index<=$#; index++)); do
        if [[ "\${!index}" == "-v" ]]; then
          next=$((index + 1))
          host_dir="\${!next%%:*}"
          /bin/rm -rf "$host_dir"/* "$host_dir"/.[!.]* "$host_dir"/..?* 2>/dev/null || true
          break
        fi
      done
    fi
    ;;
  port) echo "127.0.0.1:43123" ;;
  exec)
    if [[ " $* " == *" localapp --version "* ]]; then
      echo "localapp 0.1.0"
    fi
    ;;
  rm) ;;
esac
`);
  fs.writeFileSync(path.join(bin, "curl"), "#!/usr/bin/env bash\necho 'fresh setup is not reachable through the published port' >&2\nexit 56\n");
  fs.writeFileSync(path.join(bin, "rm"), `#!/usr/bin/env bash
set -euo pipefail
target="\${!#}"
if find "$target" -mindepth 1 -print -quit | grep -q .; then
  echo "host cleanup encountered container-owned state" >&2
  exit 1
fi
/bin/rmdir "$target"
`);
  for (const name of ["docker", "curl", "rm"]) {
    fs.chmodSync(path.join(bin, name), 0o755);
  }

  try {
    execFileSync("bash", [new URL("./docker-release-smoke.sh", import.meta.url).pathname, "localapp:test"], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
      stdio: "pipe",
    });
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
