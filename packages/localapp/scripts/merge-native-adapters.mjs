import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const DIGEST = /^[0-9a-f]{64}$/;
const TARGET = /^(?:darwin|linux|win32)-(?:arm64|x64)$/;

export async function mergePrebuiltNativeAdapters({ sourceDirectory, outputDirectory, requiredTargets }) {
  const source = path.resolve(sourceDirectory);
  const output = path.resolve(outputDirectory);
  const required = [...requiredTargets].sort();
  if (required.length === 0 || new Set(required).size !== required.length || required.some((target) => !TARGET.test(target))) {
    throw new Error("native adapter matrix is invalid");
  }
  const { manifestPaths, files: sourceFiles } = await findManifests(source);
  const adapters = [];
  const seen = new Set();
  const declaredFiles = new Set();
  for (const manifestPath of manifestPaths) {
    const adapter = await inspectAdapter(path.dirname(manifestPath), manifestPath);
    if (seen.has(adapter.target)) throw new Error(`duplicate native adapter target: ${adapter.target}`);
    seen.add(adapter.target);
    declaredFiles.add(manifestPath);
    for (const asset of adapter.assets) declaredFiles.add(path.join(path.dirname(manifestPath), ...asset.path.split("/")));
    adapters.push(adapter);
  }
  if (sourceFiles.length !== declaredFiles.size || sourceFiles.some((file) => !declaredFiles.has(file))) {
    throw new Error("native adapter downloads contain undeclared extra files");
  }
  adapters.sort((left, right) => left.target.localeCompare(right.target));
  if (adapters.length !== required.length || adapters.some((adapter, index) => adapter.target !== required[index])) {
    throw new Error(`native adapter matrix is incomplete: expected ${required.join(",")}`);
  }

  await fs.rm(output, { recursive: true, force: true });
  await fs.mkdir(output, { recursive: true, mode: 0o755 });
  for (const adapter of adapters) {
    for (const asset of adapter.assets) {
      const destination = path.join(output, ...asset.path.split("/"));
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      await fs.writeFile(destination, asset.bytes, { mode: 0o755, flag: "wx" });
    }
  }
  const manifest = {
    schemaVersion: 2,
    adapters: adapters.map(({ target, signing, assets }) => ({
      target,
      signing,
      assets: assets.map(({ path: assetPath, sha256 }) => ({ path: assetPath, sha256 })),
    })),
  };
  await fs.writeFile(path.join(output, "adapter-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  return manifest;
}

async function findManifests(root) {
  const found = [];
  const files = [];
  const visit = async (directory) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`native adapter input contains a symbolic link: ${absolute}`);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name === "adapter-manifest.json") { found.push(absolute); files.push(absolute); }
      else if (entry.isFile()) files.push(absolute);
      else if (!entry.isFile()) throw new Error(`native adapter input contains an unsupported entry: ${absolute}`);
    }
  };
  await visit(root);
  return { manifestPaths: found.sort(), files: files.sort() };
}

async function inspectAdapter(root, manifestPath) {
  const value = JSON.parse(await readRegular(manifestPath).then((bytes) => bytes.toString("utf8")));
  if (!record(value) || !exactKeys(value, ["schemaVersion", "target", "signing", "assets"])
    || value.schemaVersion !== 1 || typeof value.target !== "string" || !TARGET.test(value.target)
    || !record(value.signing) || !exactKeys(value.signing, ["mode"])
    || (value.signing.mode !== "adhoc" && value.signing.mode !== "release")
    || !Array.isArray(value.assets) || value.assets.length === 0) {
    throw new Error(`native adapter manifest is invalid: ${manifestPath}`);
  }
  const assets = [];
  for (const asset of value.assets) {
    if (!record(asset) || !exactKeys(asset, ["path", "sha256"])
      || typeof asset.path !== "string" || !safeRelative(asset.path) || !asset.path.startsWith(`${value.target}/`)
      || typeof asset.sha256 !== "string" || !DIGEST.test(asset.sha256)) {
      throw new Error(`native adapter manifest asset is invalid: ${manifestPath}`);
    }
    const bytes = await readRegular(path.join(root, ...asset.path.split("/")));
    if (crypto.createHash("sha256").update(bytes).digest("hex") !== asset.sha256) {
      throw new Error(`native adapter digest mismatch: ${asset.path}`);
    }
    assets.push({ path: asset.path, sha256: asset.sha256, bytes });
  }
  assets.sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(assets.map((asset) => asset.path)).size !== assets.length) throw new Error(`duplicate native adapter asset: ${manifestPath}`);
  for (const required of requiredAssets(value.target)) {
    if (!assets.some((asset) => asset.path === required)) throw new Error(`native adapter required asset is missing: ${required}`);
  }
  const observed = await listFiles(root);
  const expected = ["adapter-manifest.json", ...assets.map((asset) => asset.path)].sort();
  if (observed.length !== expected.length || observed.some((entry, index) => entry !== expected[index])) {
    throw new Error(`native adapter tree contains undeclared files: ${manifestPath}`);
  }
  return { target: value.target, signing: { mode: value.signing.mode }, assets };
}

async function listFiles(root) {
  const files = [];
  const visit = async (directory, prefix) => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (!safeRelative(relative) || entry.isSymbolicLink()) throw new Error(`unsafe native adapter entry: ${relative}`);
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relative);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`unsupported native adapter entry: ${relative}`);
    }
  };
  await visit(root, "");
  return files.sort();
}

async function readRegular(filePath) {
  const before = await fs.lstat(filePath);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`native adapter asset is unsafe: ${filePath}`);
  const bytes = await fs.readFile(filePath);
  const after = await fs.lstat(filePath);
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
    throw new Error(`native adapter asset changed while reading: ${filePath}`);
  }
  return bytes;
}

function safeRelative(value) {
  return value.length > 0 && value.length <= 512 && !value.includes("\\") && !value.startsWith("/") && !value.endsWith("/")
    && path.posix.normalize(value) === value && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function record(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function exactKeys(value, expected) {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function requiredAssets(target) {
  if (target.startsWith("darwin-")) return [
    `${target}/LocalAppBridge.app/Contents/Info.plist`,
    `${target}/LocalAppBridge.app/Contents/MacOS/LocalAppBridge`,
    `${target}/LocalAppBridge.app/Contents/Resources/localapp-native-ipc-client.mjs`,
  ];
  if (target.startsWith("linux-")) return [`${target}/localapp-notifications`, `${target}/localapp-native-ipc-client.mjs`];
  return [`${target}/localapp-native.exe`, `${target}/localapp-native-ipc-client.mjs`];
}
