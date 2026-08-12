import type { ProfileStore } from "../config/profile-store.js";
import { sanitizeCredential } from "./shared.js";
import { LocalAppLifecycleError, lifecycleError } from "../errors.js";
import { LocalAppClient } from "../http/localapp-client.js";
import { loadAndValidateProjectManifest } from "../project/check.js";
import { resolveProjectTarget } from "../project/target.js";

const POLL_INTERVAL_MS = 250;
const TERMINAL_FAILURES = new Set(["rolled-back", "failed", "recovery-required"]);

export interface SyncJob {
  id: string;
  status: string;
  error?: string | null;
  [key: string]: unknown;
}

export class SyncJobFailure extends LocalAppLifecycleError {
  constructor(readonly status: "rolled-back" | "failed" | "recovery-required", readonly job: SyncJob, message: string) {
    super(`application_sync_${status.replaceAll("-", "_")}`, message);
    this.name = "SyncJobFailure";
  }
}

export interface SyncApplicationOptions {
  projectDir: string;
  target?: string;
  peer: string;
  withData: boolean;
  confirmation?: string;
  profileStore?: Pick<ProfileStore, "resolve">;
  wait?: (milliseconds: number) => Promise<void>;
}

export async function syncApplication(options: SyncApplicationOptions): Promise<SyncJob> {
  const manifest = await loadAndValidateProjectManifest(options.projectDir);
  if (options.withData && options.confirmation !== manifest.name) {
    throw lifecycleError("application_sync_confirmation_required", `--with-data requires --confirm-app ${manifest.name}`);
  }
  const target = await resolveProjectTarget({ projectDir: options.projectDir, target: options.target, profileStore: options.profileStore });
  const client = new LocalAppClient(target);
  const started = await client.startApplicationSync(manifest.name, options.withData
    ? { peerName: options.peer, withData: true, confirmation: manifest.name }
    : { peerName: options.peer, withData: false });
  if (!started.ok || !successfulEnvelope(started.body) || !isSyncJob(started.body.data)) {
    throw lifecycleError("application_sync_start_failed", safeResponseMessage(started, target.apiKey, "Could not start application synchronization"));
  }
  const wait = options.wait ?? ((milliseconds: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)));
  let job = started.body.data;
  while (true) {
    if (job.status === "completed") return job;
    if (TERMINAL_FAILURES.has(job.status)) {
      const status = job.status as "rolled-back" | "failed" | "recovery-required";
      const sanitizedJob = sanitizeCredential(job, target.apiKey) as SyncJob;
      throw new SyncJobFailure(status, sanitizedJob, safeJobMessage(sanitizedJob, target.apiKey));
    }
    await wait(POLL_INTERVAL_MS);
    const polled = await client.getSyncJob(job.id);
    if (!polled.ok || !successfulEnvelope(polled.body) || !isSyncJob(polled.body.data)) {
      throw lifecycleError("application_sync_status_failed", safeResponseMessage(polled, target.apiKey, "Could not read application synchronization status"));
    }
    job = polled.body.data;
  }
}

function successfulEnvelope(value: unknown): value is { success: true; data: unknown } {
  return typeof value === "object" && value !== null && (value as Record<string, unknown>).success === true && "data" in value;
}

function isSyncJob(value: unknown): value is SyncJob {
  return typeof value === "object" && value !== null
    && typeof (value as Record<string, unknown>).id === "string"
    && typeof (value as Record<string, unknown>).status === "string";
}

function safeJobMessage(job: SyncJob, credential: string): string {
  return typeof job.error === "string" && job.error.length > 0
    ? job.error.replaceAll(credential, "[REDACTED]")
    : "Application synchronization failed";
}

function safeResponseMessage(response: { ok: false; error: string } | { ok: true; body: unknown }, credential: string, fallback: string): string {
  const candidate = response.ok
    ? response.body && typeof response.body === "object" && !Array.isArray(response.body)
      ? (response.body as Record<string, unknown>).error ?? (response.body as Record<string, unknown>).message
      : undefined
    : response.error;
  return typeof candidate === "string" && candidate.length > 0 ? candidate.replaceAll(credential, "[REDACTED]") : fallback;
}
