import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildServerPackage } from "./build-server-package.mjs";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(projectDirectory, "tmp/server-package-e2e");

test("packed Node Server initializes and serves Web without repository dependencies", async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });
  const outputDirectory = path.join(testRoot, "artifact");
  const repeatedDirectory = path.join(testRoot, "artifact-repeat");
  const dataDirectory = await fs.mkdtemp(path.join(testRoot, "data-"));
  const artifact = await buildServerPackage({ outputDirectory });
  const repeated = await buildServerPackage({ outputDirectory: repeatedDirectory });
  assert.equal(artifact.bundleDigest, repeated.bundleDigest);
  const manifest = JSON.parse(await fs.readFile(artifact.manifestPath, "utf8"));
  for (const skill of ["markitdown", "pdf", "docx", "xlsx"]) {
    assert.ok(manifest.files[`skills/${skill}/SKILL.md`]);
    assert.ok(manifest.files[`skills/${skill}/LICENSE`]);
    assert.ok(manifest.files[`skills/${skill}/SOURCE.json`]);
    assert.ok(Object.keys(manifest.files).some((file) => file.startsWith(`skills/${skill}/scripts/`) && file.endsWith(".py")));
  }
  assert.match(await fs.readFile(artifact.bin, "utf8"), /LOCALAPP_PUBLIC_SKILLS_ROOT/);
  assert.equal((await fs.readFile(artifact.bin, "utf8")).startsWith("#!/usr/bin/env node\n"), true);

  const child = spawn(process.execPath, [artifact.bin, "start", "--data-dir", dataDirectory, "--port", "0"], {
    cwd: outputDirectory,
    env: { ...process.env, NODE_PATH: "", BOOTSTRAP_API_KEY: "package-agent-regression-key" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    const ready = await readReadyLine(child.stdout);
    assert.equal(ready.type, "ready");
    assert.equal((await fetch(`${ready.url}/health`)).status, 200);
    const setupResponse = await fetch(ready.setupUrl);
    assert.equal(setupResponse.status, 200, stderr);
    assert.match(await setupResponse.text(), /Create|admin|管理员/i);
    assert.equal(await fileExists(path.join(dataDirectory, "jwt.key")), true);
    const initialize = await fetch(`${ready.url}/api/setup/initialize`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: new URL(ready.setupUrl).searchParams.get("token"), username: "package-agent", password: "package-test-password" }),
    });
    assert.equal(initialize.status, 201, await initialize.text());
    const headers = { "Content-Type": "application/json", "X-API-Key": "package-agent-regression-key" };
    const settings = await fetch(`${ready.url}/api/agent/settings`, { method: "PUT", headers,
      body: JSON.stringify({ providers: [{ id: "test", name: "Test", protocol: "openai-completions", baseUrl: "http://127.0.0.1:1/v1", model: "test-model", apiKey: "test-key" }], defaultProviderId: "test", grants: {}, mcpServers: [] }),
    });
    assert.equal(settings.status, 200, await settings.text());
    // This initializes the real packaged harness, including titles and default capabilities,
    // without making a model request. Source-only tests miss CJS export wrapping failures.
    const sessions = await fetch(`${ready.url}/api/agent/sessions`, { headers });
    assert.equal(sessions.status, 200, await sessions.clone().text());
    assert.deepEqual((await sessions.json()).data, []);
  } finally {
    if (!child.killed) child.kill("SIGTERM");
    await onceExit(child);
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

async function readReadyLine(stream) {
  let buffer = "";
  return new Promise((resolve, reject) => {
    const onData = (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try {
          const message = JSON.parse(line);
          if (message.type === "ready") {
            stream.off("data", onData);
            resolve(message);
            return;
          }
        } catch {
          // Ignore non-JSON diagnostic lines until the readiness message.
        }
      }
    };
    stream.setEncoding("utf8");
    stream.on("data", onData);
    stream.once("error", reject);
  });
}

function onceExit(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", resolve));
}

async function fileExists(filePath) {
  return (await fs.stat(filePath).catch(() => null))?.isFile() ?? false;
}
