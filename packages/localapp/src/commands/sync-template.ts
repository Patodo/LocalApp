import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError, LocalAppLifecycleError } from "../errors.js";
import {
  lstatOptional,
  managedSkillNames,
  readProjectConfig,
  removeVerifiedTree,
  verifyManagedProject,
  verifyProjectBase,
} from "../project/safety.js";
import { copyManagedZone, resolveTemplateDirectory } from "./init.js";

export interface SyncResult {
  updated: boolean;
  version: string;
}

export interface LifecycleMoveOperations {
  rename(source: string, destination: string): Promise<void>;
}

const defaultMoveOperations: LifecycleMoveOperations = { rename: (source, destination) => fs.rename(source, destination) };

interface SwapEntry {
  current: string;
  staged?: string;
  backup: string;
  movedCurrent: boolean;
  installedStaged: boolean;
}

export async function syncManagedTemplate(
  projectDir: string,
  { quiet }: { quiet: boolean },
  operations: LifecycleMoveOperations = defaultMoveOperations,
): Promise<SyncResult> {
  const project = await verifyProjectBase(projectDir);
  const config = await readProjectConfig(project);
  assertSyncAllowed(config);
  await verifyManagedProject(project);
  const templateDirectory = await resolveTemplateDirectory();
  const stageRoot = await fs.mkdtemp(path.join(project.localAppDirectory, ".sync-stage-"));
  const backupRoot = await fs.mkdtemp(path.join(project.localAppDirectory, ".sync-backup-"));
  let swaps: SwapEntry[] = [];

  try {
    await copyManagedZone(templateDirectory, stageRoot);
    const stagedRuntime = path.join(stageRoot, ".localapp/runtime");
    const stagedSkills = path.join(stageRoot, ".claude/skills");
    const version = await readStagedVersion(stagedRuntime);
    const oldSkills = await managedSkillNames(project.skillsDirectory);
    const newSkills = await managedSkillNames(stagedSkills);
    await fs.mkdir(path.join(backupRoot, "skills"));
    swaps = [
      createSwap(project.runtimeDirectory, stagedRuntime, path.join(backupRoot, "runtime")),
      ...[...new Set([...oldSkills, ...newSkills])].sort().map((name) => createSwap(
        path.join(project.skillsDirectory, name),
        newSkills.includes(name) ? path.join(stagedSkills, name) : undefined,
        path.join(backupRoot, "skills", name),
      )),
    ];

    for (const swap of swaps) await applySwap(swap, operations);
    await removeVerifiedTree(backupRoot);
    await removeVerifiedTree(stageRoot);
    if (!quiet) process.stderr.write(`Updated managed template files to ${version}.\n`);
    return { updated: true, version };
  } catch (error) {
    const rollbackSucceeded = await rollbackSwaps(swaps, operations);
    await removeVerifiedTree(stageRoot).catch(() => undefined);
    await removeVerifiedTree(backupRoot).catch(() => undefined);
    if (error instanceof LocalAppLifecycleError) throw error;
    if (!rollbackSucceeded) {
      throw lifecycleError("template_sync_rollback_failed", "Managed template sync failed and rollback could not complete. Restore the managed runtime from version control before retrying.");
    }
    throw lifecycleError("template_sync_failed", "Managed template sync failed. The previous managed files were restored; check project permissions and retry.");
  }
}

export function assertSyncAllowed(config: Record<string, unknown>): void {
  if (config.ejected === true || config.templateState === "ejected") {
    throw lifecycleError("template_ejected", "This project has been ejected. Managed template sync is permanently disabled.");
  }
  if (config.templateState === "ejecting") {
    throw lifecycleError("template_ejecting", "This project has an interrupted eject transaction. Run localapp eject-template again to finish it.");
  }
}

async function readStagedVersion(runtimeDirectory: string): Promise<string> {
  const parsed: unknown = JSON.parse(await fs.readFile(path.join(runtimeDirectory, "version.json"), "utf8"));
  if (parsed === null || typeof parsed !== "object" || typeof (parsed as { cliVersion?: unknown }).cliVersion !== "string") {
    throw new Error("invalid staged runtime version");
  }
  return (parsed as { cliVersion: string }).cliVersion;
}

function createSwap(current: string, staged: string | undefined, backup: string): SwapEntry {
  return { current, staged, backup, movedCurrent: false, installedStaged: false };
}

async function applySwap(swap: SwapEntry, operations: LifecycleMoveOperations): Promise<void> {
  if (await lstatOptional(swap.current) !== undefined) {
    await operations.rename(swap.current, swap.backup);
    swap.movedCurrent = true;
  }
  if (swap.staged !== undefined) {
    await operations.rename(swap.staged, swap.current);
    swap.installedStaged = true;
  }
}

async function rollbackSwaps(swaps: SwapEntry[], operations: LifecycleMoveOperations): Promise<boolean> {
  let succeeded = true;
  for (const swap of [...swaps].reverse()) {
    try {
      if (swap.installedStaged && swap.staged !== undefined) await operations.rename(swap.current, swap.staged);
      if (swap.movedCurrent) await operations.rename(swap.backup, swap.current);
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}
