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
import { collectProjectTree, readProjectJson, resolveSafePackageOutput } from "./files.js";

export interface BuildApplicationPackageOptions {
  projectDir: string;
  outputPath?: string;
  overwrite?: boolean;
  run?: ProjectCommandRunner;
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
  const manifest = await loadAndValidateProjectManifest(projectDir);
  const backendRoot = manifest.backend?.root ?? "backend";
  const output = await resolveSafePackageOutput({
    projectDir,
    outputPath: options.outputPath,
    defaultName: manifest.name,
    protectedDirectories: [manifest.distDir, "migrations", backendRoot],
    overwrite: options.overwrite === true,
  });
  const report = await checkProject({ projectDir, run: options.run });
  if (!report.success) {
    const diagnostic = report.diagnostics.find((item) => item.severity === "error");
    throw lifecycleError("project_check_failed", diagnostic?.message ?? "Project check failed");
  }

  const packageJson = await readProjectJson(projectDir, "package.json");
  const version = typeof packageJson.version === "string" && packageJson.version.trim()
    ? packageJson.version.trim()
    : "0.0.0";
  const files = await collectCanonicalFiles(projectDir, manifest);
  if (output.exists) await fs.rm(output.path);
  try {
    await writeAppPackage({
      outputPath: output.path,
      metadata: {
        schemaVersion: APP_PACKAGE_SCHEMA_VERSION,
        appId: manifest.name,
        version,
        platformVersion: manifest.platformVersion,
      },
      files,
    });
    const inspected = await inspectAppPackage(output.path);
    const stat = await fs.stat(output.path);
    return {
      path: output.path,
      appId: inspected.metadata.appId,
      version: inspected.metadata.version,
      sha256: inspected.digest,
      size: stat.size,
    };
  } catch (error) {
    await fs.rm(output.path, { force: true });
    if (error instanceof Error && "code" in error && error.code === "APP_PACKAGE_INVALID") {
      throw lifecycleError("application_package_invalid", error.message);
    }
    throw error;
  }
}

async function collectCanonicalFiles(
  projectDir: string,
  manifest: Awaited<ReturnType<typeof loadAndValidateProjectManifest>>,
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
  });
  files.push(...dist.map((file) => ({ path: `dist/${file.relativePath}`, content: file.content })));
  const migrations = await collectProjectTree({
    projectDir,
    configuredPath: "migrations",
    label: "migrations",
    required: false,
  });
  files.push(...migrations
    .filter((file) => file.relativePath.endsWith(".sql"))
    .map((file) => ({ path: `migrations/${file.relativePath}`, content: file.content })));
  const backend = await validateAndCollectBackend({
    projectDir,
    config: manifest.backend,
    platformVersion: manifest.platformVersion,
  });
  files.push(...backend.map((file) => ({ path: `backend/${file.relativePath}`, content: file.content })));
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
