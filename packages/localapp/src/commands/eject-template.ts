import fs from "node:fs/promises";
import path from "node:path";
import { isManagedSkill } from "./init.js";
import { isEjected } from "./sync-template.js";
import { copyDirectory, isDirectory } from "../template/copy.js";
import { rewritePackageJsonForEject } from "../template/package-json.js";

export interface EjectResult {
  ejected: true;
}

export async function ejectManagedTemplate(projectDir: string): Promise<EjectResult> {
  if (await isEjected(projectDir)) throw new Error("Project has already been ejected and cannot be synchronized again.");
  const runtimeSource = path.join(projectDir, ".localapp/runtime");
  if (!await isDirectory(runtimeSource)) throw new Error("Not a localapp project. Run localapp init first.");
  const runtimeDestination = path.join(projectDir, "src/_localapp_runtime");
  if (await pathExists(runtimeDestination)) throw new Error(`Refusing to overwrite existing user directory: ${runtimeDestination}`);

  const renames = await managedSkillRenames(projectDir);
  for (const { destination } of renames) {
    if (await pathExists(destination)) throw new Error(`Refusing to overwrite existing user skill: ${destination}`);
  }
  await copyDirectory(runtimeSource, runtimeDestination);
  for (const { source, destination } of renames) await copyDirectory(source, destination);
  await rewritePackageJsonForEject(projectDir);
  await fs.rm(runtimeSource, { recursive: true, force: true });
  for (const { source } of renames) await fs.rm(source, { recursive: true, force: true });
  await writeEjectedMarker(projectDir);
  return { ejected: true };
}

async function managedSkillRenames(projectDir: string): Promise<Array<{ source: string; destination: string }>> {
  const skillsDirectory = path.join(projectDir, ".claude/skills");
  const entries = await fs.readdir(skillsDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  return entries
    .filter((entry) => entry.isDirectory() && isManagedSkill(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      source: path.join(skillsDirectory, entry.name),
      destination: path.join(skillsDirectory, `custom-${entry.name}`),
    }));
}

async function writeEjectedMarker(projectDir: string): Promise<void> {
  const configDirectory = path.join(projectDir, ".localapp");
  const configPath = path.join(configDirectory, "project-config.json");
  let config: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("project config must be an object");
    config = parsed as Record<string, unknown>;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  config.ejected = true;
  await fs.mkdir(configDirectory, { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function pathExists(target: string): Promise<boolean> {
  return fs.access(target).then(() => true, () => false);
}
