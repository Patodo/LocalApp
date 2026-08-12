import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError } from "../errors.js";

const NOT_PROJECT_MESSAGE = "This directory is not a LocalApp project. Run the command from a project created by localapp init.";
const UNSAFE_PATH_MESSAGE = "The LocalApp project contains a symlink or unsafe managed path. Replace managed paths with real files and directories before retrying.";

export interface VerifiedProject {
  root: string;
  localAppDirectory: string;
  runtimeDirectory: string;
  skillsDirectory: string;
  sourceDirectory: string;
  packagePath: string;
  configPath: string;
}

export async function verifyProjectBase(projectDirectory: string): Promise<VerifiedProject> {
  const root = path.resolve(projectDirectory);
  await requireDirectory(root, "not_localapp_project");
  const realRoot = await fs.realpath(root).catch(() => undefined);
  if (realRoot === undefined || path.resolve(realRoot) !== root) throw unsafePath();

  const localAppDirectory = path.join(root, ".localapp");
  const skillsDirectory = path.join(root, ".claude/skills");
  const sourceDirectory = path.join(root, "src");
  await requireDirectory(localAppDirectory, "not_localapp_project");
  await requireDirectory(path.join(root, ".claude"), "not_localapp_project");
  await requireDirectory(skillsDirectory, "not_localapp_project");
  await requireDirectory(sourceDirectory, "not_localapp_project");

  const packagePath = path.join(root, "package.json");
  const configPath = path.join(localAppDirectory, "project-config.json");
  await requireProjectJson(path.join(root, "manifest.json"), true);
  await requireProjectJson(packagePath, false);
  await requireProjectJson(path.join(localAppDirectory, "dev-config.json"), false);

  return {
    root,
    localAppDirectory,
    runtimeDirectory: path.join(localAppDirectory, "runtime"),
    skillsDirectory,
    sourceDirectory,
    packagePath,
    configPath,
  };
}

export async function verifyManagedProject(project: VerifiedProject): Promise<void> {
  await requireDirectory(project.runtimeDirectory, "not_localapp_project");
  await assertTreeHasNoSymlinks(project.runtimeDirectory);
  for (const name of await managedSkillNames(project.skillsDirectory)) {
    await assertTreeHasNoSymlinks(path.join(project.skillsDirectory, name));
  }
}

export async function verifyInitParent(directory: string): Promise<string> {
  const resolved = path.resolve(directory);
  await requireDirectory(resolved, "unsafe_project_path");
  const real = await fs.realpath(resolved).catch(() => undefined);
  if (real === undefined || path.resolve(real) !== resolved) throw unsafePath();
  return resolved;
}

export async function readProjectConfig(project: VerifiedProject): Promise<Record<string, unknown>> {
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

export async function writeProjectConfig(project: VerifiedProject, value: Record<string, unknown>): Promise<void> {
  await atomicWriteFile(project.configPath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function atomicWriteFile(target: string, contents: string): Promise<void> {
  const parent = path.dirname(target);
  await requireDirectory(parent, "unsafe_project_path");
  const existing = await lstatOptional(target);
  if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) throw unsafePath();
  const temporary = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporary, contents, { flag: "wx" });
  try {
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function managedSkillNames(skillsDirectory: string): Promise<string[]> {
  await requireDirectory(skillsDirectory, "unsafe_project_path");
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

export async function removeVerifiedTree(target: string): Promise<void> {
  const stat = await lstatOptional(target);
  if (stat === undefined) return;
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafePath();
  await assertTreeHasNoSymlinks(target);
  await fs.rm(target, { recursive: true });
}

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function unsafePath(): ReturnType<typeof lifecycleError> {
  return lifecycleError("unsafe_project_path", UNSAFE_PATH_MESSAGE);
}

async function requireProjectJson(filePath: string, manifest: boolean): Promise<void> {
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

async function requireDirectory(directory: string, missingCode: "not_localapp_project" | "unsafe_project_path"): Promise<void> {
  const stat = await lstatOptional(directory);
  if (stat === undefined) {
    if (missingCode === "not_localapp_project") throw lifecycleError("not_localapp_project", NOT_PROJECT_MESSAGE);
    throw unsafePath();
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw unsafePath();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
