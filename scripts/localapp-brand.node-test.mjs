import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const repositoryRoot = new URL("../", import.meta.url);
const legacyStem = ["qe", "da"].join("");
const forbiddenPath = new RegExp(legacyStem, "i");
const forbiddenText = new RegExp(legacyStem, "gi");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
}

function isBinary(content) {
  return content.includes(0);
}

test("tracked product surfaces use only the LocalApp identity", () => {
  const violations = [];

  for (const path of trackedFiles()) {
    if (forbiddenPath.test(path)) {
      violations.push(`${path}: legacy brand in path`);
    }

    const content = readFileSync(new URL(path, repositoryRoot));
    if (isBinary(content)) continue;

    const text = content.toString("utf8");
    const lines = text.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      forbiddenText.lastIndex = 0;
      if (forbiddenText.test(line)) {
        violations.push(`${path}:${index + 1}: legacy brand in text`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("product icon uses a neutral personal-app symbol", () => {
  const icon = readFileSync(new URL("../assets/brand/localapp-icon.svg", import.meta.url), "utf8");

  assert.doesNotMatch(icon, /M0 \.5L0 70\.3L212\.1 70\.3/);
  assert.doesNotMatch(icon, /id="product-initial"/);
  assert.match(icon, /id="personal-app-symbol"/);
  assert.match(icon, /person silhouette/i);
});
