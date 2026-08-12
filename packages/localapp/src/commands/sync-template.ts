import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError, LocalAppLifecycleError } from "../errors.js";
import {
  captureDirectoryGuard,
  capturePathIdentity,
  createGuardedCopyDestination,
  guardedCreateDirectory,
  guardedCreateTemporaryDirectory,
  guardedRemoveTree,
  guardedRename,
  managedSkillNames,
  readProjectConfig,
  verifyDirectoryGuard,
  verifyManagedProject,
  verifyProjectBase,
  type DirectoryGuard,
  type LifecycleMutationHooks,
  type PathIdentity,
} from "../project/safety.js";
import { copyManagedZone, resolveTemplateDirectory } from "./init.js";

export interface SyncResult {
  updated: boolean;
  version: string;
}

interface PathReference {
  path: string;
  parent: DirectoryGuard;
  identity: PathIdentity;
}

interface SwapEntry {
  currentPath: string;
  currentParent: DirectoryGuard;
  current?: PathReference;
  staged?: PathReference;
  backupPath: string;
  backupParent: DirectoryGuard;
  movedCurrent: boolean;
  installedStaged: boolean;
}

interface RecoveryRoot {
  path: string;
  parent: DirectoryGuard;
  guard: DirectoryGuard;
  identity: PathIdentity;
}

export async function syncManagedTemplate(
  projectDir: string,
  { quiet }: { quiet: boolean },
  hooks: LifecycleMutationHooks = {},
): Promise<SyncResult> {
  const project = await verifyProjectBase(projectDir);
  const config = await readProjectConfig(project);
  assertSyncAllowed(config);
  await verifyManagedProject(project);
  const templateDirectory = await resolveTemplateDirectory();
  const stageRoot = await createRecoveryRoot(".sync-stage-", project.localAppGuard, hooks);
  let backupRoot: RecoveryRoot | undefined;
  let swaps: SwapEntry[] = [];
  let version = "";

  try {
    backupRoot = await createRecoveryRoot(".sync-backup-", project.localAppGuard, hooks);
    await copyManagedZone(templateDirectory, stageRoot.path, createGuardedCopyDestination(stageRoot.guard, hooks));
    const stagedLocalApp = await captureDirectoryGuard(path.join(stageRoot.path, ".localapp"), stageRoot.guard);
    const stagedRuntimePath = path.join(stagedLocalApp.directory, "runtime");
    const stagedRuntime = await pathReference(stagedRuntimePath, stagedLocalApp);
    const stagedClaude = await captureDirectoryGuard(path.join(stageRoot.path, ".claude"), stageRoot.guard);
    const stagedSkills = await captureDirectoryGuard(path.join(stagedClaude.directory, "skills"), stagedClaude);
    version = await readStagedVersion(stagedRuntimePath);
    const oldSkills = await managedSkillNames(project.skillsDirectory, project.skillsGuard);
    const newSkills = await managedSkillNames(stagedSkills.directory, stagedSkills);
    const backupSkills = await guardedCreateDirectory({
      target: path.join(backupRoot.path, "skills"),
      parent: backupRoot.guard,
      hooks,
    });
    swaps = [
      {
        currentPath: project.runtimeDirectory,
        currentParent: project.localAppGuard,
        current: await pathReference(project.runtimeDirectory, project.localAppGuard),
        staged: stagedRuntime,
        backupPath: path.join(backupRoot.path, "runtime"),
        backupParent: backupRoot.guard,
        movedCurrent: false,
        installedStaged: false,
      },
      ...await Promise.all([...new Set([...oldSkills, ...newSkills])].sort().map(async (name): Promise<SwapEntry> => ({
        currentPath: path.join(project.skillsDirectory, name),
        currentParent: project.skillsGuard,
        ...(oldSkills.includes(name) ? { current: await pathReference(path.join(project.skillsDirectory, name), project.skillsGuard) } : {}),
        ...(newSkills.includes(name) ? { staged: await pathReference(path.join(stagedSkills.directory, name), stagedSkills) } : {}),
        backupPath: path.join(backupSkills.directory, name),
        backupParent: backupSkills,
        movedCurrent: false,
        installedStaged: false,
      }))),
    ];

    for (const swap of swaps) await applySwap(swap, hooks);
  } catch (error) {
    const rollbackSucceeded = await rollbackSwaps(swaps, hooks);
    if (!rollbackSucceeded) {
      throw lifecycleError(
        "template_sync_recovery_required",
        "Managed template rollback failed. Recovery data remains in .localapp/.sync-backup-* and .localapp/.sync-stage-*; restore it before retrying.",
      );
    }
    await cleanupRecoveryRoots([backupRoot, stageRoot], hooks);
    if (error instanceof LocalAppLifecycleError) throw error;
    throw lifecycleError("template_sync_failed", "Managed template sync failed. The previous managed files were restored; check project permissions and retry.");
  }

  await cleanupRecoveryRoots([backupRoot, stageRoot], hooks);
  if (!quiet) process.stderr.write(`Updated managed template files to ${version}.\n`);
  return { updated: true, version };
}

export function assertSyncAllowed(config: Record<string, unknown>): void {
  if (config.ejected === true || config.templateState === "ejected") {
    throw lifecycleError("template_ejected", "This project has been ejected. Managed template sync is permanently disabled.");
  }
  if (config.templateState === "ejecting") {
    throw lifecycleError("template_ejecting", "This project has an interrupted eject transaction. Run localapp eject-template again to finish it.");
  }
}

async function createRecoveryRoot(
  prefix: string,
  parent: DirectoryGuard,
  hooks: LifecycleMutationHooks,
): Promise<RecoveryRoot> {
  const guard = await guardedCreateTemporaryDirectory({ parent, prefix, hooks });
  return { path: guard.directory, parent, guard, identity: await capturePathIdentity(guard.directory) };
}

async function pathReference(target: string, parent: DirectoryGuard): Promise<PathReference> {
  await verifyDirectoryGuard(parent);
  return { path: target, parent, identity: await capturePathIdentity(target) };
}

async function readStagedVersion(runtimeDirectory: string): Promise<string> {
  const parsed: unknown = JSON.parse(await fs.readFile(path.join(runtimeDirectory, "version.json"), "utf8"));
  if (parsed === null || typeof parsed !== "object" || typeof (parsed as { cliVersion?: unknown }).cliVersion !== "string") {
    throw new Error("invalid staged runtime version");
  }
  return (parsed as { cliVersion: string }).cliVersion;
}

async function applySwap(swap: SwapEntry, hooks: LifecycleMutationHooks): Promise<void> {
  if (swap.current !== undefined) {
    await guardedRename({
      source: swap.current.path,
      destination: swap.backupPath,
      sourceIdentity: swap.current.identity,
      sourceParent: swap.current.parent,
      destinationParent: swap.backupParent,
      hooks,
    });
    swap.movedCurrent = true;
  }
  if (swap.staged !== undefined) {
    await guardedRename({
      source: swap.staged.path,
      destination: swap.currentPath,
      sourceIdentity: swap.staged.identity,
      sourceParent: swap.staged.parent,
      destinationParent: swap.currentParent,
      hooks,
    });
    swap.installedStaged = true;
  }
}

async function rollbackSwaps(swaps: SwapEntry[], hooks: LifecycleMutationHooks): Promise<boolean> {
  let succeeded = true;
  for (const swap of [...swaps].reverse()) {
    try {
      if (swap.installedStaged && swap.staged !== undefined) {
        await guardedRename({
          source: swap.currentPath,
          destination: swap.staged.path,
          sourceIdentity: swap.staged.identity,
          sourceParent: swap.currentParent,
          destinationParent: swap.staged.parent,
          hooks,
        });
      }
      if (swap.movedCurrent && swap.current !== undefined) {
        await guardedRename({
          source: swap.backupPath,
          destination: swap.currentPath,
          sourceIdentity: swap.current.identity,
          sourceParent: swap.backupParent,
          destinationParent: swap.currentParent,
          hooks,
        });
      }
    } catch {
      succeeded = false;
    }
  }
  return succeeded;
}

async function cleanupRecoveryRoots(
  roots: Array<RecoveryRoot | undefined>,
  hooks: LifecycleMutationHooks,
): Promise<void> {
  for (const root of roots) {
    if (root === undefined) continue;
    await guardedRemoveTree({ target: root.path, targetIdentity: root.identity, parent: root.parent, hooks }).catch(() => undefined);
  }
}
