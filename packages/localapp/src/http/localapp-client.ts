import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { normalizeServerUrl, type ServerProfile } from "../config/profile-store.js";

const PRODUCT_VERSION = "0.1.0";

export type JsonResult =
  | { ok: true; status: number; body: unknown }
  | { ok: false; status?: number; error: string };

export interface JsonRequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
}

export class LocalAppClient {
  private readonly serverUrl: string;
  private readonly apiKey: string;

  constructor(profile: Pick<ServerProfile, "serverUrl" | "apiKey">) {
    this.serverUrl = normalizeServerUrl(profile.serverUrl);
    this.apiKey = profile.apiKey;
  }

  async requestJson(path: string, options: JsonRequestOptions = {}): Promise<JsonResult> {
    const body = options.body === undefined ? undefined : JSON.stringify(options.body);
    return this.request(path, {
      method: options.method ?? "GET",
      body,
      timeoutMs: options.timeoutMs ?? 30_000,
      headers: options.body === undefined ? {} : { "content-type": "application/json" },
    });
  }

  async getJson(path: string, timeoutMs = 30_000): Promise<JsonResult> {
    return this.requestJson(path, { method: "GET", timeoutMs });
  }

  async postJson(path: string, body: unknown, timeoutMs = 30_000): Promise<JsonResult> {
    return this.requestJson(path, { method: "POST", body, timeoutMs });
  }

  async installPackage(packagePath: string): Promise<JsonResult> {
    const form = new FormData();
    form.set("package", new Blob([await readFile(packagePath)], { type: "application/octet-stream" }), basename(packagePath));
    return this.request("/api/me/apps/install", { method: "POST", body: form, timeoutMs: 30_000, headers: {} });
  }

  private async request(path: string, options: { method: "GET" | "POST"; body?: BodyInit; timeoutMs: number; headers: Record<string, string> }): Promise<JsonResult> {
    if (!path.startsWith("/") || path.startsWith("//")) return { ok: false, error: "Request path must be relative to the LocalApp Server" };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(`${this.serverUrl}${path}`, {
        method: options.method,
        body: options.body,
        headers: { "X-API-Key": this.apiKey, "X-CLI-Version": PRODUCT_VERSION, ...options.headers },
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
      if (!response.ok) return { ok: false, status: response.status, error: "Server returned an unsuccessful response" };
      return { ok: true, status: response.status, body };
    } catch {
      return { ok: false, error: controller.signal.aborted ? "Request timed out" : "Request failed" };
    } finally {
      clearTimeout(timeout);
    }
  }
}
