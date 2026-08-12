import crypto from "node:crypto";
import fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { lifecycleError } from "../errors.js";
import type { RuntimeLayout } from "./runtime-layout.js";

export interface ReleaseArtifactFile {
  path: string;
  size: number;
  sha256: string;
}

export interface ReleaseArtifactManifest {
  schemaVersion: 2;
  name: "localapp";
  version: string;
  nodeMajor: number;
  entrypoint: string;
  bootstrapEntrypoint: string;
  files: ReleaseArtifactFile[];
  artifactDigest: string;
  bundleDigest?: string;
  serverBundleDigest?: string;
  serverEntrypoint?: string;
}

export interface CurrentRelease {
  version: string;
  artifactDigest: string;
  releasePath: string;
  entrypoint: string;
  bootstrapEntrypoint: string;
}

export interface PublishReleaseOptions {
  sourceDirectory: string;
  layout: RuntimeLayout;
  lockTimeoutMs?: number;
}

interface InspectedArtifact {
  manifest: ReleaseArtifactManifest;
  files: Map<string, Buffer>;
  manifestBytes: Buffer;
}

const DIGEST = /^[0-9a-f]{64}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/;

export async function verifyReleaseArtifact(directory: string): Promise<ReleaseArtifactManifest> {
  return (await inspectReleaseArtifact(path.resolve(directory))).manifest;
}

export async function publishRelease(options: PublishReleaseOptions): Promise<CurrentRelease> {
  const sourceDirectory = path.resolve(options.sourceDirectory);
  const inspected = await inspectReleaseArtifact(sourceDirectory);
  return withReleaseLock(options.layout, options.lockTimeoutMs ?? 5_000, async () => {
    await ensurePrivateDirectories(options.layout);
    const releaseName = `${inspected.manifest.version}-${inspected.manifest.artifactDigest}`;
    const releasePath = path.join(options.layout.releasesDir, releaseName);
    const existing = await lstatOptional(releasePath);
    if (existing === undefined) {
      await publishImmutableDirectory(releasePath, inspected, options.layout.releasesDir);
    } else {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw invalidArtifact();
      const verified = await inspectReleaseArtifact(releasePath);
      if (verified.manifest.artifactDigest !== inspected.manifest.artifactDigest) throw invalidArtifact();
    }
    const current: CurrentRelease = {
      version: inspected.manifest.version,
      artifactDigest: inspected.manifest.artifactDigest,
      releasePath,
      entrypoint: inspected.manifest.entrypoint,
      bootstrapEntrypoint: inspected.manifest.bootstrapEntrypoint,
    };
    const launcherBytes = await readRegularFile(path.join(releasePath, ...inspected.manifest.bootstrapEntrypoint.split("/")));
    await writeAtomic(options.layout.launcherPath, launcherBytes, 0o700);
    await writeAtomic(options.layout.currentManifestPath, Buffer.from(`${JSON.stringify(current, null, 2)}\n`), 0o600);
    return current;
  });
}

export async function readCurrentRelease(layout: RuntimeLayout): Promise<CurrentRelease> {
  let value: unknown;
  try {
    value = JSON.parse((await readRegularFile(layout.currentManifestPath)).toString("utf8"));
  } catch {
    throw lifecycleError("release_current_invalid", "The current LocalApp release manifest is missing or invalid");
  }
  if (!isRecord(value) || !hasExactKeys(value, ["version", "artifactDigest", "releasePath", "entrypoint", "bootstrapEntrypoint"])
    || typeof value.version !== "string" || !VERSION.test(value.version)
    || typeof value.artifactDigest !== "string" || !DIGEST.test(value.artifactDigest)
    || typeof value.releasePath !== "string" || typeof value.entrypoint !== "string"
    || typeof value.bootstrapEntrypoint !== "string") {
    throw lifecycleError("release_current_invalid", "The current LocalApp release manifest is missing or invalid");
  }
  const expectedPath = path.join(layout.releasesDir, `${value.version}-${value.artifactDigest}`);
  if (path.resolve(value.releasePath) !== path.resolve(expectedPath)
    || !isSafeRelativeFile(value.entrypoint) || !isSafeRelativeFile(value.bootstrapEntrypoint)) {
    throw lifecycleError("release_current_invalid", "The current LocalApp release manifest is missing or invalid");
  }
  return {
    version: value.version,
    artifactDigest: value.artifactDigest,
    releasePath: expectedPath,
    entrypoint: value.entrypoint,
    bootstrapEntrypoint: value.bootstrapEntrypoint,
  };
}

async function inspectReleaseArtifact(directory: string): Promise<InspectedArtifact> {
  try {
    const root = await fs.lstat(directory);
    if (!root.isDirectory() || root.isSymbolicLink()) throw invalidArtifact();
    const manifestPath = path.join(directory, ".localapp-artifact.json");
    const manifestBytes = await readRegularFile(manifestPath);
    const manifest = parseArtifactManifest(JSON.parse(manifestBytes.toString("utf8")));
    const observed = await listArtifactFiles(directory);
    const expected = new Set(manifest.files.map((file) => file.path));
    if (observed.size !== expected.size || [...observed].some((relativePath) => !expected.has(relativePath))) {
      throw invalidArtifact();
    }
    const files = new Map<string, Buffer>();
    for (const entry of manifest.files) {
      const bytes = await readRegularFile(path.join(directory, ...entry.path.split("/")));
      if (bytes.byteLength !== entry.size || sha256(bytes) !== entry.sha256) throw invalidArtifact();
      files.set(entry.path, bytes);
    }
    return { manifest, files, manifestBytes };
  } catch (error) {
    if (isErrorCode(error, "release_artifact_invalid")) throw error;
    throw invalidArtifact();
  }
}

function parseArtifactManifest(value: unknown): ReleaseArtifactManifest {
  if (!isRecord(value)) throw invalidArtifact();
  const allowed = new Set([
    "schemaVersion", "name", "version", "nodeMajor", "entrypoint", "bootstrapEntrypoint",
    "files", "artifactDigest", "bundleDigest", "serverBundleDigest",
    "serverEntrypoint",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))
    || value.schemaVersion !== 2 || value.name !== "localapp"
    || typeof value.version !== "string" || !VERSION.test(value.version)
    || value.nodeMajor !== 24
    || typeof value.entrypoint !== "string" || !isSafeRelativeFile(value.entrypoint)
    || typeof value.bootstrapEntrypoint !== "string" || !isSafeRelativeFile(value.bootstrapEntrypoint)
    || !Array.isArray(value.files) || value.files.length === 0
    || typeof value.artifactDigest !== "string" || !DIGEST.test(value.artifactDigest)
    || (value.bundleDigest !== undefined && (typeof value.bundleDigest !== "string" || !DIGEST.test(value.bundleDigest)))
    || (value.serverBundleDigest !== undefined && (typeof value.serverBundleDigest !== "string" || !DIGEST.test(value.serverBundleDigest)))
    || (value.serverEntrypoint !== undefined && (typeof value.serverEntrypoint !== "string" || !isSafeRelativeFile(value.serverEntrypoint)))) {
    throw invalidArtifact();
  }
  const files = value.files.map(parseArtifactFile);
  const canonical = [...files].sort(compareArtifactFiles);
  if (canonical.some((entry, index) => entry.path !== files[index]?.path)
    || new Set(files.map((entry) => entry.path)).size !== files.length
    || !files.some((entry) => entry.path === value.entrypoint)
    || !files.some((entry) => entry.path === value.bootstrapEntrypoint)
    || (typeof value.serverEntrypoint === "string" && !files.some((entry) => entry.path === value.serverEntrypoint))) throw invalidArtifact();
  const descriptor = {
    schemaVersion: 2 as const,
    name: "localapp" as const,
    version: value.version,
    nodeMajor: 24,
    entrypoint: value.entrypoint,
    bootstrapEntrypoint: value.bootstrapEntrypoint,
    files,
    ...(typeof value.bundleDigest === "string" ? { bundleDigest: value.bundleDigest } : {}),
    ...(typeof value.serverBundleDigest === "string" ? { serverBundleDigest: value.serverBundleDigest } : {}),
    ...(typeof value.serverEntrypoint === "string" ? { serverEntrypoint: value.serverEntrypoint } : {}),
  };
  if (sha256(Buffer.from(JSON.stringify(descriptor))) !== value.artifactDigest) throw invalidArtifact();
  return { ...descriptor, artifactDigest: value.artifactDigest };
}

function parseArtifactFile(value: unknown): ReleaseArtifactFile {
  if (!isRecord(value) || !hasExactKeys(value, ["path", "size", "sha256"])
    || typeof value.path !== "string" || !isSafeRelativeFile(value.path) || value.path === ".localapp-artifact.json"
    || typeof value.size !== "number" || !Number.isSafeInteger(value.size) || value.size < 0
    || typeof value.sha256 !== "string" || !DIGEST.test(value.sha256)) throw invalidArtifact();
  return { path: value.path, size: value.size, sha256: value.sha256 };
}

async function listArtifactFiles(root: string): Promise<Set<string>> {
  const files = new Set<string>();
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (relativePath === ".localapp-artifact.json") continue;
      if (!isSafeRelativeFile(relativePath)) throw invalidArtifact();
      if (entry.isSymbolicLink()) throw invalidArtifact();
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), relativePath);
      else if (entry.isFile()) files.add(relativePath);
      else throw invalidArtifact();
    }
  };
  await visit(root, "");
  return files;
}

async function publishImmutableDirectory(
  releasePath: string,
  inspected: InspectedArtifact,
  releasesDirectory: string,
): Promise<void> {
  const staging = await fs.mkdtemp(path.join(releasesDirectory, ".release-stage-"));
  if (process.platform !== "win32") await fs.chmod(staging, 0o700);
  try {
    for (const [relativePath, bytes] of inspected.files) {
      const destination = path.join(staging, ...relativePath.split("/"));
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      await fs.writeFile(destination, bytes, { flag: "wx", mode: relativePath === inspected.manifest.entrypoint ? 0o700 : 0o600 });
    }
    await fs.writeFile(path.join(staging, ".localapp-artifact.json"), inspected.manifestBytes, { flag: "wx", mode: 0o600 });
    await inspectReleaseArtifact(staging);
    try {
      await fs.rename(staging, releasePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" && (error as NodeJS.ErrnoException).code !== "ENOTEMPTY") throw error;
      const existing = await inspectReleaseArtifact(releasePath);
      if (existing.manifest.artifactDigest !== inspected.manifest.artifactDigest) throw invalidArtifact();
    }
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}

async function ensurePrivateDirectories(layout: RuntimeLayout): Promise<void> {
  for (const directory of [layout.supportDir, layout.releasesDir, layout.logsDir, layout.runtimeDir, path.dirname(layout.launcherPath)]) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") await fs.chmod(directory, 0o700);
  }
}

async function withReleaseLock<T>(layout: RuntimeLayout, timeoutMs: number, operation: () => Promise<T>): Promise<T> {
  await fs.mkdir(layout.runtimeDir, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + timeoutMs;
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  while (handle === undefined) {
    try {
      handle = await fs.open(layout.releaseLockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      await handle.sync();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw lifecycleError("release_store_busy", "Another LocalApp release publication is still in progress");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const identity = await handle.stat({ bigint: true });
  try {
    return await operation();
  } finally {
    await handle.close();
    const current = await fs.lstat(layout.releaseLockPath, { bigint: true }).catch(() => undefined);
    if (current && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) {
      await fs.unlink(layout.releaseLockPath);
    }
  }
}

async function writeAtomic(filePath: string, bytes: Buffer, mode: number): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.next`);
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(temporary, "wx", mode);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporary, filePath);
    if (process.platform !== "win32") await fs.chmod(filePath, mode);
  } finally {
    await handle?.close();
    await fs.rm(temporary, { force: true });
  }
}

async function readRegularFile(filePath: string): Promise<Buffer> {
  const before = await fs.lstat(filePath, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink()) throw invalidArtifact();
  const noFollow = "O_NOFOLLOW" in fsConstants ? fsConstants.O_NOFOLLOW : 0;
  const handle = await fs.open(filePath, fsConstants.O_RDONLY | noFollow);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) throw invalidArtifact();
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    if (!after.isFile() || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
      || BigInt(bytes.byteLength) !== after.size) throw invalidArtifact();
    return bytes;
  } finally {
    await handle.close();
  }
}

function isSafeRelativeFile(value: string): boolean {
  return value.length > 0 && value.length <= 512 && !value.includes("\\") && !value.startsWith("/")
    && path.posix.normalize(value) === value && !value.endsWith("/")
    && value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function compareArtifactFiles(left: ReleaseArtifactFile, right: ReleaseArtifactFile): number {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

function sha256(bytes: Buffer): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function invalidArtifact(): Error {
  return lifecycleError("release_artifact_invalid", "The LocalApp release artifact is invalid or has changed");
}

function isErrorCode(value: unknown, code: string): boolean {
  return value instanceof Error && "code" in value && value.code === code;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function lstatOptional(filePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  return fs.lstat(filePath).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
}
