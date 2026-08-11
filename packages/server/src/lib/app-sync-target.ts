import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AppInstallError, installAppPackage, rollbackAppVersion, verifyInstalledAppVersion, type InstallAppPackageInput, type InstallOutcome } from "./app-installer.js";
import { inspectAppPackage } from "./app-package.js";
import { AppDataError } from "./app-data-errors.js";
import { createAppBackup, importAppData, restoreAppBackup } from "./app-data-service.js";
import { getPageDir, readPageMeta } from "../plugins/storage.js";
import type { AppDataIdentity } from "./app-data-service.js";
import { removeDirRecursive } from "./file-utils.js";
import { SyncSessionError, SyncSessionStore, type SyncSessionRecord } from "./sync-session-store.js";

export class AppSyncTarget {
  private readonly commits = new Map<string, Promise<{ session: SyncSessionRecord; outcome: InstallOutcome }>>();
  private readonly install: (input: InstallAppPackageInput) => Promise<InstallOutcome>;
  private readonly createBackup: typeof createAppBackup;
  private readonly importData: typeof importAppData;
  private readonly restoreBackup: typeof restoreAppBackup;
  private readonly rollbackVersion: typeof rollbackAppVersion;

  constructor(
    private readonly dataDir: string,
    readonly sessions: SyncSessionStore,
    options: {
      install?: (input: InstallAppPackageInput) => Promise<InstallOutcome>;
      createBackup?: typeof createAppBackup;
      importData?: typeof importAppData;
      restoreBackup?: typeof restoreAppBackup;
      rollbackVersion?: typeof rollbackAppVersion;
    } = {},
  ) {
    this.install = options.install ?? installAppPackage;
    this.createBackup = options.createBackup ?? createAppBackup;
    this.importData = options.importData ?? importAppData;
    this.restoreBackup = options.restoreBackup ?? restoreAppBackup;
    this.rollbackVersion = options.rollbackVersion ?? rollbackAppVersion;
  }

  create(input: {
    id: string; ownerId: string; mode: "app-only" | "app-and-data"; appName: string; appVersion: string; packageDigest: string; packageSize: number;
    dataDigest?: string | null; dataSize?: number | null;
  }): SyncSessionRecord {
    const prior = this.sessions.get(input.id);
    if (prior && prior.ownerId !== input.ownerId) {
      throw new SyncSessionError("SYNC_SESSION_NOT_FOUND", "Synchronization session not found", 404);
    }
    const existing = readPageMeta(this.dataDir, input.ownerId, input.appName);
    const knownDigest = existing?.packageIdentities?.[input.appVersion]?.digest
      ?? existing?.versions.find((entry) => entry.appVersion === input.appVersion)?.digest;
    if (knownDigest && knownDigest !== input.packageDigest) {
      throw new SyncSessionError("APP_VERSION_DIGEST_CONFLICT", `Application version ${input.appVersion} already exists with another digest`, 409);
    }
    return this.sessions.create(input);
  }

  async commit(id: string, ownerId: string): Promise<{ session: SyncSessionRecord; outcome: InstallOutcome }> {
    const session = this.sessions.getOwned(id, ownerId);
    if (!session) return Promise.reject(new SyncSessionError("SYNC_SESSION_NOT_FOUND", "Synchronization session not found", 404));
    if (session.status === "completed" && session.outcome) {
      return Promise.resolve({ session, outcome: session.outcome as unknown as InstallOutcome });
    }
    const inFlight = this.commits.get(id);
    if (inFlight) return inFlight;
    if (session.status === "committing") {
      return Promise.reject(new SyncSessionError("SYNC_COMMIT_IN_PROGRESS", "Synchronization commit is in progress", 409));
    }
    if (session.status !== "uploaded" && session.status !== "failed") {
      return Promise.reject(new SyncSessionError("SYNC_PACKAGE_REQUIRED", "A verified package upload is required", 409));
    }
    if (session.mode === "app-and-data" && !(await hasVerifiedDataArchive(this.sessions, session))) {
      return Promise.reject(new SyncSessionError("SYNC_DATA_REQUIRED", "A verified application data upload is required", 409));
    }
    const run = this.executeCommit(session, ownerId);
    this.commits.set(id, run);
    void run.finally(() => { if (this.commits.get(id) === run) this.commits.delete(id); }).catch(() => undefined);
    return run;
  }

  private async executeCommit(session: SyncSessionRecord, ownerId: string): Promise<{ session: SyncSessionRecord; outcome: InstallOutcome }> {
    const id = session.id;
    const packagePath = this.sessions.packagePath(id);
    const inspected = await inspectAppPackage(packagePath);
    if (inspected.name !== session.appName || inspected.version !== session.appVersion || inspected.digest !== session.packageDigest) {
      throw new SyncSessionError("SYNC_PACKAGE_METADATA_MISMATCH", "Package metadata does not match the synchronization session", 409);
    }
    this.sessions.transition(id, ownerId, "committing");
    const pageDir = getPageDir(this.dataDir, ownerId, session.appName);
    const previousMeta = readPageMeta(this.dataDir, ownerId, session.appName);
    let safetyBackupId: string | undefined;
    try {
      if (session.mode === "app-and-data" && previousMeta && fsExists(path.join(pageDir, "app.db"))) {
        const safety = await this.createBackup(pageDir, {
          application: pageIdentity(previousMeta, ownerId, session.appName),
          source: "automatic",
          reason: "peer-data-sync",
        });
        safetyBackupId = safety.id;
      }
      const outcome = await this.install({ dataDir: this.dataDir, ownerId, packagePath, preserveTargetAccess: true });
      if (session.mode === "app-and-data") {
        const currentMeta = readPageMeta(this.dataDir, ownerId, session.appName);
        if (!currentMeta) throw new AppDataError("APP_DATABASE_NOT_FOUND", "Application metadata disappeared during data synchronization");
        const versionChanged = !previousMeta || currentMeta.currentVersion !== previousMeta.currentVersion;
        try {
          await this.importData({
            pageDir,
            application: pageIdentity(currentMeta, ownerId, session.appName),
            archivePath: this.sessions.dataPath(id),
            reason: "peer-data-sync",
          });
        } catch (dataError) {
          await this.rollbackAfterDataFailure({ pageDir, ownerId, appName: session.appName, previousMeta, safetyBackupId, versionChanged });
          throw dataError;
        }
      }
      return { session: this.sessions.transition(id, ownerId, "completed", { outcome: outcome as unknown as Record<string, unknown> }), outcome };
    } catch (error) {
      this.sessions.transition(id, ownerId, error instanceof AppInstallError && error.code === "APP_INSTALL_RECOVERY_REQUIRED"
        ? "recovery-required" : "failed", { error: publicInstallError(error) });
      throw error;
    }
  }

  async reconcileInterrupted(): Promise<number> {
    let reconciled = 0;
    for (const session of this.sessions.list()) {
      if (session.status !== "committing") continue;
      if (session.mode === "app-and-data") {
        this.sessions.transition(session.id, session.ownerId, "recovery-required", {
          error: "Server restarted during application and data replacement; operator verification is required",
        });
        reconciled += 1;
        continue;
      }
      try {
        const version = await verifyInstalledAppVersion({
          dataDir: this.dataDir, ownerId: session.ownerId, appName: session.appName,
          appVersion: session.appVersion, digest: session.packageDigest,
        });
        const outcome: InstallOutcome = {
          name: session.appName, ownerId: session.ownerId, localVersion: version.version,
          appVersion: session.appVersion, digest: session.packageDigest,
          created: false, upgraded: false, idempotent: true,
        };
        this.sessions.transition(session.id, session.ownerId, "completed", { outcome: outcome as unknown as Record<string, unknown> });
      } catch {
        this.sessions.transition(session.id, session.ownerId, "recovery-required", {
          error: "Server restarted before synchronization commit outcome could be verified",
        });
      }
      reconciled += 1;
    }
    return reconciled;
  }

  private async rollbackAfterDataFailure(input: {
    pageDir: string;
    ownerId: string;
    appName: string;
    previousMeta: ReturnType<typeof readPageMeta>;
    safetyBackupId?: string;
    versionChanged: boolean;
  }): Promise<void> {
    try {
      if (input.previousMeta && input.safetyBackupId) {
        const currentMeta = readPageMeta(this.dataDir, input.ownerId, input.appName);
        await this.restoreBackup(input.pageDir, input.safetyBackupId, {
          application: pageIdentity(currentMeta ?? input.previousMeta, input.ownerId, input.appName),
        });
        if (input.versionChanged) await this.rollbackVersion({ dataDir: this.dataDir, ownerId: input.ownerId, name: input.appName });
      } else if (!input.previousMeta) {
        removeDirRecursive(input.pageDir);
      } else if (input.versionChanged) {
        await this.rollbackVersion({ dataDir: this.dataDir, ownerId: input.ownerId, name: input.appName });
      }
    } catch (rollbackError) {
      throw new AppInstallError(
        "APP_INSTALL_RECOVERY_REQUIRED",
        `Application and data replacement failed and rollback could not complete: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        503,
        undefined,
        { cause: rollbackError },
      );
    }
  }
}

export function targetInstallStatus(error: unknown): number {
  if (error instanceof SyncSessionError) return error.statusCode;
  if (error instanceof AppInstallError) return error.code === "APP_MIGRATION_APPLY_FAILED" ? 422 : error.statusCode;
  if (error instanceof AppDataError) return 422;
  return 400;
}

export function targetInstallCode(error: unknown): string {
  if (error instanceof SyncSessionError || error instanceof AppInstallError || error instanceof AppDataError) return error.code;
  return "SYNC_COMMIT_FAILED";
}

function publicInstallError(error: unknown): string {
  return error instanceof AppInstallError || error instanceof SyncSessionError || error instanceof AppDataError ? error.message : "Synchronization commit failed";
}

async function hasVerifiedDataArchive(sessions: SyncSessionStore, session: SyncSessionRecord): Promise<boolean> {
  if (session.dataDigest === null || session.dataSize === null) return false;
  const archivePath = sessions.dataPath(session.id);
  if (!fsExists(archivePath)) return false;
  return fsStatSize(archivePath) === session.dataSize && await sha256File(archivePath) === session.dataDigest;
}

function pageIdentity(meta: NonNullable<ReturnType<typeof readPageMeta>>, owner: string, name: string): AppDataIdentity {
  return { owner, name, version: meta.currentVersion };
}

function fsExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

function fsStatSize(filePath: string): number {
  return fs.statSync(filePath).size;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
