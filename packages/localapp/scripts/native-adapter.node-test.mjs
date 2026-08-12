import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { buildNativeAdapter } from "./build-native-adapter.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(repositoryRoot, "tmp/task-8-native-acceptance");

test("ad-hoc signed macOS bridge forwards exactly one real Scheme URL to the repository-local daemon", { skip: process.platform !== "darwin" }, async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  await fs.mkdir(testRoot, { recursive: true });

  const runtimeDir = path.join(testRoot, "runtime");
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const endpoint = path.join(runtimeDir, "control.sock");
  const received = [];
  const daemon = net.createServer((socket) => {
    let frame = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { frame += chunk; });
    socket.on("end", () => {
      received.push(JSON.parse(frame));
      socket.end('{"ok":true,"type":"activation"}\n');
    });
  });
  await new Promise((resolve, reject) => { daemon.once("error", reject); daemon.listen(endpoint, resolve); });
  t.after(async () => { await new Promise((resolve) => daemon.close(resolve)); });

  const built = await buildNativeAdapter({
    outputDirectory: path.join(testRoot, "native"),
    signing: "adhoc",
    bundleIdentifier: "dev.localapp.bridge.task8",
    runtimeDir,
  });
  assert.equal(built.signing.mode, "adhoc");
  const codeSign = await run("/usr/bin/codesign", ["--verify", "--strict", built.appBundle]);
  assert.equal(codeSign.code, 0, codeSign.stderr);
  const manifest = JSON.parse(await fs.readFile(path.join(built.outputDirectory, "adapter-manifest.json"), "utf8"));
  for (const asset of manifest.assets) {
    const bytes = await fs.readFile(path.join(built.outputDirectory, asset.path));
    assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), asset.sha256);
  }

  assert.equal((await run(built.executable, ["--register"])).code, 0);
  t.after(async () => { await run(built.executable, ["--unregister"]); });
  t.after(async () => { await fs.rm(testRoot, { recursive: true, force: true }); });
  const activationUrl = "localapp://action/11111111-1111-4111-8111-111111111111?origin=https%3A%2F%2Fserver.example.test&nonce=nonce_abcdefghijklmnopqrstuvwxyz-0123456789&protocolVersion=2";
  const opened = await run("/usr/bin/open", ["-b", "dev.localapp.bridge.task8", activationUrl]);
  assert.equal(opened.code, 0, opened.stderr);
  await waitFor(() => received.length === 1, "one bridge IPC activation");
  assert.deepEqual(received, [{ type: "activation", url: activationUrl }]);
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stderr }));
  });
}

async function waitFor(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
