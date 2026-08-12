import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { normalizeServerUrl, type ServerProfile } from "../config/profile-store.js";
import { loadPackageVersion } from "../version.js";

export type JsonResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status?: number; error: string };

export interface JsonRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

export interface LocalAppClientDependencies {
  setTimeout?: (callback: () => void, timeoutMs: number) => TimerHandle;
  clearTimeout?: (handle: TimerHandle) => void;
}

export class LocalAppClient {
  private readonly serverUrl: string;
  private readonly apiKey: string;
  private readonly setTimeout: (callback: () => void, timeoutMs: number) => TimerHandle;
  private readonly clearTimeout: (handle: TimerHandle) => void;

  constructor(profile: Pick<ServerProfile, "serverUrl" | "apiKey">, dependencies: LocalAppClientDependencies = {}) {
    this.serverUrl = normalizeServerUrl(profile.serverUrl);
    this.apiKey = profile.apiKey;
    this.setTimeout = dependencies.setTimeout ?? globalThis.setTimeout;
    this.clearTimeout = dependencies.clearTimeout ?? globalThis.clearTimeout;
  }

  async requestJson(path: string, options: JsonRequestOptions = {}): Promise<JsonResult> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    return this.request(path, {
      method: options.method ?? "GET",
      body,
      timeoutMs: options.timeoutMs ?? 30_000,
      headers: options.body === undefined ? {} : { "content-type": "application/json" },
      signal: options.signal,
    });
  }

  async getJson(path: string, timeoutMs = 30_000): Promise<JsonResult> {
    return this.requestJson(path, { method: "GET", timeoutMs });
  }

  async postJson(path: string, body: unknown, timeoutMs = 30_000): Promise<JsonResult> {
    return this.requestJson(path, { method: "POST", body, timeoutMs });
  }

  async installPackage(packagePath: string, signal?: AbortSignal): Promise<JsonResult> {
    const form = new FormData();
    form.set("package", new Blob([await readFile(packagePath, { signal })], { type: "application/octet-stream" }), basename(packagePath));
    return this.request("/api/me/apps/install", { method: "POST", body: form, timeoutMs: 30_000, headers: {}, signal });
  }

  async startApplicationSync(name: string, input: { peerName: string; withData: boolean; confirmation?: string }): Promise<JsonResult> {
    return this.postJson(`/api/me/apps/${encodeURIComponent(name)}/sync`, input);
  }

  async getSyncJob(id: string): Promise<JsonResult> {
    return this.getJson(`/api/sync-jobs/${encodeURIComponent(id)}`);
  }

  private async request(path: string, options: {
    method: "GET" | "POST";
    body?: BodyInit;
    timeoutMs: number;
    headers: Record<string, string>;
    signal?: AbortSignal;
  }): Promise<JsonResult> {
    if (!path.startsWith("/") || path.startsWith("//")) return { ok: false, error: "Request path must be relative to the LocalApp Server" };
    const controller = new AbortController();
    let timedOut = false;
    const timeout = this.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onExternalAbort, { once: true });
    if (options.signal?.aborted) onExternalAbort();
    try {
      const version = await loadPackageVersion();
      const response = await fetch(`${this.serverUrl}${path}`, {
        method: options.method,
        body: options.body,
        headers: { "X-API-Key": this.apiKey, "X-CLI-Version": version, ...options.headers },
        redirect: "manual",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        return { ok: false, status: response.status, error: "Server redirected the request" };
      }
      let body: unknown;
      try {
        body = JSON.parse(await response.text());
      } catch {
        return { ok: false, status: response.status, error: "Server response was not valid JSON" };
      }
      if (!response.ok) return { ok: false, status: response.status, error: this.publicError(body) };
      return { ok: true, status: response.status, body };
    } catch {
      return {
        ok: false,
        error: options.signal?.aborted ? "Request aborted" : timedOut ? "Request timed out" : "Request failed",
      };
    } finally {
      this.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", onExternalAbort);
    }
  }

  private publicError(body: unknown): string {
    const value = typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>).error ?? (body as Record<string, unknown>).message
      : undefined;
    return typeof value === "string" && value.length > 0
      ? value.replaceAll(this.apiKey, "[REDACTED]")
      : "Server returned an unsuccessful response";
  }
}
