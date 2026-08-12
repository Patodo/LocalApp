import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";

export interface CollectedProjectFile {
  absolutePath: string;
  relativePath: string;
  content: Buffer;
}

export async function readProjectJson(projectDir: string, filename: string): Promise<Record<string, unknown>> {
  const filePath = path.join(projectDir, filename);
  await assertRegularProjectFile(projectDir, filePath, filename);
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw lifecycleError("invalid_project_json", `Invalid ${filename}: ${safeErrorMessage(error)}`);
  }
  if (!isRecord(value)) throw lifecycleError("invalid_project_json", `${filename} must contain a JSON object`);
  return value;
}

export async function collectProjectTree(options: {
  projectDir: string;
  configuredPath: string;
  label: string;
  required: boolean;
}): Promise<CollectedProjectFile[]> {
  const root = await resolveProjectDirectory(options);
  if (root === undefined) return [];
  const files: CollectedProjectFile[] = [];
  await collectTree(root, root, options.label, files);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export async function assertRegularProjectFile(projectDir: string, filePath: string, label: string): Promise<void> {
  const root = path.resolve(projectDir);
  const target = path.resolve(filePath);
  if (!isInside(root, target) || target === root) throw unsafePath(`${label} must stay inside the project`);
  await assertPathChainHasNoSymlinks(root, path.dirname(target), label);
  const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") throw lifecycleError("project_file_missing", `${label} does not exist`);
    throw error;
  });
  if (stat.isSymbolicLink() || !stat.isFile()) throw unsafePath(`${label} must be a regular file without symlinks`);
}

export async function readVerifiedFile(projectDir: string, filePath: string, label: string): Promise<Buffer> {
  await assertRegularProjectFile(projectDir, filePath, label);
  return fs.readFile(filePath);
}

export async function resolveProjectDirectory(options: {
  projectDir: string;
  configuredPath: string;
  label: string;
  required: boolean;
}): Promise<string | undefined> {
  const root = path.resolve(options.projectDir);
  const configured = options.configuredPath.trim();
  if (!configured || path.isAbsolute(configured)) {
    throw unsafePath(`${options.label} must be a non-empty relative path inside the project`);
  }
  const target = path.resolve(root, configured);
  if (!isInside(root, target) || target === root) {
    throw unsafePath(`${options.label} must stay inside the project and must not be the project root`);
  }
  await assertPathChainHasNoSymlinks(root, target, options.label, !options.required);
  const stat = await fs.lstat(target).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT" && !options.required) return undefined;
    if (error.code === "ENOENT") throw lifecycleError("project_directory_missing", `${options.label} does not exist: ${options.configuredPath}`);
    throw error;
  });
  if (stat === undefined) return undefined;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafePath(`${options.label} must be a directory without symlinks`);
  return target;
}

export async function resolveSafePackageOutput(options: {
  projectDir: string;
  outputPath?: string;
  defaultName: string;
  protectedDirectories: readonly string[];
  overwrite: boolean;
}): Promise<{ path: string; exists: boolean }> {
  const configured = options.outputPath ?? `${options.defaultName}.localapp`;
  const outputPath = path.resolve(options.projectDir, configured);
  if (path.extname(outputPath) !== ".localapp") {
    throw lifecycleError("invalid_package_output", "Application package output must use the .localapp extension");
  }
  for (const protectedDirectory of options.protectedDirectories) {
    const protectedPath = path.resolve(options.projectDir, protectedDirectory);
    if (isInside(protectedPath, outputPath)) {
      throw lifecycleError("invalid_package_output", "Application package output must be outside dist, migrations, and backend source directories");
    }
  }
  await assertExistingOutputChainHasNoSymlinks(outputPath);
  const stat = await fs.lstat(outputPath).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (stat !== undefined && (stat.isSymbolicLink() || !stat.isFile())) {
    throw unsafePath("Application package output must be a regular file without symlinks");
  }
  if (stat !== undefined && !options.overwrite) {
    throw lifecycleError("package_output_exists", "Application package output already exists; choose another path or explicitly enable overwrite");
  }
  return { path: outputPath, exists: stat !== undefined };
}

export function normalizeArchiveRelativePath(value: string, label: string): string {
  const normalized = value.replaceAll("\\", "/").split("/").filter((part) => part !== "" && part !== ".").join("/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    throw unsafePath(`${label} contains an unsafe package path`);
  }
  return normalized;
}

function asyncReaddir(directory: string) {
  return fs.readdir(directory, { withFileTypes: true });
}

async function collectTree(root: string, current: string, label: string, files: CollectedProjectFile[]): Promise<void> {
  const entries = (await asyncReaddir(current)).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, "/");
    const stat = await fs.lstat(absolutePath);
    if (stat.isSymbolicLink()) throw unsafePath(`${label} must not contain symlinks: ${relativePath}`);
    if (stat.isDirectory()) {
      await collectTree(root, absolutePath, label, files);
    } else if (stat.isFile()) {
      files.push({ absolutePath, relativePath, content: await fs.readFile(absolutePath) });
    } else {
      throw unsafePath(`${label} must contain only regular files and directories: ${relativePath}`);
    }
  }
}

async function assertPathChainHasNoSymlinks(root: string, target: string, label: string, allowMissingTail = false): Promise<void> {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw unsafePath(`${label} escaped the project`);
  let current = root;
  const rootStat = await fs.lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw unsafePath("Project directory must not be symlinked");
  for (const component of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (allowMissingTail && error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) throw unsafePath(`${label} must not contain symlinks`);
  }
}

async function assertExistingOutputChainHasNoSymlinks(outputPath: string): Promise<void> {
  const parsed = path.parse(outputPath);
  const components = outputPath.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) throw unsafePath("Application package output path must not contain symlinks");
  }
}

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function unsafePath(message: string) {
  return lifecycleError("unsafe_project_path", message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeErrorMessage(error: unknown): string {
  return error instanceof SyntaxError ? "malformed JSON" : error instanceof Error ? error.message : "unknown error";
}
