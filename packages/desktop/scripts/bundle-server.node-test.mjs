import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { bundleServer } from "./bundle-server.mjs";

const projectDirectory = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const outputDirectory = path.join(projectDirectory, "tmp/desktop-server-bundle");

test("Tauri bundles the canonical Server artifact and runner", async () => {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  const result = await bundleServer({ outputDirectory });
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8"));
  assert.equal(manifest.name, "@localapp/server");
  assert.equal(manifest.nodeMajor, 24);
  assert.equal(manifest.entrypoint, "bin/localapp-server.mjs");
  await fs.access(path.join(outputDirectory, manifest.entrypoint));
  await fs.access(path.join(outputDirectory, "runner/localapp-runner.mjs"));
  await assert.rejects(fs.access(path.join(outputDirectory, "local-runtime")));
});
