import fs from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  APP_PACKAGE_SCHEMA_VERSION,
  inspectAppPackage,
  writeAppPackageToStream,
  type PortablePackageFile,
} from "@localapp/server/app-package-api";
import { lifecycleError } from "../errors.js";
import { validateAndCollectBackend } from "./backend.js";
import { checkProject, loadAndValidateProjectManifest, type ProjectCommandRunner } from "./check.js";
import {
  capturePreparedTemporary,
  collectProjectTree,
  preparePackageOutput,
  readProjectJson,
  resolveSafePackageOutput,
  type ProjectFileReadHooks,
} from "./files.js";

export interface BuildApplicationPackageOptions {
  projectDir: string;
  outputPath?: string;
  overwrite?: boolean;
  run?: ProjectCommandRunner;
  fileHooks?: ProjectFileReadHooks;
  outputHooks?: PackageOutputHooks;
  packageOperations?: Partial<PackageOperations>;
}

export interface PackageOperations {
  writePackage: typeof writeAppPackageToStream;
  inspectPackage: typeof inspectAppPackage;
}

export interface PackageOutputHooks {
  beforeCandidateCreate?(): Promise<void>;
}

export interface BuildApplicationPackageResult {
  path: string;
  appId: string;
  version: string;
  sha256: string;
  size: number;
}

export async function buildApplicationPackage(options: BuildApplicationPackageOptions): Promise<BuildApplicationPackageResult> {
  const projectDir = path.resolve(options.projectDir);
  const manifest = await loadAndValidateProjectManifest(projectDir, options.fileHooks);
  const backendRoot = manifest.backend?.root ?? "backend";
  const output = await resolveSafePackageOutput({
    projectDir,
    outputPath: options.outputPath,
    defaultName: manifest.name,
    protectedDirectories: [manifest.distDir, "migrations", backendRoot],
    overwrite: options.overwrite === true,
  });
  const report = await checkProject({ projectDir, run: options.run, fileHooks: options.fileHooks });
  if (!report.success) {
    const diagnostic = report.diagnostics.find((item) => item.severity === "error");
    throw lifecycleError("project_check_failed", diagnostic?.message ?? "Project check failed");
  }

  const packageJson = await readProjectJson(projectDir, "package.json", options.fileHooks);
  const version = typeof packageJson.version === "string" && packageJson.version.trim()
    ? packageJson.version.trim()
    : "0.0.0";
  const files = await collectCanonicalFiles(projectDir, manifest, options.fileHooks);
  const prepared = await preparePackageOutput(output.path, options.overwrite === true);
  const operations: PackageOperations = {
    writePackage: options.packageOperations?.writePackage ?? writeAppPackageToStream,
    inspectPackage: options.packageOperations?.inspectPackage ?? inspectAppPackage,
  };
  let candidate: AnchoredPackageCandidate | undefined;
  try {
    candidate = await createAnchoredPackageCandidate(prepared, options.outputHooks);
    const written = waitForHelperMessage(candidate.child, "written");
    const generated = await operations.writePackage({
      output: candidate.output,
      metadata: {
        schemaVersion: APP_PACKAGE_SCHEMA_VERSION,
        appId: manifest.name,
        version,
        platformVersion: manifest.platformVersion,
      },
      files,
    });
    const helperWrite = await written;
    if (helperWrite.digest !== generated.digest) {
      throw lifecycleError("application_package_invalid", "Application package changed while writing the candidate");
    }
    await capturePreparedTemporary(prepared);
    const inspected = await operations.inspectPackage(prepared.temporaryPath);
    if (generated.digest !== inspected.digest) {
      throw lifecycleError("application_package_invalid", "Application package changed before publication");
    }
    const stat = await fs.stat(prepared.temporaryPath);
    await commandPackageHelper(candidate.child, "publish", "published");
    candidate = undefined;
    return {
      path: output.path,
      appId: inspected.metadata.appId,
      version: inspected.metadata.version,
      sha256: inspected.digest,
      size: stat.size,
    };
  } catch (error) {
    if (candidate !== undefined) await cleanupAnchoredCandidate(candidate);
    if (error instanceof Error && "code" in error && error.code === "APP_PACKAGE_INVALID") {
      throw lifecycleError("application_package_invalid", error.message);
    }
    throw error;
  }
}

interface AnchoredPackageCandidate {
  child: ChildProcess;
  output: Writable;
}

interface PackageHelperMessage {
  type: "ready" | "written" | "published" | "cleaned" | "error";
  code?: string;
  digest?: string;
}

// Node exposes no portable openat-style API. A child working directory is the
// directory capability here: relative opens and renames stay anchored to the
// directory inherited at spawn, even if its pathname is replaced afterward.
const PACKAGE_OUTPUT_HELPER = String.raw`
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = fs.promises;
const { Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const config = JSON.parse(Buffer.from(process.argv[1], "base64url").toString("utf8"));
const send = (message) => new Promise((resolve) => {
  if (!process.send) return resolve();
  process.send(message, () => resolve());
});
const sameParent = async () => {
  const stat = await fsp.stat(".", { bigint: true });
  return stat.isDirectory() && stat.dev === BigInt(config.dev) && stat.ino === BigInt(config.ino);
};
const cleanup = async () => {
  const stat = await fsp.lstat(config.temporary).catch((error) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (stat && !stat.isSymbolicLink() && stat.isFile()) await fsp.unlink(config.temporary);
};

(async () => {
  if (!await sameParent()) {
    await send({ type: "error", code: "unsafe_project_path" });
    return;
  }
  const output = fs.createWriteStream(config.temporary, { flags: "wx", mode: 0o600 });
  await new Promise((resolve, reject) => {
    output.once("open", resolve);
    output.once("error", reject);
  });
  await send({ type: "ready" });
  const hash = crypto.createHash("sha256");
  const hashing = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(process.stdin, hashing, output);
  const commandPromise = new Promise((resolve) => process.once("message", resolve));
  await send({ type: "written", digest: hash.digest("hex") });
  const command = await commandPromise;
  if (command.action === "cleanup") {
    await cleanup();
    await send({ type: "cleaned" });
    return;
  }
  if (command.action !== "publish" || !await sameParent()) {
    await cleanup();
    await send({ type: "error", code: "unsafe_project_path" });
    return;
  }
  const temporary = await fsp.lstat(config.temporary);
  if (temporary.isSymbolicLink() || !temporary.isFile()) throw new Error("unsafe temporary package");
  if (config.overwrite) {
    const target = await fsp.lstat(config.target).catch((error) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (target && (target.isSymbolicLink() || !target.isFile())) throw new Error("unsafe package target");
    await fsp.rename(config.temporary, config.target);
  } else {
    await fsp.link(config.temporary, config.target);
    await fsp.unlink(config.temporary);
  }
  await send({ type: "published" });
})().catch(async (error) => {
  await cleanup().catch(() => undefined);
  await send({ type: "error", code: error && error.code === "EEXIST" ? "package_output_exists" : "package_output_failed" });
}).finally(() => process.disconnect?.());
`;

async function createAnchoredPackageCandidate(
  prepared: Awaited<ReturnType<typeof preparePackageOutput>>,
  hooks?: PackageOutputHooks,
): Promise<AnchoredPackageCandidate> {
  await hooks?.beforeCandidateCreate?.();
  const config = Buffer.from(JSON.stringify({
    dev: prepared.parent.dev.toString(),
    ino: prepared.parent.ino.toString(),
    temporary: path.basename(prepared.temporaryPath),
    target: path.basename(prepared.path),
    overwrite: prepared.overwrite,
  })).toString("base64url");
  const child = spawn(process.execPath, ["--input-type=commonjs", "--eval", PACKAGE_OUTPUT_HELPER, config], {
    cwd: prepared.parent.path,
    windowsHide: true,
    stdio: ["pipe", "ignore", "ignore", "ipc"],
  });
  const ready = waitForHelperMessage(child, "ready");
  const output = child.stdin;
  if (output === null) throw lifecycleError("package_output_failed", "Could not create application package candidate");
  await ready;
  return { child, output };
}

function waitForHelperMessage(
  child: ChildProcess,
  expected: PackageHelperMessage["type"],
): Promise<PackageHelperMessage> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (value: unknown) => {
      if (!isPackageHelperMessage(value)) return;
      if (value.type === "error") {
        cleanup();
        reject(packageHelperError(value.code));
      } else if (value.type === expected) {
        cleanup();
        resolve(value);
      }
    };
    const onError = () => {
      cleanup();
      reject(lifecycleError("package_output_failed", "Could not create application package candidate"));
    };
    const onExit = () => {
      cleanup();
      reject(lifecycleError("package_output_failed", "Application package candidate process stopped unexpectedly"));
    };
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function commandPackageHelper(
  child: ChildProcess,
  action: "publish" | "cleanup",
  expected: "published" | "cleaned",
): Promise<PackageHelperMessage> {
  const response = waitForHelperMessage(child, expected);
  await new Promise<void>((resolve, reject) => {
    child.send({ action }, (error) => error ? reject(error) : resolve());
  });
  return response;
}

async function cleanupAnchoredCandidate(candidate: AnchoredPackageCandidate): Promise<void> {
  try {
    if (!candidate.output.destroyed) candidate.output.destroy();
    if (candidate.child.connected) await commandPackageHelper(candidate.child, "cleanup", "cleaned");
  } catch {
    candidate.child.kill();
  }
}

function isPackageHelperMessage(value: unknown): value is PackageHelperMessage {
  return isRecord(value) && typeof value.type === "string"
    && ["ready", "written", "published", "cleaned", "error"].includes(value.type);
}

function packageHelperError(code: string | undefined): Error {
  if (code === "unsafe_project_path") {
    return lifecycleError("unsafe_project_path", "Application package output parent changed before candidate creation");
  }
  if (code === "package_output_exists") {
    return lifecycleError("package_output_exists", "Application package output already exists; choose another path or explicitly enable overwrite");
  }
  return lifecycleError("package_output_failed", "Could not publish application package safely");
}

async function collectCanonicalFiles(
  projectDir: string,
  manifest: Awaited<ReturnType<typeof loadAndValidateProjectManifest>>,
  fileHooks?: ProjectFileReadHooks,
): Promise<PortablePackageFile[]> {
  const canonicalManifest = structuredClone(manifest.raw);
  canonicalManifest.distDir = "dist";
  if (manifest.backend !== undefined) {
    const backend = isRecord(canonicalManifest.backend) ? canonicalManifest.backend : {};
    backend.root = "backend";
    delete backend.include;
    canonicalManifest.backend = backend;
  }
  const files: PortablePackageFile[] = [{
    path: "manifest.json",
    content: Buffer.from(`${JSON.stringify(canonicalManifest)}\n`),
  }];
  const dist = await collectProjectTree({
    projectDir,
    configuredPath: manifest.distDir,
    label: "distDir",
    required: true,
    hooks: fileHooks,
  });
  files.push(...dist.map((file) => ({ path: `dist/${file.relativePath}`, content: file.content })));
  const migrations = await collectProjectTree({
    projectDir,
    configuredPath: "migrations",
    label: "migrations",
    required: false,
    hooks: fileHooks,
  });
  files.push(...migrations
    .filter((file) => file.relativePath.endsWith(".sql"))
    .map((file) => ({ path: `migrations/${file.relativePath}`, content: file.content })));
  const backend = await validateAndCollectBackend({
    projectDir,
    config: manifest.backend,
    platformVersion: manifest.platformVersion,
    fileHooks,
  });
  files.push(...backend.map((file) => ({ path: `backend/${file.relativePath}`, content: file.content })));
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
