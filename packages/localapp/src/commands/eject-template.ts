import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { lifecycleError, LocalAppLifecycleError } from "../errors.js";
import {
  assertTreeHasNoSymlinks,
  atomicWriteFile,
  capturePathIdentity,
  guardedRename,
  isInside,
  isManagedSkillName,
  lstatOptional,
  managedSkillNames,
  readProjectConfig,
  verifyDirectoryGuard,
  verifyManagedProject,
  verifyPathIdentity,
  verifyProjectBase,
  writeProjectConfig,
  type DirectoryGuard,
  type LifecycleMutationHooks,
  type VerifiedProject,
} from "../project/safety.js";
import { rewritePackageJsonForEjectValue } from "../template/package-json.js";

export interface EjectResult {
  ejected: true;
}

interface EjectMove {
  source: string;
  destination: string;
  device: string;
  inode: string;
}

interface EjectTransaction {
  version: 1;
  moves: EjectMove[];
  originalPackageHash: string;
  ejectedPackageHash: string;
  ejectedPackageContents: string;
}

export async function ejectManagedTemplate(
  projectDir: string,
  hooks: LifecycleMutationHooks = {},
): Promise<EjectResult> {
  const project = await verifyProjectBase(projectDir);
  let config = await readProjectConfig(project);
  if (config.ejected === true || config.templateState === "ejected") {
    throw lifecycleError("template_ejected", "This project has already been ejected. Managed template sync is permanently disabled.");
  }

  let transaction: EjectTransaction;
  if (config.templateState === "ejecting") {
    transaction = parseTransaction(config.ejectTransaction, project);
  } else {
    await verifyManagedProject(project);
    transaction = await prepareTransaction(project);
    config = { ...config, templateState: "ejecting", ejectTransaction: transaction };
    await writeProjectConfig(project, config, hooks);
  }

  try {
    for (const move of transaction.moves) await resumeMove(project, move, hooks);
    await installEjectedPackage(project, transaction, hooks);
    await hooks.beforeFinalMarker?.();
    const finalConfig: Record<string, unknown> = { ...config, ejected: true, templateState: "ejected" };
    delete finalConfig.ejectTransaction;
    await writeProjectConfig(project, finalConfig, hooks);
    return { ejected: true };
  } catch (error) {
    if (error instanceof LocalAppLifecycleError) throw error;
    throw lifecycleError("template_eject_failed", "Template eject was interrupted. No user destination was overwritten; run localapp eject-template again to resume.");
  }
}

async function prepareTransaction(project: VerifiedProject): Promise<EjectTransaction> {
  const packageContents = await fs.readFile(project.packagePath, "utf8");
  let packageJson: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(packageContents);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid package");
    packageJson = parsed as Record<string, unknown>;
  } catch {
    throw lifecycleError("invalid_project_package", "The project package.json is invalid. Repair it before ejecting the managed template.");
  }
  const ejectedPackageContents = `${JSON.stringify(rewritePackageJsonForEjectValue(packageJson), null, 2)}\n`;
  const moves: EjectMove[] = [];
  moves.push(await prepareMove(project, ".localapp/runtime", "src/_localapp_runtime"));
  for (const name of await managedSkillNames(project.skillsDirectory, project.skillsGuard)) {
    moves.push(await prepareMove(project, `.claude/skills/${name}`, `.claude/skills/custom-${name}`));
  }
  return {
    version: 1,
    moves,
    originalPackageHash: sha256(packageContents),
    ejectedPackageHash: sha256(ejectedPackageContents),
    ejectedPackageContents,
  };
}

async function prepareMove(project: VerifiedProject, source: string, destination: string): Promise<EjectMove> {
  const sourcePath = projectPath(project, source);
  const destinationPath = projectPath(project, destination);
  const sourceParent = moveParentGuard(project, source);
  const destinationParentGuard = moveParentGuard(project, destination);
  await verifyDirectoryGuard(sourceParent);
  await verifyDirectoryGuard(destinationParentGuard);
  const sourceStat = await fs.lstat(sourcePath, { bigint: true });
  if (sourceStat.isSymbolicLink() || !sourceStat.isDirectory()) throw unsafeTransaction();
  await capturePathIdentity(sourcePath);
  await assertTreeHasNoSymlinks(sourcePath);
  if (await lstatOptional(destinationPath) !== undefined) throw collision(destination);
  const destinationParent = await fs.lstat(path.dirname(destinationPath), { bigint: true });
  if (destinationParent.isSymbolicLink() || !destinationParent.isDirectory() || destinationParent.dev !== sourceStat.dev) {
    throw lifecycleError("template_eject_filesystem", "Eject requires managed sources and destinations to be directories on the same filesystem.");
  }
  return { source, destination, device: sourceStat.dev.toString(), inode: sourceStat.ino.toString() };
}

async function resumeMove(project: VerifiedProject, move: EjectMove, hooks: LifecycleMutationHooks): Promise<void> {
  const sourcePath = projectPath(project, move.source);
  const destinationPath = projectPath(project, move.destination);
  const sourceParent = moveParentGuard(project, move.source);
  const destinationParent = moveParentGuard(project, move.destination);
  const source = await fs.lstat(sourcePath, { bigint: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  const destination = await fs.lstat(destinationPath, { bigint: true }).catch((error: NodeJS.ErrnoException) => error.code === "ENOENT" ? undefined : Promise.reject(error));
  if (source !== undefined) {
    if (!matchesIdentity(source, move) || source.isSymbolicLink() || !source.isDirectory()) throw unsafeTransaction();
    await assertTreeHasNoSymlinks(sourcePath);
    if (destination !== undefined) throw collision(move.destination);
    await verifyDirectoryGuard(sourceParent);
    await verifyDirectoryGuard(destinationParent);
    const destinationParentStat = await fs.lstat(path.dirname(destinationPath), { bigint: true });
    if (destinationParentStat.dev !== source.dev) {
      throw lifecycleError("template_eject_filesystem", "Eject requires managed sources and destinations to be directories on the same filesystem.");
    }
    await guardedRename({
      source: sourcePath,
      destination: destinationPath,
      sourceIdentity: move,
      sourceParent,
      destinationParent,
      hooks,
    });
    return;
  }
  if (destination === undefined || !matchesIdentity(destination, move) || destination.isSymbolicLink() || !destination.isDirectory()) {
    throw collision(move.destination);
  }
  await verifyDirectoryGuard(destinationParent);
  await verifyPathIdentity(destinationPath, move);
  await assertTreeHasNoSymlinks(destinationPath);
}

async function installEjectedPackage(project: VerifiedProject, transaction: EjectTransaction, hooks: LifecycleMutationHooks): Promise<void> {
  const current = await fs.readFile(project.packagePath, "utf8");
  const currentHash = sha256(current);
  if (currentHash === transaction.ejectedPackageHash) return;
  if (currentHash !== transaction.originalPackageHash) {
    throw lifecycleError("template_eject_collision", "package.json changed during eject. Restore the original file or finish the interrupted eject manually.");
  }
  await atomicWriteFile(project.packagePath, transaction.ejectedPackageContents, project.rootGuard, hooks);
}

function parseTransaction(value: unknown, project: VerifiedProject): EjectTransaction {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw unsafeTransaction();
  const candidate = value as Partial<EjectTransaction>;
  if (candidate.version !== 1 || !Array.isArray(candidate.moves) || typeof candidate.originalPackageHash !== "string"
    || typeof candidate.ejectedPackageHash !== "string" || typeof candidate.ejectedPackageContents !== "string"
    || sha256(candidate.ejectedPackageContents) !== candidate.ejectedPackageHash) throw unsafeTransaction();
  const moves = candidate.moves.map((move) => parseMove(move, project));
  if (moves.filter((move) => move.source === ".localapp/runtime" && move.destination === "src/_localapp_runtime").length !== 1) {
    throw unsafeTransaction();
  }
  if (new Set(moves.flatMap((move) => [move.source, move.destination])).size !== moves.length * 2) throw unsafeTransaction();
  return { ...candidate, version: 1, moves } as EjectTransaction;
}

function parseMove(value: unknown, project: VerifiedProject): EjectMove {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw unsafeTransaction();
  const move = value as Partial<EjectMove>;
  if (typeof move.source !== "string" || typeof move.destination !== "string" || typeof move.device !== "string" || typeof move.inode !== "string"
    || !/^\d+$/.test(move.device) || !/^\d+$/.test(move.inode)) throw unsafeTransaction();
  const runtimeMove = move.source === ".localapp/runtime" && move.destination === "src/_localapp_runtime";
  const skillMatch = /^\.claude\/skills\/([^/]+)$/.exec(move.source);
  const skillMove = skillMatch !== null && isManagedSkillName(skillMatch[1]!) && move.destination === `.claude/skills/custom-${skillMatch[1]}`;
  if (!runtimeMove && !skillMove) throw unsafeTransaction();
  projectPath(project, move.source);
  projectPath(project, move.destination);
  return move as EjectMove;
}

function projectPath(project: VerifiedProject, relative: string): string {
  const target = path.resolve(project.root, relative);
  if (!isInside(project.root, target)) throw unsafeTransaction();
  return target;
}

function matchesIdentity(stat: { dev: bigint; ino: bigint }, move: EjectMove): boolean {
  return stat.dev.toString() === move.device && stat.ino.toString() === move.inode;
}

function moveParentGuard(project: VerifiedProject, relativePath: string): DirectoryGuard {
  if (relativePath.startsWith(".localapp/")) return project.localAppGuard;
  if (relativePath.startsWith(".claude/skills/")) return project.skillsGuard;
  if (relativePath.startsWith("src/")) return project.sourceGuard;
  throw unsafeTransaction();
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function collision(relativePath: string): ReturnType<typeof lifecycleError> {
  return lifecycleError("template_eject_collision", `Eject destination already exists: ${relativePath}. Move or remove it before retrying.`);
}

function unsafeTransaction(): ReturnType<typeof lifecycleError> {
  return lifecycleError("unsafe_project_path", "The persisted eject transaction or one of its managed paths is unsafe. Restore the project from version control before retrying.");
}
