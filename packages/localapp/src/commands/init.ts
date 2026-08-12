import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CliIo } from "../cli/output.js";
import { LocalAppLifecycleError, lifecycleError } from "../errors.js";
import { isValidProjectName, writeProjectManifest } from "../project/manifest.js";
import { isManagedSkillName, verifyInitParent } from "../project/safety.js";
import { copyDirectory, isDirectory, type CopyDestinationMutations } from "../template/copy.js";

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
  if (!isValidProjectName(options.name)) {
    throw lifecycleError("invalid_project_name", "Invalid name. Use 3-63 lowercase letters, digits, or hyphens; start with a letter and do not end with or repeat hyphens.");
  }
  const cwd = await verifyInitParent(options.cwd);
  const useCurrentDirectory = path.basename(cwd) === options.name && await isEmptyDirectory(cwd);
  const projectDir = useCurrentDirectory ? cwd : path.join(cwd, options.name);
  if (!useCurrentDirectory && await pathExists(projectDir)) {
    throw lifecycleError("project_directory_exists", `Project directory already exists: ${options.name}. Choose another name or remove the directory.`);
  }
  const templateDirectory = await resolveTemplateDirectory();

  if (!useCurrentDirectory) await fs.mkdir(projectDir);
  try {
    await copyUserZone(templateDirectory, projectDir);
    await copyManagedZone(templateDirectory, projectDir);
    const manifest = await writeProjectManifest(projectDir, options.name, options.description);
    await fs.mkdir(path.join(projectDir, ".localapp"), { recursive: true });
    await fs.writeFile(path.join(projectDir, ".localapp/dev-config.json"), `${JSON.stringify({ serverUrl: "" }, null, 2)}\n`);
    if (!options.skipInstall) await installDependencies(projectDir, options.io);
    options.io.stdout(`${JSON.stringify({ created: options.name })}\n`);
    if (options.skipInstall) options.io.stderr("Skipping dependency installation. Run npm install manually.\n");
    options.io.stderr("Project created locally. Run localapp app install --target <profile> when it is ready to publish.\n");
    return { projectDir, manifest };
  } catch (error) {
    if (!useCurrentDirectory) await fs.rm(projectDir, { recursive: true, force: true });
    if (error instanceof LocalAppLifecycleError) throw error;
    throw lifecycleError("project_initialization_failed", "Project initialization failed. Check the builtin template and destination permissions, then retry.");
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
  throw lifecycleError("builtin_template_unavailable", "Builtin template is unavailable. Reinstall localapp or rebuild the package before running init.");
}

export async function copyUserZone(templateDirectory: string, projectDirectory: string): Promise<void> {
  const userExcludes = new Set([".claude", ".next", ".DS_Store", "data", "dist", "node_modules", "runtime", "template.gitignore"]);
  await copyDirectory(templateDirectory, projectDirectory, userExcludes);
  const stagedGitignore = path.join(templateDirectory, "template.gitignore");
  if (await pathExists(stagedGitignore)) await fs.copyFile(stagedGitignore, path.join(projectDirectory, ".gitignore"));
  const stagedNpmrc = path.join(templateDirectory, "template.npmrc");
  if (await pathExists(stagedNpmrc)) await fs.copyFile(stagedNpmrc, path.join(projectDirectory, ".npmrc"));
}

export async function copyManagedZone(
  templateDirectory: string,
  projectDirectory: string,
  destinationMutations?: CopyDestinationMutations,
): Promise<void> {
  await copyDirectory(path.join(templateDirectory, "runtime"), path.join(projectDirectory, ".localapp/runtime"), undefined, destinationMutations);
  const skillsDirectory = path.join(templateDirectory, ".claude/skills");
  if (!await isDirectory(skillsDirectory)) return;
  const names = await fs.readdir(skillsDirectory, { withFileTypes: true });
  for (const entry of names.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!isManagedSkill(entry.name)) continue;
    if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`Builtin template contains an unsafe managed skill: ${entry.name}`);
    await copyDirectory(
      path.join(skillsDirectory, entry.name),
      path.join(projectDirectory, ".claude/skills", entry.name),
      undefined,
      destinationMutations,
    );
  }
}

export function isManagedSkill(name: string): boolean {
  return isManagedSkillName(name);
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
  }).catch(() => {
    throw lifecycleError("dependency_install_failed", "Dependency installation failed. Run npm install in the project directory after resolving the npm error.");
  });
}

async function pathExists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}

async function isEmptyDirectory(directory: string): Promise<boolean> {
  const entries = await fs.readdir(directory).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  return entries !== undefined && entries.length === 0;
}
