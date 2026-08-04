import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const workflow = fs.readFileSync(new URL("../.github/workflows/release.yml", import.meta.url), "utf8");

test("tag release jobs depend on a same-commit source gate", () => {
  assert.match(workflow, /^  source-gate:\n/m);
  assert.match(workflow, /^  cli:\n    needs: source-gate\n/m);
  assert.match(workflow, /^  desktop-windows:\n    needs: source-gate\n/m);
  assert.match(workflow, /pnpm export:public-source --commit "\$GITHUB_SHA".*--verify/);
  assert.match(workflow, /openspec validate --all --strict/);
  assert.match(workflow, /pnpm add --global @fission-ai\/openspec@1\.6\.0/);
});

test("every CLI matrix target runs tests and smoke checks its built artifact", () => {
  assert.match(workflow, /name: Test CLI[\s\S]*cargo test --locked[\s\S]*--target \$\{\{ matrix\.rust_target \}\}/);
  assert.match(workflow, /name: Smoke test CLI[\s\S]*\/release\/\$\{\{ matrix\.source \}\}" --version/);
});

test("the server image is loaded, scanned, and smoke tested before its first push", () => {
  const load = workflow.indexOf("load: true");
  const smoke = workflow.indexOf("docker-release-smoke.sh");
  const push = workflow.indexOf("docker push");
  assert.ok(load >= 0, "release image must be loaded locally");
  assert.ok(smoke > load, "release image must be scanned and smoke tested after loading");
  assert.ok(push > smoke, "release image must not be pushed before checks pass");
  assert.doesNotMatch(workflow, /push:\s*true/);
});
