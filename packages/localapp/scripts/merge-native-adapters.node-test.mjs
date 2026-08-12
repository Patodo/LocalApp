import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { mergePrebuiltNativeAdapters } from "./merge-native-adapters.mjs";
import { buildLocalAppPackage } from "./build-package.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const testRoot = path.join(repositoryRoot, "tmp/task-12-native-matrix");
const requiredTargets = ["darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"];

test("merges an exact verified native adapter matrix from nested CI downloads", async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));
  const source = path.join(testRoot, "downloads");
  for (const target of requiredTargets) await writeAdapter(source, target);
  const output = path.join(testRoot, "merged");

  const manifest = await mergePrebuiltNativeAdapters({ sourceDirectory: source, outputDirectory: output, requiredTargets });

  assert.deepEqual(manifest.adapters.map((entry) => entry.target), requiredTargets);
  assert.deepEqual((await fs.readdir(output)).sort(), ["adapter-manifest.json", ...requiredTargets].sort());
  assert.equal(manifest.adapters.every((entry) => entry.assets.every((asset) => asset.path.startsWith(`${entry.target}/`))), true);

  const product = await buildLocalAppPackage({
    outputDirectory: path.join(testRoot, "product"),
    prebuiltNativeAdaptersDirectory: source,
  });
  const artifact = JSON.parse(await fs.readFile(product.manifestPath, "utf8"));
  assert.deepEqual(artifact.protocolVersions, { deviceAction: 2, notificationDelivery: 2, peerSync: 1 });
  assert.deepEqual(artifact.nativeAdapters.map((entry) => entry.target), requiredTargets);
  assert.equal(artifact.files.some((entry) => entry.path === "runtime/native/win32-x64/localapp-native.exe"), true);
});

test("rejects missing, duplicate, and digest-mismatched adapter inputs", async (t) => {
  await fs.rm(testRoot, { recursive: true, force: true });
  t.after(() => fs.rm(testRoot, { recursive: true, force: true }));
  const missing = path.join(testRoot, "missing");
  for (const target of requiredTargets.slice(1)) await writeAdapter(missing, target);
  await assert.rejects(() => mergePrebuiltNativeAdapters({ sourceDirectory: missing, outputDirectory: path.join(testRoot, "missing-out"), requiredTargets }), /matrix/i);

  const duplicate = path.join(testRoot, "duplicate");
  for (const target of requiredTargets) await writeAdapter(duplicate, target);
  await writeAdapter(duplicate, requiredTargets[0], "copy");
  await assert.rejects(() => mergePrebuiltNativeAdapters({ sourceDirectory: duplicate, outputDirectory: path.join(testRoot, "duplicate-out"), requiredTargets }), /duplicate/i);

  const tampered = path.join(testRoot, "tampered");
  for (const target of requiredTargets) await writeAdapter(tampered, target);
  await fs.appendFile(path.join(tampered, `download-${requiredTargets[0]}`, "payload", requiredAssetPaths(requiredTargets[0])[0]), "tampered");
  await assert.rejects(() => mergePrebuiltNativeAdapters({ sourceDirectory: tampered, outputDirectory: path.join(testRoot, "tampered-out"), requiredTargets }), /digest/i);

  const extra = path.join(testRoot, "extra");
  for (const target of requiredTargets) await writeAdapter(extra, target);
  await fs.writeFile(path.join(extra, "undeclared.bin"), "extra");
  await assert.rejects(() => mergePrebuiltNativeAdapters({ sourceDirectory: extra, outputDirectory: path.join(testRoot, "extra-out"), requiredTargets }), /extra/i);

  const escaped = path.join(testRoot, "escaped");
  for (const target of requiredTargets) await writeAdapter(escaped, target);
  const escapedManifest = path.join(escaped, `download-${requiredTargets[0]}`, "payload", "adapter-manifest.json");
  const escapedValue = JSON.parse(await fs.readFile(escapedManifest, "utf8"));
  escapedValue.assets[0].path = `../${requiredTargets[0]}/escape`;
  await fs.writeFile(escapedManifest, JSON.stringify(escapedValue));
  await assert.rejects(() => mergePrebuiltNativeAdapters({ sourceDirectory: escaped, outputDirectory: path.join(testRoot, "escaped-out"), requiredTargets }), /invalid/i);

  if (process.platform !== "win32") {
    const linked = path.join(testRoot, "linked");
    for (const target of requiredTargets) await writeAdapter(linked, target);
    await fs.symlink("undeclared-target", path.join(linked, "unexpected-link"));
    await assert.rejects(() => mergePrebuiltNativeAdapters({ sourceDirectory: linked, outputDirectory: path.join(testRoot, "linked-out"), requiredTargets }), /symbolic link/i);
  }
});

async function writeAdapter(root, target, suffix = "") {
  const directory = path.join(root, `download-${target}${suffix}`, "payload");
  const assets = [];
  for (const relative of requiredAssetPaths(target)) {
    const bytes = Buffer.from(`adapter:${relative}`);
    await fs.mkdir(path.dirname(path.join(directory, relative)), { recursive: true });
    await fs.writeFile(path.join(directory, relative), bytes);
    assets.push({ path: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
  }
  await fs.writeFile(path.join(directory, "adapter-manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    target,
    signing: { mode: "adhoc" },
    assets,
  })}\n`);
}

function requiredAssetPaths(target) {
  if (target.startsWith("darwin-")) return [
    `${target}/LocalAppBridge.app/Contents/Info.plist`,
    `${target}/LocalAppBridge.app/Contents/MacOS/LocalAppBridge`,
    `${target}/LocalAppBridge.app/Contents/Resources/localapp-native-ipc-client.mjs`,
  ];
  if (target.startsWith("linux-")) return [`${target}/localapp-notifications`, `${target}/localapp-native-ipc-client.mjs`];
  return [`${target}/localapp-native.exe`, `${target}/localapp-native-ipc-client.mjs`];
}
