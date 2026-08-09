import { AppInstallError, installAppPackage, type InstallOutcome } from "./app-installer.js";
import { inspectAppPackage } from "./app-package.js";
import { readPageMeta } from "../plugins/storage.js";
import { SyncSessionError, SyncSessionStore, type SyncSessionRecord } from "./sync-session-store.js";

export class AppSyncTarget {
  constructor(private readonly dataDir: string, readonly sessions: SyncSessionStore) {}

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

  async commit(id: string, ownerId: string): Promise<{ session: SyncSessionRecord; outcome: InstallOutcome }> {
    const session = this.sessions.getOwned(id, ownerId);
    if (!session) throw new SyncSessionError("SYNC_SESSION_NOT_FOUND", "Synchronization session not found", 404);
    if (session.status === "completed" && session.outcome) {
      return { session, outcome: session.outcome as unknown as InstallOutcome };
    }
    if (session.status !== "uploaded" && session.status !== "failed") {
      throw new SyncSessionError("SYNC_PACKAGE_REQUIRED", "A verified package upload is required", 409);
    }
    const packagePath = this.sessions.packagePath(id);
    const inspected = await inspectAppPackage(packagePath);
    if (inspected.name !== session.appName || inspected.version !== session.appVersion || inspected.digest !== session.packageDigest) {
      throw new SyncSessionError("SYNC_PACKAGE_METADATA_MISMATCH", "Package metadata does not match the synchronization session", 409);
    }
    this.sessions.transition(id, ownerId, "committing");
    try {
      const outcome = await installAppPackage({ dataDir: this.dataDir, ownerId, packagePath, preserveTargetAccess: true });
      return { session: this.sessions.transition(id, ownerId, "completed", { outcome: outcome as unknown as Record<string, unknown> }), outcome };
    } catch (error) {
      this.sessions.transition(id, ownerId, "failed", { error: publicInstallError(error) });
      throw error;
    }
  }

  reconcileInterrupted(): number {
    let reconciled = 0;
    for (const session of this.sessions.list()) {
      if (session.status !== "committing") continue;
      const meta = readPageMeta(this.dataDir, session.ownerId, session.appName);
      const version = meta?.versions.find((entry) => entry.appVersion === session.appVersion && entry.digest === session.packageDigest);
      if (meta && version) {
        const outcome: InstallOutcome = {
          name: session.appName, ownerId: session.ownerId, localVersion: version.version,
          appVersion: session.appVersion, digest: session.packageDigest,
          created: false, upgraded: false, idempotent: true,
        };
        this.sessions.transition(session.id, session.ownerId, "completed", { outcome: outcome as unknown as Record<string, unknown> });
      } else {
        this.sessions.transition(session.id, session.ownerId, "failed", { error: "Server restarted before synchronization commit completed" });
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
