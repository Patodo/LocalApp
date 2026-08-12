import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";

const NOT_PROJECT_MESSAGE = "This directory is not a LocalApp project. Run the command from a project created by localapp init.";
const UNSAFE_PATH_MESSAGE = "The LocalApp project contains a replaced, symlinked, or unsafe managed path. Restore real project directories before retrying.";

export interface PathIdentity {
  device: string;
  inode: string;
}

interface DirectoryIdentity extends PathIdentity {
  path: string;
}

export interface DirectoryGuard {
  directory: string;
  chain: readonly DirectoryIdentity[];
}

export interface LifecycleMutationHooks {
  beforeRename?(source: string, destination: string): Promise<void>;
  beforeRemove?(target: string): Promise<void>;
  beforeAtomicCommit?(temporary: string, target: string): Promise<void>;
  beforeFinalMarker?(): Promise<void>;
}

export interface VerifiedProject {
  root: string;
  localAppDirectory: string;
  runtimeDirectory: string;
  claudeDirectory: string;
  skillsDirectory: string;
  sourceDirectory: string;
  packagePath: string;
  configPath: string;
  rootGuard: DirectoryGuard;
  localAppGuard: DirectoryGuard;
  claudeGuard: DirectoryGuard;
  skillsGuard: DirectoryGuard;
  sourceGuard: DirectoryGuard;
}

export async function verifyProjectBase(projectDirectory: string): Promise<VerifiedProject> {
  const root = path.resolve(projectDirectory);
  const rootGuard = await captureDirectoryGuard(root, undefined, "not_localapp_project");
  const localAppDirectory = path.join(root, ".localapp");
  const claudeDirectory = path.join(root, ".claude");
  const skillsDirectory = path.join(claudeDirectory, "skills");
  const sourceDirectory = path.join(root, "src");
  const localAppGuard = await captureDirectoryGuard(localAppDirectory, rootGuard, "not_localapp_project");
  const claudeGuard = await captureDirectoryGuard(claudeDirectory, rootGuard, "not_localapp_project");
  const skillsGuard = await captureDirectoryGuard(skillsDirectory, claudeGuard, "not_localapp_project");
  const sourceGuard = await captureDirectoryGuard(sourceDirectory, rootGuard, "not_localapp_project");

  const packagePath = path.join(root, "package.json");
  const configPath = path.join(localAppDirectory, "project-config.json");
  await requireProjectJson(path.join(root, "manifest.json"), true, rootGuard);
  await requireProjectJson(packagePath, false, rootGuard);
  await requireProjectJson(path.join(localAppDirectory, "dev-config.json"), false, localAppGuard);

  return {
    root,
    localAppDirectory,
    runtimeDirectory: path.join(localAppDirectory, "runtime"),
    claudeDirectory,
    skillsDirectory,
    sourceDirectory,
    packagePath,
    configPath,
    rootGuard,
    localAppGuard,
    claudeGuard,
    skillsGuard,
    sourceGuard,
  };
}

export async function verifyManagedProject(project: VerifiedProject): Promise<void> {
  await verifyDirectoryGuard(project.localAppGuard);
  await verifyDirectoryGuard(project.skillsGuard);
  await captureDirectoryGuard(project.runtimeDirectory, project.localAppGuard, "not_localapp_project");
  await assertTreeHasNoSymlinks(project.runtimeDirectory);
  for (const name of await managedSkillNames(project.skillsDirectory, project.skillsGuard)) {
    await assertTreeHasNoSymlinks(path.join(project.skillsDirectory, name));
  }
}

export async function verifyInitParent(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  await captureDirectoryGuard(resolved, undefined, "unsafe_project_path");
  return resolved;
}

export async function captureDirectoryGuard(
  directory: string,
  parent?: DirectoryGuard,
  missingCode: "not_localapp_project" | "unsafe_project_path" = "unsafe_project_path",
): Promise<DirectoryGuard> {
  const resolved = path.resolve(directory);
  if (parent !== undefined) {
    await verifyDirectoryGuard(parent);
    if (path.dirname(resolved) !== parent.directory) throw unsafePath();
  }
  const stat = await lstatBigIntOptional(resolved);
  if (stat === undefined) {
    if (missingCode === "not_localapp_project") throw lifecycleError("not_localapp_project", NOT_PROJECT_MESSAGE);
    throw unsafePath();
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafePath();
  const real = await fs.realpath(resolved).catch(() => undefined);
  if (real === undefined || path.resolve(real) !== resolved) throw unsafePath();
  return {
    directory: resolved,
    chain: [...(parent?.chain ?? []), { path: resolved, ...identityOf(stat) }],
  };
}

export async function verifyDirectoryGuard(guard: DirectoryGuard): Promise<void> {
  for (const expected of guard.chain) {
    const stat = await lstatBigIntOptional(expected.path);
    if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory() || !matchesIdentity(stat, expected)) throw unsafePath();
    const real = await fs.realpath(expected.path).catch(() => undefined);
    if (real === undefined || path.resolve(real) !== expected.path) throw unsafePath();
  }
}

export async function capturePathIdentity(target: string, kind: "directory" | "file" = "directory"): Promise<PathIdentity> {
  const stat = await lstatBigIntOptional(target);
  if (stat === undefined || stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile())) throw unsafePath();
  const real = await fs.realpath(target).catch(() => undefined);
  if (real === undefined || path.resolve(real) !== path.resolve(target)) throw unsafePath();
  return identityOf(stat);
}

export async function verifyPathIdentity(target: string, expected: PathIdentity, kind: "directory" | "file" = "directory"): Promise<void> {
  const stat = await lstatBigIntOptional(target);
  if (stat === undefined || stat.isSymbolicLink() || (kind === "directory" ? !stat.isDirectory() : !stat.isFile()) || !matchesIdentity(stat, expected)) {
    throw unsafePath();
  }
  const real = await fs.realpath(target).catch(() => undefined);
  if (real === undefined || path.resolve(real) !== path.resolve(target)) throw unsafePath();
}

export async function guardedRename(options: {
  source: string;
  destination: string;
  sourceIdentity: PathIdentity;
  sourceParent: DirectoryGuard;
  destinationParent: DirectoryGuard;
  hooks?: LifecycleMutationHooks;
}): Promise<void> {
  if (path.dirname(path.resolve(options.source)) !== options.sourceParent.directory
    || path.dirname(path.resolve(options.destination)) !== options.destinationParent.directory) throw unsafePath();
  await options.hooks?.beforeRename?.(options.source, options.destination);
  await verifyDirectoryGuard(options.sourceParent);
  await verifyDirectoryGuard(options.destinationParent);
  await verifyPathIdentity(options.source, options.sourceIdentity);
  if (await lstatOptional(options.destination) !== undefined) throw unsafePath();
  await fs.rename(options.source, options.destination);
}

export async function guardedRemoveTree(options: {
  target: string;
  targetIdentity: PathIdentity;
  parent: DirectoryGuard;
  hooks?: LifecycleMutationHooks;
}): Promise<void> {
  if (path.dirname(path.resolve(options.target)) !== options.parent.directory) throw unsafePath();
  await options.hooks?.beforeRemove?.(options.target);
  await verifyDirectoryGuard(options.parent);
  await verifyPathIdentity(options.target, options.targetIdentity);
  await assertTreeHasNoSymlinks(options.target);
  await verifyDirectoryGuard(options.parent);
  await verifyPathIdentity(options.target, options.targetIdentity);
  await fs.rm(options.target, { recursive: true });
}

export async function readProjectConfig(project: VerifiedProject): Promise<Record<string, unknown>> {
  await verifyDirectoryGuard(project.localAppGuard);
  const stat = await lstatOptional(project.configPath);
  if (stat === undefined) return {};
  if (!stat.isFile() || stat.isSymbolicLink()) throw unsafePath();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(project.configPath, "utf8"));
    if (!isRecord(parsed)) throw new Error("invalid config");
    return parsed;
  } catch {
    throw lifecycleError("invalid_project_config", "The LocalApp project configuration is invalid. Repair .localapp/project-config.json before retrying.");
  }
}

export async function writeProjectConfig(
  project: VerifiedProject,
  value: Record<string, unknown>,
  hooks?: LifecycleMutationHooks,
): Promise<void> {
  await atomicWriteFile(project.configPath, `${JSON.stringify(value, null, 2)}\n`, project.localAppGuard, hooks);
}

export async function atomicWriteFile(
  target: string,
  contents: string,
  parent: DirectoryGuard,
  hooks?: LifecycleMutationHooks,
): Promise<void> {
  if (path.dirname(path.resolve(target)) !== parent.directory) throw unsafePath();
  await verifyDirectoryGuard(parent);
  const existingStat = await lstatOptional(target);
  if (existingStat !== undefined && (!existingStat.isFile() || existingStat.isSymbolicLink())) throw unsafePath();
  const existingIdentity = existingStat === undefined ? undefined : identityOf(existingStat);
  const temporary = path.join(parent.directory, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await verifyDirectoryGuard(parent);
  await fs.writeFile(temporary, contents, { flag: "wx" });
  const temporaryIdentity = await capturePathIdentity(temporary, "file");
  let committed = false;
  try {
    await hooks?.beforeAtomicCommit?.(temporary, target);
    await verifyDirectoryGuard(parent);
    await verifyPathIdentity(temporary, temporaryIdentity, "file");
    if (existingIdentity === undefined) {
      if (await lstatOptional(target) !== undefined) throw unsafePath();
    } else {
      await verifyPathIdentity(target, existingIdentity, "file");
    }
    await fs.rename(temporary, target);
    committed = true;
  } finally {
    if (!committed) {
      await removeTemporaryFile(temporary, temporaryIdentity, parent).catch(() => undefined);
    }
  }
}

export async function managedSkillNames(skillsDirectory: string, guard?: DirectoryGuard): Promise<string[]> {
  if (guard !== undefined) await verifyDirectoryGuard(guard);
  const stat = await lstatOptional(skillsDirectory);
  if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) throw unsafePath();
  const entries = await fs.readdir(skillsDirectory, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!isManagedSkillName(entry.name)) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw unsafePath();
    names.push(entry.name);
  }
  return names;
}

export function isManagedSkillName(name: string): boolean {
  return name === "agent-tool-patterns" || name.startsWith("localapp");
}

export async function assertTreeHasNoSymlinks(root: string): Promise<void> {
  const stat = await lstatOptional(root);
  if (stat === undefined || stat.isSymbolicLink() || !stat.isDirectory()) throw unsafePath();
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw unsafePath();
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) await assertTreeHasNoSymlinks(entryPath);
    else if (!entry.isFile()) throw unsafePath();
  }
}

export async function lstatOptional(target: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | undefined> {
  return fs.lstat(target).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function unsafePath(): ReturnType<typeof lifecycleError> {
  return lifecycleError("unsafe_project_path", UNSAFE_PATH_MESSAGE);
}

async function requireProjectJson(filePath: string, manifest: boolean, parent: DirectoryGuard): Promise<void> {
  await verifyDirectoryGuard(parent);
  const stat = await lstatOptional(filePath);
  if (stat === undefined) throw lifecycleError("not_localapp_project", NOT_PROJECT_MESSAGE);
  if (stat.isSymbolicLink() || !stat.isFile()) throw unsafePath();
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!isRecord(parsed)) throw new Error("invalid json");
    if (manifest && (typeof parsed.name !== "string" || typeof parsed.platformVersion !== "string")) throw new Error("invalid manifest");
  } catch {
    throw lifecycleError("not_localapp_project", NOT_PROJECT_MESSAGE);
  }
}

async function removeTemporaryFile(target: string, identity: PathIdentity, parent: DirectoryGuard): Promise<void> {
  await verifyDirectoryGuard(parent);
  await verifyPathIdentity(target, identity, "file");
  await fs.rm(target);
}

async function lstatBigIntOptional(target: string) {
  return fs.lstat(target, { bigint: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
}

function identityOf(stat: { dev: number | bigint; ino: number | bigint }): PathIdentity {
  return { device: stat.dev.toString(), inode: stat.ino.toString() };
}

function matchesIdentity(stat: { dev: number | bigint; ino: number | bigint }, expected: PathIdentity): boolean {
  return stat.dev.toString() === expected.device && stat.ino.toString() === expected.inode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
