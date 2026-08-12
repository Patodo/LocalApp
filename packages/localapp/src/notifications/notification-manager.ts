import { DeliveryStore, type ClickIntent } from "./delivery-store.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";
import { SourceConnection, type NotificationSourceConfig, type SourceConnectionStatus, type SourceSocket } from "./source-connection.js";
import type { BrowserOpener, NotificationTicketResolver } from "../activation/activation-broker.js";

export interface NotificationConnectionManagerOptions {
  localServerOrigin: string;
  controlToken: string;
  store: DeliveryStore;
  dispatcher: NotificationDispatcher;
  fetch?: typeof globalThis.fetch;
  createSocket?: (url: string, credential: string) => SourceSocket;
}

export class NotificationConnectionManager {
  private readonly options: NotificationConnectionManagerOptions;
  private readonly controller = new AbortController();
  private readonly connections = new Map<string, SourceConnection>();
  private readonly sources = new Map<string, NotificationSourceConfig>();
  private pollPromise: Promise<void> | undefined;
  private generation: number | undefined;

  constructor(options: NotificationConnectionManagerOptions) {
    this.options = options;
  }

  start(): void {
    if (this.pollPromise !== undefined) return;
    this.pollPromise = this.poll().finally(() => { this.pollPromise = undefined; });
    void this.pollPromise.catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.controller.abort();
    await Promise.all([...this.connections.values()].map((connection) => connection.stop()));
    this.connections.clear();
    this.sources.clear();
    await this.pollPromise?.catch(() => undefined);
  }

  currentSource(id: string): NotificationSourceConfig | undefined {
    const source = this.sources.get(id);
    return source === undefined ? undefined : { ...source };
  }

  private async poll(): Promise<void> {
    while (!this.controller.signal.aborted) {
      try {
        const query = this.generation === undefined ? "" : `?generation=${this.generation}&waitMs=30000`;
        const response = await (this.options.fetch ?? globalThis.fetch)(`${this.options.localServerOrigin}/api/internal/device-notifications/sources${query}`, {
          headers: { "x-localapp-notification-control": this.options.controlToken },
          redirect: "error",
          signal: this.controller.signal,
        });
        if (!response.ok || response.redirected) throw new Error("notification source snapshot failed");
        const snapshot = parseSnapshot(await response.json());
        if (snapshot.generation !== this.generation) await this.reconfigure(snapshot.sources);
        this.generation = snapshot.generation;
      } catch {
        if (this.controller.signal.aborted) return;
        await delay(500, this.controller.signal).catch(() => undefined);
      }
    }
  }

  private async reconfigure(nextSources: NotificationSourceConfig[]): Promise<void> {
    const next = new Map(nextSources.map((source) => [source.id, source]));
    for (const [id, connection] of this.connections) {
      const source = next.get(id);
      const current = this.sources.get(id);
      if (source === undefined || !source.enabled || JSON.stringify(source) !== JSON.stringify(current)) {
        await connection.stop();
        this.connections.delete(id);
        if (source === undefined || !source.enabled) await this.options.store.disableSource(id);
      }
    }
    this.sources.clear();
    for (const source of nextSources) {
      this.sources.set(source.id, source);
      if (!source.enabled || this.connections.has(source.id)) continue;
      const connection = new SourceConnection({
        source,
        store: this.options.store,
        dispatcher: this.options.dispatcher,
        fetch: this.options.fetch,
        createSocket: this.options.createSocket,
        reportStatus: (id, status, signal) => this.reportStatus(id, status, signal),
      });
      this.connections.set(source.id, connection);
      connection.start();
    }
  }

  private async reportStatus(id: string, status: SourceConnectionStatus, signal: AbortSignal): Promise<void> {
    const response = await (this.options.fetch ?? globalThis.fetch)(`${this.options.localServerOrigin}/api/internal/device-notifications/sources/${id}/status`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-localapp-notification-control": this.options.controlToken },
      body: JSON.stringify(status),
      redirect: "error",
      signal,
    });
    if (!response.ok || response.redirected) throw new Error("notification source status failed");
  }
}

export interface NotificationActivationResolverOptions {
  store: DeliveryStore;
  manager: Pick<NotificationConnectionManager, "currentSource">;
  open: BrowserOpener;
  fetch?: typeof globalThis.fetch;
}

export class NotificationActivationResolver implements NotificationTicketResolver {
  constructor(private readonly options: NotificationActivationResolverOptions) {}

  async resolve(ticket: string): Promise<void> {
    const intent = await this.options.store.consumeTicket(ticket);
    if (intent === null) return;
    const source = this.options.manager.currentSource(intent.sourceId);
    if (source === undefined) return;
    if (!source.enabled) {
      if (source.capabilityReason?.includes("CREDENTIAL")) await this.options.open(`${source.sourceOrigin}/`);
      return;
    }
    if (intent.kind === "summary") { await this.options.open(`${source.sourceOrigin}/`); return; }
    if (!source.credential) { await this.options.open(`${source.sourceOrigin}/`); return; }
    const item = await this.fetchItem(source, intent);
    if (item === "authentication") { await this.options.open(`${source.sourceOrigin}/`); return; }
    if (item === null) return;
    const target = formalTarget(source.sourceOrigin, item);
    if (target === null) return;
    const marked = await (this.options.fetch ?? globalThis.fetch)(`${source.sourceOrigin}/api/inbox/${encodeURIComponent(intent.notificationId)}`, {
      method: "PATCH",
      headers: { "X-API-Key": source.credential },
      redirect: "error",
    }).catch(() => null);
    if (marked === null || !marked.ok || marked.redirected) return;
    await this.options.open(target);
  }

  private async fetchItem(source: NotificationSourceConfig, intent: Extract<ClickIntent, { kind: "notification" }>): Promise<InboxTarget | "authentication" | null> {
    const response = await (this.options.fetch ?? globalThis.fetch)(`${source.sourceOrigin}/api/inbox/${encodeURIComponent(intent.notificationId)}`, {
      headers: { "X-API-Key": source.credential! },
      redirect: "error",
    }).catch(() => null);
    if (response === null) return null;
    if (response.status === 401 || response.status === 403) return "authentication";
    if (!response.ok || response.redirected) return null;
    const value: unknown = await response.json().catch(() => null);
    if (!record(value) || !exactKeys(value, ["success", "data"]) || value.success !== true || !record(value.data)) return null;
    const data = value.data;
    if (!exactKeys(data, ["id", "user_id", "app_owner", "app_name", "title", "body", "url", "priority", "data", "created_at", "read_at", "deleted_at"])
      || data.id !== intent.notificationId || typeof data.app_owner !== "string" || !safeRouteSegment(data.app_owner)
      || typeof data.app_name !== "string" || !safeRouteSegment(data.app_name) || (data.url !== null && typeof data.url !== "string")) return null;
    return { appOwner: data.app_owner, appName: data.app_name, url: data.url };
  }
}

interface InboxTarget { appOwner: string; appName: string; url: string | null }
function formalTarget(origin: string, item: InboxTarget): string | null {
  const root = `/${encodeURIComponent(item.appOwner)}/${encodeURIComponent(item.appName)}/`;
  const relative = item.url ?? root;
  if (!safeRelative(relative) || !relative.startsWith(root) || relative.startsWith("/serve/")) return null;
  const target = new URL(relative, origin);
  return target.origin === origin ? target.href : null;
}
function safeRelative(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value) || /%(?:2f|5c|00|0[0-9a-f]|1[0-9a-f]|7f)/i.test(value)) return false;
  try { const parsed = new URL(value, "http://localapp.invalid"); return `${parsed.pathname}${parsed.search}${parsed.hash}` === value && !parsed.pathname.split("/").includes(".."); } catch { return false; }
}
function safeRouteSegment(value: string): boolean { return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value); }

function parseSnapshot(value: unknown): { generation: number; sources: NotificationSourceConfig[] } {
  if (!record(value) || !exactKeys(value, ["success", "data"]) || value.success !== true || !record(value.data)
    || !exactKeys(value.data, ["generation", "sources"]) || !Number.isSafeInteger(value.data.generation) || value.data.generation < 0 || !Array.isArray(value.data.sources)) throw new Error("Notification source snapshot is invalid");
  return { generation: value.data.generation, sources: value.data.sources.map(parseSource) };
}
function parseSource(value: unknown): NotificationSourceConfig {
  if (!record(value) || !exactKeys(value, ["id", "kind", "generation", "sourceOrigin", "targetUserId", "accountLabel", "sourceLabel", "enabled", "capability", ...(value.credential === undefined ? [] : ["credential"])])
    || (value.kind !== "local" && value.kind !== "peer") || typeof value.id !== "string" || typeof value.generation !== "number"
    || typeof value.sourceOrigin !== "string" || typeof value.targetUserId !== "string" || typeof value.accountLabel !== "string"
    || typeof value.sourceLabel !== "string" || typeof value.enabled !== "boolean" || !record(value.capability)
    || !exactKeys(value.capability, ["available", "reason"]) || typeof value.capability.available !== "boolean"
    || (value.capability.reason !== null && typeof value.capability.reason !== "string")
    || (value.enabled && typeof value.credential !== "string") || (!value.enabled && value.credential !== undefined)) throw new Error("Notification source snapshot is invalid");
  return { id: value.id, generation: value.generation, sourceOrigin: value.sourceOrigin, targetUserId: value.targetUserId, sourceLabel: value.sourceLabel, enabled: value.enabled, capabilityReason: value.capability.reason, ...(typeof value.credential === "string" ? { credential: value.credential } : {}) };
}
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function delay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal.aborted) return reject(signal.reason); const timer = setTimeout(resolve, ms); timer.unref?.(); signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
