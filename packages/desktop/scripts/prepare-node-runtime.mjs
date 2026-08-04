import { createHash, randomUUID } from "node:crypto";
import {
  access,
  chmod,
  cp,
  copyFile,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync, inflateRawSync } from "node:zlib";

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const MANIFEST_PATH = path.join(DESKTOP_DIRECTORY, "node-runtime.json");
const DEFAULT_OUTPUT_DIRECTORY = path.join(DESKTOP_DIRECTORY, "src-tauri", "binaries");
const DEFAULT_NPM_RESOURCE_DIRECTORY = path.join(
  DESKTOP_DIRECTORY,
  "src-tauri",
  "resources",
  "npm",
);
const TARGETS = {
  "win-x64": { targetTriple: "x86_64-pc-windows-msvc", windows: true },
  "darwin-arm64": { targetTriple: "aarch64-apple-darwin", windows: false },
  "darwin-x64": { targetTriple: "x86_64-apple-darwin", windows: false },
};
const LOCK_POLL_MILLISECONDS = 20;
const LOCK_STALE_MILLISECONDS = 30_000;
const LOCK_HEARTBEAT_MILLISECONDS = 5_000;

export function resolveRuntimeTarget(platform = process.platform, arch = process.arch) {
  const target = `${platform === "win32" ? "win" : platform}-${arch}`;
  if (!(target in TARGETS)) {
    throw new Error(`Unsupported Node runtime target: ${platform}-${arch}`);
  }
  return target;
}

export function tauriBinaryName(targetTriple, windows) {
  if (!/^[a-z0-9_]+(?:-[a-z0-9_]+){2,3}$/.test(targetTriple)) {
    throw new Error(`Invalid Tauri target triple: ${targetTriple}`);
  }
  return `node-${targetTriple}${windows ? ".exe" : ""}`;
}

export async function prepareNodeRuntime({
  target = resolveRuntimeTarget(),
  manifest,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  npmResourceDirectory = outputDirectory === DEFAULT_OUTPUT_DIRECTORY
    ? DEFAULT_NPM_RESOURCE_DIRECTORY
    : undefined,
  acquireArchive,
  durabilityObserver,
  publicationFault,
  restoreFault,
} = {}) {
  const runtimeManifest = manifest ?? JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
  const runtime = validateManifestTarget(runtimeManifest, target);
  const targetDefinition = TARGETS[target];
  const binaryPath = path.join(
    outputDirectory,
    tauriBinaryName(targetDefinition.targetTriple, targetDefinition.windows),
  );
  const markerPath = `${binaryPath}.node-runtime.json`;

  await mkdir(outputDirectory, { recursive: true });
  const lockPath = `${binaryPath}.prepare.lock`;
  const journalPath = `${binaryPath}.publication.json`;
  return withPublicationLock(lockPath, async () => {
    await recoverInterruptedPublication(journalPath, durabilityObserver);
    const binaryPrepared = await isPrepared(
      binaryPath,
      markerPath,
      runtimeManifest.version,
      target,
      runtime.sha256,
    );
    const npmPrepared = !npmResourceDirectory
      || await isNpmResourcePrepared(npmResourceDirectory, runtime.sha256);
    if (binaryPrepared && npmPrepared) {
      return { binaryPath, npmResourcePath: npmResourceDirectory, prepared: false, target };
    }

    let temporaryDirectory;
    try {
      let archivePath;
      if (acquireArchive) {
        archivePath = await acquireArchive({
          archive: runtime.archive,
          url: officialArchiveUrl(runtimeManifest.version, runtime.archive),
        });
      } else {
        temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "localapp-node-runtime-"));
        archivePath = path.join(temporaryDirectory, runtime.archive);
        await downloadArchive(officialArchiveUrl(runtimeManifest.version, runtime.archive), archivePath);
      }

      const archive = await readFile(archivePath);
      const actualChecksum = sha256(archive);
      if (actualChecksum !== runtime.sha256) {
        throw new Error(
          `Node runtime SHA-256 mismatch for ${runtime.archive}: expected ${runtime.sha256}, received ${actualChecksum}`,
        );
      }

      const expectedEntry = expectedBinaryEntry(runtime.archive, targetDefinition.windows);
      const binary = extractArchiveEntry(archive, runtime.archive, expectedEntry);
      const npmEntries = npmResourceDirectory
        ? extractArchiveTree(
          archive,
          runtime.archive,
          expectedNpmPrefix(runtime.archive, targetDefinition.windows),
        )
        : [];
      await publishPreparedInstall({
        archiveSha256: runtime.sha256,
        binary,
        binaryPath,
        journalPath,
        marker: {
          archiveSha256: runtime.sha256,
          binarySha256: sha256(binary),
          target,
          version: runtimeManifest.version,
        },
        markerPath,
        npmEntries,
        npmResourceDirectory,
        durabilityObserver,
        publicationFault,
        restoreFault,
        version: runtimeManifest.version,
      });
      return { binaryPath, npmResourcePath: npmResourceDirectory, prepared: true, target };
    } finally {
      if (temporaryDirectory) {
        await rm(temporaryDirectory, { force: true, recursive: true });
      }
    }
  }, durabilityObserver);
}

async function withPublicationLock(lockPath, operation, durabilityObserver) {
  await mkdir(lockPath, { recursive: true });
  const createdAt = Date.now();
  const token = `${process.pid}-${randomUUID()}`;
  const leasePath = path.join(lockPath, `${createdAt}-${token}.lease`);
  await writeJsonAtomic(leasePath, {
    createdAt,
    pid: process.pid,
    token,
  }, durabilityObserver);
  const heartbeat = setInterval(() => {
    const now = new Date();
    void utimes(leasePath, now, now).catch(() => {});
  }, LOCK_HEARTBEAT_MILLISECONDS);
  heartbeat.unref?.();
  try {
    for (;;) {
      const leases = await activeLeasePaths(lockPath);
      if (leases[0] === leasePath) break;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MILLISECONDS));
    }
    return await operation();
  } finally {
    clearInterval(heartbeat);
    await rm(leasePath, { force: true });
    await syncDirectory(lockPath, durabilityObserver, "directory_sync_after_unlink");
  }
}

async function activeLeasePaths(lockPath) {
  const names = await readdir(lockPath);
  const leases = [];
  for (const name of names) {
    if (!name.endsWith(".lease")) continue;
    const leasePath = path.join(lockPath, name);
    if (await leaseIsActive(leasePath, name)) leases.push(leasePath);
  }
  return leases.sort();
}

async function leaseIsActive(leasePath, name) {
  try {
    const [metadata, leaseStat] = await Promise.all([
      readFile(leasePath, "utf8").then(JSON.parse),
      stat(leasePath),
    ]);
    const valid = Number.isSafeInteger(metadata.createdAt)
      && metadata.createdAt > 0
      && Number.isSafeInteger(metadata.pid)
      && metadata.pid > 0
      && typeof metadata.token === "string"
      && metadata.token.startsWith(`${metadata.pid}-`)
      && name === `${metadata.createdAt}-${metadata.token}.lease`;
    const fresh = Date.now() - leaseStat.mtimeMs <= LOCK_STALE_MILLISECONDS;
    if (valid && fresh && processIsAlive(metadata.pid)) return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
  }
  await rm(leasePath, { force: true });
  return false;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function publishPreparedInstall({
  archiveSha256,
  binary,
  binaryPath,
  journalPath,
  marker,
  markerPath,
  npmEntries,
  npmResourceDirectory,
  durabilityObserver,
  publicationFault,
  restoreFault,
  version,
}) {
  const publicationId = `${process.pid}-${randomUUID()}`;
  const snapshot = {
    binary: `${binaryPath}.${publicationId}.previous`,
    binaryExisted: await fileExists(binaryPath),
    marker: `${markerPath}.${publicationId}.previous`,
    markerExisted: await fileExists(markerPath),
    npm: npmResourceDirectory ? `${npmResourceDirectory}.${publicationId}.previous` : null,
    npmExisted: npmResourceDirectory ? await fileExists(npmResourceDirectory) : false,
  };

  if (snapshot.binaryExisted) await durableCopyFile(binaryPath, snapshot.binary, durabilityObserver);
  if (snapshot.markerExisted) await durableCopyFile(markerPath, snapshot.marker, durabilityObserver);
  if (snapshot.npmExisted) {
    await cp(npmResourceDirectory, snapshot.npm, { recursive: true });
    await syncTree(snapshot.npm, durabilityObserver);
  }
  await writeJsonAtomic(journalPath, {
    binaryPath,
    markerPath,
    npmResourceDirectory,
    snapshot,
  }, durabilityObserver);

  let publicationSucceeded = false;
  try {
    if (npmResourceDirectory) {
      await publishNpmResource({
        archiveSha256,
        entries: npmEntries,
        npmResourceDirectory,
        version,
        durabilityObserver,
        beforePublish: () => publicationFault?.("after_staging"),
      });
      publicationFault?.("after_npm_publish");
    } else {
      publicationFault?.("after_staging");
    }
    await publishPreparedRuntime({
      binary,
      binaryPath,
      marker,
      markerPath,
      durabilityObserver,
      publicationFault,
    });
    await durableRemove(journalPath, durabilityObserver);
    publicationSucceeded = true;
  } catch (error) {
    await restorePublication({
      binaryPath,
      markerPath,
      npmResourceDirectory,
      snapshot,
    }, durabilityObserver, restoreFault);
    await durableRemove(journalPath, durabilityObserver);
    await cleanupSnapshot(snapshot);
    throw error;
  } finally {
    if (publicationSucceeded) await cleanupSnapshot(snapshot);
  }
}

async function recoverInterruptedPublication(journalPath, durabilityObserver) {
  try {
    const journal = JSON.parse(await readFile(journalPath, "utf8"));
    await restorePublication(journal, durabilityObserver);
    await durableRemove(journalPath, durabilityObserver);
    await cleanupSnapshot(journal.snapshot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function restorePublication(
  { binaryPath, markerPath, npmResourceDirectory, snapshot },
  durabilityObserver,
  restoreFault,
) {
  restoreFault?.("before_restore_binary");
  await restoreFile(binaryPath, snapshot.binary, snapshot.binaryExisted, durabilityObserver);
  restoreFault?.("before_restore_marker");
  await restoreFile(markerPath, snapshot.marker, snapshot.markerExisted, durabilityObserver);
  if (npmResourceDirectory) {
    restoreFault?.("before_restore_npm");
    await rm(npmResourceDirectory, { force: true, recursive: true });
    if (snapshot.npmExisted) {
      await cp(snapshot.npm, npmResourceDirectory, { recursive: true });
      await syncTree(npmResourceDirectory, durabilityObserver);
    }
    await syncDirectory(path.dirname(npmResourceDirectory), durabilityObserver);
  }
}

async function restoreFile(destination, snapshotPath, existed, durabilityObserver) {
  if (!existed) {
    await durableRemove(destination, durabilityObserver);
    return;
  }
  const temporary = `${destination}.${process.pid}-${randomUUID()}.restore`;
  await durableCopyFile(snapshotPath, temporary, durabilityObserver);
  await durableRename(temporary, destination, durabilityObserver);
}

async function cleanupSnapshot(snapshot) {
  await Promise.all([
    rm(snapshot.binary, { force: true }),
    rm(snapshot.marker, { force: true }),
    snapshot.npm ? rm(snapshot.npm, { force: true, recursive: true }) : Promise.resolve(),
  ]);
}

async function fileExists(candidate) {
  try {
    await access(candidate);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writeJsonAtomic(destination, value, durabilityObserver) {
  const temporary = `${destination}.${process.pid}-${randomUUID()}.tmp`;
  try {
    await durableWriteFile(
      temporary,
      `${JSON.stringify(value)}\n`,
      { flag: "wx" },
      durabilityObserver,
    );
    await durableRename(temporary, destination, durabilityObserver);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function isNpmResourcePrepared(resourceDirectory, archiveSha256) {
  try {
    const marker = JSON.parse(
      await readFile(path.join(resourceDirectory, ".localapp-npm-resource.json"), "utf8"),
    );
    if (marker.archiveSha256 !== archiveSha256) return false;
    const packageJson = JSON.parse(
      await readFile(path.join(resourceDirectory, "package.json"), "utf8"),
    );
    await readFile(path.join(resourceDirectory, "bin", "npm-cli.js"));
    return packageJson.name === "npm";
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

async function publishNpmResource({
  archiveSha256,
  entries,
  npmResourceDirectory,
  version,
  durabilityObserver,
  beforePublish,
}) {
  if (entries.length === 0) throw new Error("Node runtime archive does not contain npm resources");
  const publicationId = `${process.pid}-${randomUUID()}`;
  const temporaryDirectory = `${npmResourceDirectory}.${publicationId}.tmp`;
  const backupDirectory = `${npmResourceDirectory}.${publicationId}.backup`;
  let movedPrior = false;

  try {
    await mkdir(temporaryDirectory, { recursive: true });
    for (const entry of entries) {
      const destination = path.join(temporaryDirectory, entry.relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await durableWriteFile(destination, entry.data, { mode: entry.mode }, durabilityObserver);
    }
    const packageJson = JSON.parse(
      await readFile(path.join(temporaryDirectory, "package.json"), "utf8"),
    );
    await readFile(path.join(temporaryDirectory, "bin", "npm-cli.js"));
    if (packageJson.name !== "npm") throw new Error("Bundled npm package metadata is invalid");
    await durableWriteFile(
      path.join(temporaryDirectory, ".localapp-npm-resource.json"),
      `${JSON.stringify({ archiveSha256, nodeVersion: version }, null, 2)}\n`,
      {},
      durabilityObserver,
    );
    await syncTree(temporaryDirectory, durabilityObserver);

    beforePublish?.();

    try {
      await durableRename(npmResourceDirectory, backupDirectory, durabilityObserver);
      movedPrior = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await durableRename(temporaryDirectory, npmResourceDirectory, durabilityObserver);
    if (movedPrior) await rm(backupDirectory, { force: true, recursive: true });
  } catch (error) {
    if (movedPrior) {
      await rm(npmResourceDirectory, { force: true, recursive: true }).catch(() => {});
      await durableRename(backupDirectory, npmResourceDirectory, durabilityObserver).catch(() => {});
    }
    throw error;
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
    await rm(backupDirectory, { force: true, recursive: true });
  }
}

export async function publishPreparedRuntime({
  binary,
  binaryPath,
  durabilityObserver,
  marker,
  markerPath,
  publicationFault,
}) {
  const publicationId = `${process.pid}-${randomUUID()}`;
  const temporaryBinary = `${binaryPath}.${publicationId}.tmp`;
  const temporaryMarker = `${markerPath}.${publicationId}.tmp`;

  try {
    await durableWriteFile(
      temporaryBinary,
      binary,
      { flag: "wx", mode: 0o755 },
      durabilityObserver,
    );
    await chmod(temporaryBinary, 0o755);
    await syncFile(temporaryBinary, durabilityObserver);
    await durableWriteFile(
      temporaryMarker,
      `${JSON.stringify(marker, null, 2)}\n`,
      { flag: "wx" },
      durabilityObserver,
    );
    await durableRename(temporaryMarker, markerPath, durabilityObserver);
    publicationFault?.("after_marker_publish");
    await durableRename(temporaryBinary, binaryPath, durabilityObserver);
    publicationFault?.("after_binary_publish");
  } finally {
    await Promise.all([
      rm(temporaryBinary, { force: true }),
      rm(temporaryMarker, { force: true }),
    ]);
  }
}

async function durableWriteFile(destination, data, options = {}, durabilityObserver) {
  const handle = await open(destination, options.flag ?? "w", options.mode);
  try {
    await handle.writeFile(data);
    await handle.sync();
    durabilityObserver?.("file_sync", destination);
  } finally {
    await handle.close();
  }
}

async function durableCopyFile(source, destination, durabilityObserver) {
  await copyFile(source, destination);
  await syncFile(destination, durabilityObserver);
  await syncDirectory(path.dirname(destination), durabilityObserver);
}

async function syncFile(candidate, durabilityObserver) {
  const handle = await open(candidate, "r");
  try {
    await handle.sync();
    durabilityObserver?.("file_sync", candidate);
  } finally {
    await handle.close();
  }
}

async function syncTree(directory, durabilityObserver) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    if (entry.isDirectory()) await syncTree(candidate, durabilityObserver);
    else if (entry.isFile()) await syncFile(candidate, durabilityObserver);
  }
  await syncDirectory(directory, durabilityObserver);
}

async function durableRename(source, destination, durabilityObserver) {
  const directories = [...new Set([path.dirname(source), path.dirname(destination)])];
  for (const directory of directories) {
    await syncDirectory(directory, durabilityObserver, "directory_sync_before_rename");
  }
  await rename(source, destination);
  for (const directory of directories) {
    await syncDirectory(directory, durabilityObserver, "directory_sync_after_rename");
  }
}

async function durableRemove(destination, durabilityObserver) {
  await rm(destination, { force: true });
  await syncDirectory(path.dirname(destination), durabilityObserver, "directory_sync_after_unlink");
}

async function syncDirectory(directory, durabilityObserver, event = "directory_sync") {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
    durabilityObserver?.(event, directory);
  } catch (error) {
    const unsupportedOnWindows = process.platform === "win32"
      && ["EBADF", "EISDIR", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code);
    if (!unsupportedOnWindows) throw error;
    durabilityObserver?.("directory_sync_unsupported", directory);
  } finally {
    await handle?.close();
  }
}

function validateManifestTarget(manifest, target) {
  if (!/^\d+\.\d+\.\d+$/.test(manifest?.version ?? "")) {
    throw new Error("Node runtime manifest has an invalid version");
  }
  const targetDefinition = TARGETS[target];
  if (!targetDefinition) {
    throw new Error(`Unknown Node runtime target: ${target}`);
  }
  const runtime = manifest.targets?.[target];
  if (!runtime) {
    throw new Error(`Node runtime manifest does not define target: ${target}`);
  }
  const extension = targetDefinition.windows ? "zip" : "tar.gz";
  const expectedArchive = `node-v${manifest.version}-${target}.${extension}`;
  if (runtime.archive !== expectedArchive) {
    throw new Error(`Unexpected Node runtime archive for ${target}: ${runtime.archive}`);
  }
  if (runtime.targetTriple !== targetDefinition.targetTriple) {
    throw new Error(`Unexpected Tauri target triple for ${target}: ${runtime.targetTriple}`);
  }
  if (!/^[a-f0-9]{64}$/.test(runtime.sha256 ?? "")) {
    throw new Error(`Invalid SHA-256 for Node runtime target: ${target}`);
  }
  return runtime;
}

function officialArchiveUrl(version, archive) {
  return `https://nodejs.org/dist/v${version}/${archive}`;
}

async function downloadArchive(url, destination) {
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) {
    throw new Error(`Failed to download Node runtime (${response.status} ${response.statusText})`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function isPrepared(binaryPath, markerPath, version, target, archiveSha256) {
  try {
    const marker = JSON.parse(await readFile(markerPath, "utf8"));
    if (
      marker.version !== version ||
      marker.target !== target ||
      marker.archiveSha256 !== archiveSha256 ||
      !/^[a-f0-9]{64}$/.test(marker.binarySha256 ?? "")
    ) {
      return false;
    }
    return sha256(await readFile(binaryPath)) === marker.binarySha256;
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return false;
    throw error;
  }
}

function expectedBinaryEntry(archiveName, windows) {
  const root = archiveName.replace(/\.(?:tar\.gz|zip)$/, "");
  return windows ? `${root}/node.exe` : `${root}/bin/node`;
}

function expectedNpmPrefix(archiveName, windows) {
  const root = archiveName.replace(/\.(?:tar\.gz|zip)$/, "");
  return windows
    ? `${root}/node_modules/npm/`
    : `${root}/lib/node_modules/npm/`;
}

function extractArchiveTree(archive, archiveName, prefix) {
  const entries = archiveName.endsWith(".tar.gz")
    ? readTarEntries(gunzipSync(archive))
    : archiveName.endsWith(".zip")
      ? readZipEntries(archive)
      : null;
  if (!entries) throw new Error(`Unsupported Node runtime archive: ${archiveName}`);
  return entries
    .filter((entry) => entry.name.startsWith(prefix) && entry.name.length > prefix.length)
    .map((entry) => ({
      data: entry.data,
      mode: entry.mode,
      relativePath: entry.name.slice(prefix.length),
    }));
}

function extractArchiveEntry(archive, archiveName, expectedEntry) {
  if (archiveName.endsWith(".tar.gz")) {
    return extractTarEntry(gunzipSync(archive), expectedEntry);
  }
  if (archiveName.endsWith(".zip")) {
    return extractZipEntry(archive, expectedEntry);
  }
  throw new Error(`Unsupported Node runtime archive: ${archiveName}`);
}

function extractTarEntry(archive, expectedEntry) {
  const entry = readTarEntries(archive).find(({ name }) => name === expectedEntry);
  if (!entry) throw new Error(`Node runtime binary is missing from archive: ${expectedEntry}`);
  return entry.data;
}

function readTarEntries(archive) {
  const entries = [];
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const entryName = prefix ? `${prefix}/${name}` : name;
    assertSafeArchivePath(entryName);
    const size = parseTarOctal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156] || 0x30);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error("Truncated tar archive entry");
    if (type === "0") {
      entries.push({
        data: Buffer.from(archive.subarray(dataStart, dataEnd)),
        mode: parseTarMode(header.subarray(100, 108)),
        name: entryName,
      });
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function tarString(header, offset, length) {
  const field = header.subarray(offset, offset + length);
  const end = field.indexOf(0);
  return field.subarray(0, end === -1 ? field.length : end).toString("utf8");
}

function parseTarOctal(field) {
  const value = field.toString("ascii").replace(/\0.*$/, "").trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("Invalid tar archive size");
  return Number.parseInt(value, 8);
}

function parseTarMode(field) {
  return parseTarOctal(field) & 0o777;
}

function extractZipEntry(archive, expectedEntry) {
  const entry = readZipEntries(archive).find(({ name }) => name === expectedEntry);
  if (!entry) throw new Error(`Node runtime binary is missing from archive: ${expectedEntry}`);
  return entry.data;
}

function readZipEntries(archive) {
  const endOffset = findZipEnd(archive);
  const entries = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  let offset = archive.readUInt32LE(endOffset + 16);
  const centralEnd = offset + centralSize;
  const result = [];

  for (let index = 0; index < entries; index += 1) {
    requireRange(archive, offset, 46, "Truncated zip central directory");
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Invalid zip central directory entry");
    }
    const flags = archive.readUInt16LE(offset + 8);
    const method = archive.readUInt16LE(offset + 10);
    const expectedCrc = archive.readUInt32LE(offset + 16);
    const compressedSize = archive.readUInt32LE(offset + 20);
    const uncompressedSize = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const localOffset = archive.readUInt32LE(offset + 42);
    requireRange(archive, offset + 46, nameLength + extraLength + commentLength, "Truncated zip entry");
    const entryName = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assertSafeArchivePath(entryName);

    if (!entryName.endsWith("/")) {
      if (flags & 1) throw new Error("Encrypted Node runtime archives are not supported");
      requireRange(archive, localOffset, 30, "Truncated zip local header");
      if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
        throw new Error("Invalid zip local header");
      }
      const localNameLength = archive.readUInt16LE(localOffset + 26);
      const localExtraLength = archive.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      requireRange(archive, dataStart, compressedSize, "Truncated zip file data");
      const compressed = archive.subarray(dataStart, dataStart + compressedSize);
      const data = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
      if (!data) throw new Error(`Unsupported zip compression method: ${method}`);
      if (data.length !== uncompressedSize || crc32(data) !== expectedCrc) {
        throw new Error(`Corrupt zip entry: ${entryName}`);
      }
      result.push({ data, mode: 0o644, name: entryName });
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (offset !== centralEnd) throw new Error("Invalid zip central directory size");
  return result;
}

function findZipEnd(archive) {
  const minimum = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimum; offset -= 1) {
    if (archive.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid zip archive: end record not found");
}

function requireRange(buffer, offset, length, message) {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new Error(message);
}

function assertSafeArchivePath(entryName) {
  if (
    !entryName ||
    entryName.includes("\0") ||
    entryName.includes("\\") ||
    entryName.startsWith("/") ||
    /^[a-zA-Z]:/.test(entryName) ||
    entryName.split("/").includes("..")
  ) {
    throw new Error(`Unsafe archive path: ${entryName}`);
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function main() {
  const target = parseTargetArgument(process.argv.slice(2)) ?? resolveRuntimeTarget();
  const result = await prepareNodeRuntime({ target });
  const action = result.prepared ? "Prepared" : "Already prepared";
  console.log(`${action} Node.js ${target} runtime at ${result.binaryPath}`);
}

function parseTargetArgument(arguments_) {
  if (arguments_.length === 0) return undefined;
  if (arguments_.length === 2 && arguments_[0] === "--target") return arguments_[1];
  throw new Error("Usage: node scripts/prepare-node-runtime.mjs [--target <target>]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
