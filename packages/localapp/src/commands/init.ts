import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliIo } from "../cli/output.js";
import { isValidProjectName, writeProjectManifest } from "../project/manifest.js";
import { copyDirectory, isDirectory } from "../template/copy.js";

export interface InitializeProjectOptions {
  cwd: string;
  name: string;
  description?: string;
  skipInstall: boolean;
  skipDeploy: boolean;
  io: CliIo;
}

export interface InitResult {
  projectDir: string;
  manifest: { name: string };
}

export async function initializeProject(options: InitializeProjectOptions): Promise<InitResult> {
  if (!options.skipDeploy) {
    throw new Error("Project deployment is not available yet; use --skip-deploy until package/check/install support is available");
  }
  if (!isValidProjectName(options.name)) {
    throw new Error("Invalid name. Must be 3-63 lowercase letters, digits, or hyphens; it must start with a letter and may not end with or repeat hyphens.");
  }
  const cwd = path.resolve(options.cwd);
  const useCurrentDirectory = path.basename(cwd) === options.name && await isEmptyDirectory(cwd);
  const projectDir = useCurrentDirectory ? cwd : path.join(cwd, options.name);
  if (!useCurrentDirectory && await pathExists(projectDir)) throw new Error(`Directory '${options.name}' already exists`);
  const templateDirectory = await resolveTemplateDirectory();

  await fs.mkdir(projectDir, { recursive: true });
  try {
    await copyUserZone(templateDirectory, projectDir);
    await copyManagedZone(templateDirectory, projectDir);
    const manifest = await writeProjectManifest(projectDir, options.name, options.description);
    await fs.mkdir(path.join(projectDir, ".localapp"), { recursive: true });
    await fs.writeFile(path.join(projectDir, ".localapp/dev-config.json"), `${JSON.stringify({ serverUrl: "" }, null, 2)}\n`);
    if (!options.skipInstall) await installDependencies(projectDir, options.io);
    options.io.stdout(`${JSON.stringify({ created: options.name })}\n`);
    if (options.skipInstall) options.io.stderr("Skipping dependency installation. Run npm install manually.\n");
    options.io.stderr("Skipping deployment. Run localapp app install when package support is available.\n");
    return { projectDir, manifest };
  } catch (error) {
    if (!useCurrentDirectory) await fs.rm(projectDir, { recursive: true, force: true });
    throw error;
  }
}

export async function resolveTemplateDirectory(): Promise<string> {
  const explicit = process.env.LOCALAPP_TEMPLATE_DIR;
  if (explicit !== undefined && await isDirectory(explicit)) return explicit;
  let packageDirectory = path.dirname(fileURLToPath(import.meta.url));
  for (let level = 0; level < 4; level += 1) {
    const packagedTemplate = path.join(packageDirectory, "template");
    if (await isDirectory(packagedTemplate)) return packagedTemplate;
    packageDirectory = path.dirname(packageDirectory);
  }
  throw new Error("Builtin template is unavailable. Reinstall localapp or build the package before running init.");
}

export async function copyUserZone(templateDirectory: string, projectDirectory: string): Promise<void> {
  const userExcludes = new Set([".claude", ".next", ".DS_Store", "data", "dist", "node_modules", "runtime", "template.gitignore"]);
  await copyDirectory(templateDirectory, projectDirectory, userExcludes);
  const stagedGitignore = path.join(templateDirectory, "template.gitignore");
  if (await pathExists(stagedGitignore)) await fs.copyFile(stagedGitignore, path.join(projectDirectory, ".gitignore"));
}

export async function copyManagedZone(templateDirectory: string, projectDirectory: string): Promise<void> {
  await copyDirectory(path.join(templateDirectory, "runtime"), path.join(projectDirectory, ".localapp/runtime"));
  const skillsDirectory = path.join(templateDirectory, ".claude/skills");
  if (!await isDirectory(skillsDirectory)) return;
  const names = await fs.readdir(skillsDirectory, { withFileTypes: true });
  for (const entry of names.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !isManagedSkill(entry.name)) continue;
    await copyDirectory(path.join(skillsDirectory, entry.name), path.join(projectDirectory, ".claude/skills", entry.name));
  }
}

export function isManagedSkill(name: string): boolean {
  return name === "agent-tool-patterns" || name.startsWith("localapp");
}

async function installDependencies(projectDirectory: string, io: CliIo): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npm", ["install"], { cwd: projectDirectory, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => io.stdout(chunk));
    child.stderr.on("data", (chunk) => io.stderr(chunk));
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm install failed with exit code ${code ?? "unknown"}`)));
  });
}

async function pathExists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

async function isEmptyDirectory(directory: string): Promise<boolean> {
  const entries = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  return entries !== undefined && entries.length === 0;
}
