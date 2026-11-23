import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const version = "24.19.0";
const targets = {
  "darwin-arm64": ["darwin-arm64.tar.gz", "8294b7aa9b03997481c06babf1e8b270c859358f27da57a11509afe537ac381d"],
  "win32-x64": ["win-x64.zip", "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73"],
};

export async function stageNodeRuntime(staging, cache, platform, arch) {
  const target = targets[`${platform}-${arch}`];
  if (!target) throw new Error(`Unsupported desktop runtime: ${platform}-${arch}`);
  const [suffix, expectedSha] = target;
  const filename = `node-v${version}-${suffix}`;
  const archivePath = path.join(cache, filename);
  let bytes;
  try { bytes = await readFile(archivePath); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(`https://nodejs.org/dist/v${version}/${filename}`, {
      redirect: "error", signal: AbortSignal.timeout(600000),
    });
    if (!response.ok) throw new Error(`Cannot download Node.js runtime: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== expectedSha) {
    throw new Error(`Node.js runtime checksum mismatch: ${filename}`);
  }
  await mkdir(cache, { recursive: true });
  await writeFile(archivePath, bytes);
  const unpacked = path.join(staging, "node-extract");
  await mkdir(unpacked);
  await promisify(execFile)("tar", ["-xf", archivePath, "-C", unpacked]);
  const distributable = path.join(unpacked, filename.replace(/(?:\.tar\.gz|\.zip)$/, ""));
  const output = path.join(staging, "node-runtime");
  await mkdir(output);
  await cp(path.join(distributable, platform === "win32" ? "node.exe" : "bin/node"),
    path.join(output, platform === "win32" ? "node.exe" : "node"));
  await cp(path.join(distributable, "LICENSE"), path.join(output, "LICENSE"));
  await rm(unpacked, { recursive: true, force: true });
}
