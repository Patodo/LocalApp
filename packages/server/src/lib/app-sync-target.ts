import { AppInstallError, installAppPackage, verifyInstalledAppVersion, type InstallAppPackageInput, type InstallOutcome } from "./app-installer.js";
import { inspectAppPackage } from "./app-package.js";
import { readPageMeta } from "../plugins/storage.js";
import { SyncSessionError, SyncSessionStore, type SyncSessionRecord } from "./sync-session-store.js";

export class AppSyncTarget {
  private readonly commits = new Map<string, Promise<{ session: SyncSessionRecord; outcome: InstallOutcome }>>();
  private readonly install: (input: InstallAppPackageInput) => Promise<InstallOutcome>;

  constructor(
    private readonly dataDir: string,
    readonly sessions: SyncSessionStore,
    options: { install?: (input: InstallAppPackageInput) => Promise<InstallOutcome> } = {},
  ) {
    this.install = options.install ?? installAppPackage;
  }

  create(input: {
    id: string; ownerId: string; mode: "app-only"; appName: string; appVersion: string; packageDigest: string; packageSize: number;
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

  commit(id: string, ownerId: string): Promise<{ session: SyncSessionRecord; outcome: InstallOutcome }> {
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
    try {
      const outcome = await this.install({ dataDir: this.dataDir, ownerId, packagePath, preserveTargetAccess: true });
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
}

export function targetInstallStatus(error: unknown): number {
  if (error instanceof SyncSessionError) return error.statusCode;
  if (error instanceof AppInstallError) return error.code === "APP_MIGRATION_APPLY_FAILED" ? 422 : error.statusCode;
  return 400;
}

export function targetInstallCode(error: unknown): string {
  if (error instanceof SyncSessionError || error instanceof AppInstallError) return error.code;
  return "SYNC_COMMIT_FAILED";
}

function publicInstallError(error: unknown): string {
  return error instanceof AppInstallError || error instanceof SyncSessionError ? error.message : "Synchronization commit failed";
}
