import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { buildLocalRuntime } from "./build-local-runtime.mjs";

test("builds a standalone local runtime resource with sql.js wasm", async (t) => {
  const temporaryRoot = new URL("../.tmp/", import.meta.url);
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot.pathname, "local-runtime-bundle-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const output = path.join(root, "local-runtime");
  const registry = path.join(root, "registry.json");
  await writeFile(registry, '{"schemaVersion":1,"apps":[]}');

  const result = await buildLocalRuntime({ outputDirectory: output });
  const marker = JSON.parse(
    await readFile(path.join(output, ".localapp-local-runtime.json"), "utf8"),
  );
  assert.equal(marker.schemaVersion, 1);
  assert.equal(marker.entry, "localapp-local-runtime.mjs");
  assert.ok(
    (await readFile(path.join(result.sqlTarget, "dist", "sql-wasm.wasm"))).length > 8,
  );

  const child = spawn(process.execPath, [result.script], {
    env: {
      ...process.env,
      LOCALAPP_LOCAL_CONTROL_TOKEN: "bundle-test-token",
      LOCALAPP_LOCAL_REGISTRY: registry,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  const ready = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("bundled runtime did not become ready")), 5000);
    child.stdout.once("data", (chunk) => {
      clearTimeout(timeout);
      resolve(JSON.parse(chunk.toString()));
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code) reject(new Error(`bundled runtime exited with ${code}`));
    });
  });
  assert.equal(ready.type, "ready");
  assert.equal(ready.host, "127.0.0.1");
  assert.ok(ready.port > 0);
});

test("tauri packages the generated local runtime directory", async () => {
  const config = JSON.parse(
    await readFile(
      new URL("../src-tauri/tauri.conf.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(config.bundle.resources["resources/local-runtime"], "local-runtime");
});
