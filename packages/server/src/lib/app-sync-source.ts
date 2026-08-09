import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { inspectAppPackage } from "./app-package.js";
import { PeerStore } from "./peer-store.js";
import { SyncJobStore, type SyncJobRecord, type SyncJobStatus } from "./sync-job-store.js";
import { getPageDir, readPageMeta } from "../plugins/storage.js";

const TERMINAL = new Set<SyncJobStatus>(["completed", "rolled-back", "failed", "recovery-required"]);
const CANCELLABLE = new Set<SyncJobStatus>(["queued", "staging", "validating", "backing-up", "installing", "activating"]);
const PEER_ERROR_CODES = new Set([
  "APP_VERSION_DIGEST_CONFLICT", "APP_MIGRATION_APPLY_FAILED", "APP_MIGRATION_CONFLICT", "APP_BACKEND_INVALID",
  "APP_MANIFEST_INVALID", "APP_HEALTH_CHECK_FAILED", "APP_PLATFORM_VERSION_MISMATCH",
  "SYNC_SESSION_CONFLICT", "SYNC_SESSION_NOT_FOUND", "SYNC_PACKAGE_TOO_LARGE", "SYNC_PACKAGE_SIZE_MISMATCH",
  "SYNC_PACKAGE_DIGEST_MISMATCH", "SYNC_PACKAGE_METADATA_MISMATCH", "SYNC_PACKAGE_REQUIRED", "SYNC_CANNOT_CANCEL",
  "SYNC_COMMIT_IN_PROGRESS", "SYNC_RECOVERY_REQUIRED",
]);

interface AppSyncSourceOptions {
  uploadTimeoutMs?: number;
  commitTimeoutMs?: number;
  commitRetryDelayMs?: number;
  cancelTimeoutMs?: number;
}

export class SyncSourceError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code = "SYNC_FAILED") {
    super(message);
    this.name = "SyncSourceError";
  }
}

export class AppSyncSource {
  private readonly emitters = new Map<string, EventEmitter>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly activePeers = new Map<string, { baseUrl: string; apiKey: string }>();
  private readonly runs = new Set<Promise<void>>();

  constructor(
    private readonly dataDir: string,
    readonly jobs: SyncJobStore,
    private readonly peers: PeerStore,
    private readonly options: AppSyncSourceOptions = {},
  ) {}

  async start(input: { ownerId: string; appName: string; peerId: string; withData: false }): Promise<SyncJobRecord> {
    const syncId = randomUUID();
    const job = this.jobs.create({ ...input, syncId });
    try {
      this.change(job.id, "staging");
      const active = await activePackage(this.dataDir, input.ownerId, input.appName);
      this.jobs.setPackage(job.id, { appVersion: active.appVersion, packageDigest: active.digest, packageSize: active.size });
      this.change(job.id, "validating");
      const target = this.peers.loadForCheck(input.peerId);
      if (!target) throw new SyncSourceError(404, "Peer not found", "PEER_NOT_FOUND");
      const response = await peerFetch(`${target.baseUrl}/api/peer/sync-sessions`, target.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          id: syncId, mode: "app-only", appName: input.appName, appVersion: active.appVersion,
          packageDigest: active.digest, packageSize: active.size,
        }),
      });
      if (!response.ok) throw await sourceResponseError(response);
      this.change(job.id, "backing-up");
      const controller = new AbortController();
      this.controllers.set(job.id, controller);
      this.activePeers.set(job.id, { baseUrl: target.baseUrl, apiKey: target.apiKey });
      setImmediate(() => {
        const run = this.run(job.id, active.path, target.baseUrl, target.apiKey, controller);
        this.runs.add(run);
        void run.finally(() => this.runs.delete(run));
      });
      return this.jobs.get(job.id)!;
    } catch (error) {
      this.fail(job.id, error);
      throw error;
    }
  }

  events(id: string): EventEmitter {
    let emitter = this.emitters.get(id);
    if (!emitter) { emitter = new EventEmitter(); this.emitters.set(id, emitter); }
    return emitter;
  }

  async cancel(id: string, ownerId: string): Promise<SyncJobRecord> {
    const job = this.jobs.getOwned(id, ownerId);
    if (!job) throw new SyncSourceError(404, "Synchronization job not found", "SYNC_JOB_NOT_FOUND");
    if (!CANCELLABLE.has(job.status)) throw new SyncSourceError(409, "Synchronization can no longer be cancelled", "SYNC_CANNOT_CANCEL");
    const target = this.activePeers.get(id) ?? this.peers.loadForCheck(job.peerId);
    if (!target) throw new SyncSourceError(409, "Peer is unavailable; cancellation cannot be verified", "SYNC_CANNOT_CANCEL");
    {
      const deadline = createDeadlineSignal(undefined, this.options.cancelTimeoutMs ?? 10_000);
      try {
        const response = await peerFetch(`${target.baseUrl}/api/peer/sync-sessions/${encodeURIComponent(job.syncId)}`, target.apiKey, {
          method: "DELETE", signal: deadline.signal,
        });
        if (!response.ok && response.status !== 404) throw await sourceResponseError(response);
      } catch (error) {
        if (deadline.timedOut()) throw new SyncSourceError(504, "Peer cancellation timed out", "SYNC_CANCEL_TIMEOUT");
        throw error;
      } finally { deadline.dispose(); }
    }
    this.controllers.get(id)?.abort();
    return this.change(id, "failed", "Cancelled");
  }

  async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled(this.runs);
    this.controllers.clear();
    this.activePeers.clear();
    this.emitters.clear();
  }

  private async run(jobId: string, packagePath: string, baseUrl: string, apiKey: string, controller: AbortController): Promise<void> {
    try {
      const job = this.jobs.get(jobId);
      if (!job || TERMINAL.has(job.status)) return;
      this.change(jobId, "installing");
      const uploadDeadline = createDeadlineSignal(controller.signal, this.options.uploadTimeoutMs ?? 60_000);
      let upload: Response;
      try {
        upload = await peerFetch(`${baseUrl}/api/peer/sync-sessions/${encodeURIComponent(job.syncId)}/package`, apiKey, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(job.packageSize) },
          body: fs.createReadStream(packagePath),
          signal: uploadDeadline.signal,
          duplex: "half",
        });
      } catch (error) {
        if (uploadDeadline.timedOut()) throw new SyncSourceError(504, "Peer package upload timed out", "SYNC_UPLOAD_TIMEOUT");
        throw error;
      } finally { uploadDeadline.dispose(); }
      if (!upload.ok) throw await sourceResponseError(upload);
      if (TERMINAL.has(this.jobs.get(jobId)!.status)) return;
      this.change(jobId, "activating");
      await this.commitUntilTerminal(jobId, baseUrl, apiKey, controller);
    } catch (error) {
      if (!TERMINAL.has(this.jobs.get(jobId)?.status ?? "failed")) this.fail(jobId, error);
    } finally {
      this.controllers.delete(jobId);
      this.activePeers.delete(jobId);
    }
  }

  private async commitUntilTerminal(jobId: string, baseUrl: string, apiKey: string, controller: AbortController): Promise<void> {
    const job = this.jobs.get(jobId)!;
    const timeoutMs = this.options.commitTimeoutMs ?? 60_000;
    const deadlineAt = Date.now() + timeoutMs;
    let lastError: unknown;
    while (Date.now() < deadlineAt) {
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error("Synchronization cancelled");
      const remaining = Math.max(1, deadlineAt - Date.now());
      const deadline = createDeadlineSignal(controller.signal, remaining);
      try {
        const response = await peerFetch(`${baseUrl}/api/peer/sync-sessions/${encodeURIComponent(job.syncId)}/commit`, apiKey, {
          method: "POST", signal: deadline.signal,
        });
        if (response.ok) {
          this.change(jobId, "completed");
          return;
        }
        const error = await sourceResponseError(response);
        if (error.code !== "SYNC_COMMIT_IN_PROGRESS") {
          this.change(jobId, "failed", error.message);
          return;
        }
        lastError = error;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        lastError = error;
      } finally { deadline.dispose(); }
      const delay = Math.min(this.options.commitRetryDelayMs ?? 100, Math.max(0, deadlineAt - Date.now()));
      if (delay > 0) await abortableDelay(delay, controller.signal);
    }
    this.change(jobId, "recovery-required", lastError instanceof Error
      ? "Target commit outcome could not be verified before the deadline"
      : "Target commit deadline expired before its outcome could be verified");
  }

  private fail(id: string, error: unknown): SyncJobRecord {
    return this.change(id, "failed", error instanceof SyncSourceError ? error.message : "Synchronization failed");
  }

  private change(id: string, status: SyncJobStatus, error?: string): SyncJobRecord {
    const job = this.jobs.transition(id, status, error);
    this.events(id).emit("status", job);
    return job;
  }
}

async function activePackage(dataDir: string, ownerId: string, appName: string): Promise<{ path: string; appVersion: string; digest: string; size: number }> {
  const meta = readPageMeta(dataDir, ownerId, appName);
  if (!meta) throw new SyncSourceError(404, "Application not found", "APP_NOT_FOUND");
  const active = meta.versions.find((entry) => entry.version === meta.currentVersion);
  if (!active?.appVersion || !active.digest || !active.packagePath) {
    throw new SyncSourceError(409, "Active application version has no retained portable package", "APP_PACKAGE_NOT_RETAINED");
  }
  const pageDir = path.resolve(getPageDir(dataDir, ownerId, appName));
  const packageRoot = path.join(pageDir, ".packages");
  const packagePath = path.resolve(pageDir, active.packagePath);
  if (path.dirname(packagePath) !== packageRoot || !fs.existsSync(packagePath)) {
    throw new SyncSourceError(409, "Active application package is unavailable", "APP_PACKAGE_NOT_RETAINED");
  }
  const inspected = await inspectAppPackage(packagePath);
  if (inspected.name !== appName || inspected.version !== active.appVersion || inspected.digest !== active.digest) {
    throw new SyncSourceError(409, "Retained application package does not match active metadata", "APP_PACKAGE_MISMATCH");
  }
  return { path: packagePath, appVersion: active.appVersion, digest: active.digest, size: fs.statSync(packagePath).size };
}

type NodeRequestInit = Omit<RequestInit, "body"> & { body?: RequestInit["body"] | NodeJS.ReadableStream; duplex?: "half" };

async function peerFetch(url: string, apiKey: string, init: NodeRequestInit): Promise<Response> {
  return fetch(url, {
    ...init,
    redirect: "error",
    headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${apiKey}` },
  } as unknown as RequestInit);
}

async function sourceResponseError(response: Response): Promise<SyncSourceError> {
  const body = await response.json().catch(() => null) as { code?: unknown; error?: unknown } | null;
  const code = typeof body?.code === "string" && PEER_ERROR_CODES.has(body.code) ? body.code : "PEER_SYNC_FAILED";
  return new SyncSourceError(response.status, `Peer synchronization failed (${response.status})`, code);
}

function createDeadlineSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal; timedOut: () => boolean; dispose: () => void;
} {
  const controller = new AbortController();
  let timeout = false;
  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => { timeout = true; controller.abort(new Error("deadline exceeded")); }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    timedOut: () => timeout,
    dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", abortFromParent); },
  };
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    function done() { signal.removeEventListener("abort", abort); resolve(); }
    signal.addEventListener("abort", abort, { once: true });
  });
}
