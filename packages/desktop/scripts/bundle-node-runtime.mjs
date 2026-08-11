import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const PROJECT_DIRECTORY = path.resolve(DESKTOP_DIRECTORY, "../..");
const MANIFEST_PATH = path.join(DESKTOP_DIRECTORY, "node-runtime.json");
const DEFAULT_OUTPUT_DIRECTORY = path.join(DESKTOP_DIRECTORY, "src-tauri/resources/node");
const TARGETS = {
  "win-x64": "x86_64-pc-windows-msvc",
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-gnu",
};

export function resolveRuntimeTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform === "win32" ? "win" : platform}-${arch}`;
  if (!(target in TARGETS)) throw new Error(`Unsupported Node runtime target: ${target}`);
  return target;
}

export async function bundleNodeRuntime({
  target = resolveRuntimeTarget(),
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  sourceDirectory = path.join(DESKTOP_DIRECTORY, "src-tauri/binaries"),
} = {}) {
  const triple = TARGETS[target];
  if (!triple) throw new Error(`Unsupported Node runtime target: ${target}`);
  const runtimeManifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const runtime = runtimeManifest.targets[target];
  if (!runtime || runtime.targetTriple !== triple) {
    throw new Error(`Pinned Node.js runtime manifest has no ${target} entry`);
  }
  const source = path.join(sourceDirectory, `node-${triple}${target.startsWith("win-") ? ".exe" : ""}`);
  const outputTarget = path.join(outputDirectory, target);
  const output = path.join(outputTarget, target.startsWith("win-") ? "node.exe" : "node");
  await mkdir(outputTarget, { recursive: true });
  if (!await isFile(source)) await downloadPinnedRuntime(runtime, runtimeManifest.version, target, source);
  await copyFile(source, output);
  if (!target.startsWith("win-")) await chmodExecutable(output);
  const version = await nodeVersion(output);
  if (!/^v24\./.test(version)) throw new Error(`Expected Node.js 24 runtime, received ${version}`);
  const marker = {
    schemaVersion: 1,
    target,
    targetTriple: triple,
    nodeMajor: 24,
    version: version.slice(1),
    sha256: await sha256(output),
  };
  await writeFile(path.join(outputTarget, ".node-runtime.json"), `${JSON.stringify(marker, null, 2)}\n`, { mode: 0o600 });
  return { target, output, marker: path.join(outputTarget, ".node-runtime.json") };
}

async function downloadPinnedRuntime(runtime, version, target, destination) {
  await mkdir(path.join(PROJECT_DIRECTORY, "tmp"), { recursive: true });
  const archiveDirectory = await mkdtemp(path.join(PROJECT_DIRECTORY, "tmp/desktop-node-download-"));
  const archivePath = path.join(archiveDirectory, runtime.archive);
  const extractDirectory = path.join(archiveDirectory, "extract");
  try {
    const response = await fetch(`https://nodejs.org/dist/v${version}/${runtime.archive}`);
    if (!response.ok) throw new Error(`Node.js runtime download failed with HTTP ${response.status}`);
    await writeFile(archivePath, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
    const actualSha256 = await sha256(archivePath);
    if (actualSha256 !== runtime.sha256) {
      throw new Error(`Node.js runtime checksum mismatch for ${target}`);
    }
    await mkdir(extractDirectory, { recursive: true });
    await runArchiveExtractor(archivePath, extractDirectory, target);
    const extracted = path.join(extractDirectory, target.startsWith("win-") ? "node.exe" : "bin/node");
    if (!await isFile(extracted)) throw new Error(`Downloaded Node.js runtime has no executable for ${target}`);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(extracted, destination);
  } finally {
    await rm(archiveDirectory, { recursive: true, force: true });
  }
}

function isFile(filePath) {
  return stat(filePath).then((entry) => entry.isFile()).catch(() => false);
}

function runArchiveExtractor(archivePath, extractDirectory, target) {
  const arguments_ = ["-xf", archivePath, "-C", extractDirectory, "--strip-components=1"];
  return new Promise((resolve, reject) => {
    execFile("tar", arguments_, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) reject(new Error(`Could not extract Node.js runtime: ${stderr || error.message}`));
      else resolve(target);
    });
  });
}

function chmodExecutable(filePath) {
  return import("node:fs/promises").then(({ chmod }) => chmod(filePath, 0o755));
}

function nodeVersion(executable) {
  return new Promise((resolve, reject) => {
    execFile(executable, ["--version"], { windowsHide: true }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
  });
}

async function sha256(filePath) {
  const hash = createHash("sha256");
  hash.update(await readFile(filePath));
  return hash.digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const targetFlag = process.argv.indexOf("--target");
  const target = targetFlag >= 0 ? process.argv[targetFlag + 1] : undefined;
  bundleNodeRuntime({ ...(target ? { target } : {}) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
