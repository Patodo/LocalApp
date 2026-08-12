import fs from "node:fs/promises";
import path from "node:path";
import { copyManagedZone, isManagedSkill, resolveTemplateDirectory } from "./init.js";

export interface SyncResult {
  updated: boolean;
  version: string;
}

export async function syncManagedTemplate(projectDir: string, { quiet }: { quiet: boolean }): Promise<SyncResult> {
  if (await isEjected(projectDir)) throw new Error("Project has been ejected. Template sync is permanently disabled for this project.");
  const templateDirectory = await resolveTemplateDirectory();
  await fs.rm(path.join(projectDir, ".localapp/runtime"), { recursive: true, force: true });
  await removeManagedSkills(projectDir);
  await copyManagedZone(templateDirectory, projectDir);
  const version = JSON.parse(await fs.readFile(path.join(projectDir, ".localapp/runtime/version.json"), "utf8")) as { cliVersion: string };
  if (!quiet) process.stderr.write(`Updated managed template files to ${version.cliVersion}.\n`);
  return { updated: true, version: version.cliVersion };
}

export async function isEjected(projectDir: string): Promise<boolean> {
  try {
    const config = JSON.parse(await fs.readFile(path.join(projectDir, ".localapp/project-config.json"), "utf8")) as { ejected?: unknown };
    return config.ejected === true;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(`Failed to read project eject state: ${(error as Error).message}`);
  }
}

async function removeManagedSkills(projectDir: string): Promise<void> {
  const skillsDirectory = path.join(projectDir, ".claude/skills");
  const entries = await fs.readdir(skillsDirectory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? [] : Promise.reject(error));
  for (const entry of entries) {
    if (entry.isDirectory() && isManagedSkill(entry.name)) {
      await fs.rm(path.join(skillsDirectory, entry.name), { recursive: true, force: true });
    }
  }
}
