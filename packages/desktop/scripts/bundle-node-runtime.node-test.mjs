import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { bundleNodeRuntime, resolveRuntimeTarget } from "./bundle-node-runtime.mjs";

const projectDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const outputDirectory = path.join(projectDirectory, "tmp/desktop-node-runtime");

test("Tauri bundles the pinned Node 24 runtime without using PATH", async () => {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  const result = await bundleNodeRuntime({ outputDirectory });
  const marker = JSON.parse(await fs.readFile(result.marker, "utf8"));
  assert.equal(marker.target, resolveRuntimeTarget());
  assert.equal(marker.nodeMajor, 24);
  assert.match(marker.version, /^24\./);
  await fs.access(result.output);
});
