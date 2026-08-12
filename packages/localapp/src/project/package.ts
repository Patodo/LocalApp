import fs from "node:fs/promises";
import path from "node:path";
import {
  APP_PACKAGE_SCHEMA_VERSION,
  inspectAppPackage,
  writeAppPackage,
  type PortablePackageFile,
} from "@localapp/server/app-package-api";
import { lifecycleError } from "../errors.js";
import { validateAndCollectBackend } from "./backend.js";
import { checkProject, loadAndValidateProjectManifest, type ProjectCommandRunner } from "./check.js";
import {
  capturePreparedTemporary,
  cleanupPreparedTemporary,
  collectProjectTree,
  preparePackageOutput,
  publishPreparedPackage,
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
  packageOperations?: Partial<PackageOperations>;
}

export interface PackageOperations {
  writePackage: typeof writeAppPackage;
  inspectPackage: typeof inspectAppPackage;
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
    writePackage: options.packageOperations?.writePackage ?? writeAppPackage,
    inspectPackage: options.packageOperations?.inspectPackage ?? inspectAppPackage,
  };
  let temporaryIdentity: { dev: bigint; ino: bigint } | undefined;
  try {
    await operations.writePackage({
      outputPath: prepared.temporaryPath,
      metadata: {
        schemaVersion: APP_PACKAGE_SCHEMA_VERSION,
        appId: manifest.name,
        version,
        platformVersion: manifest.platformVersion,
      },
      files,
    });
    temporaryIdentity = await capturePreparedTemporary(prepared);
    const inspected = await operations.inspectPackage(prepared.temporaryPath);
    const stat = await fs.stat(prepared.temporaryPath);
    await publishPreparedPackage(prepared, temporaryIdentity);
    return {
      path: output.path,
      appId: inspected.metadata.appId,
      version: inspected.metadata.version,
      sha256: inspected.digest,
      size: stat.size,
    };
  } catch (error) {
    await cleanupPreparedTemporary(prepared, temporaryIdentity);
    if (error instanceof Error && "code" in error && error.code === "APP_PACKAGE_INVALID") {
      throw lifecycleError("application_package_invalid", error.message);
    }
    throw error;
  }
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
