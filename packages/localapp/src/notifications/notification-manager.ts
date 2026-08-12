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
  snapshotTimeoutMs?: number;
  applyDisplayPolicy?: (settings: DeviceNotificationDisplaySettings) => void;
  readNativeStatus?: () => Promise<Omit<DeviceNotificationTestResult, "result">>;
  runTestNotification?: (command: { id: string; userId: string }) => Promise<DeviceNotificationTestResult>;
}

export interface DeviceNotificationDisplaySettings {
  quietHours: { start: string; end: string; timeZone: string } | null;
  preview: "full" | "hidden";
}

export interface DeviceNotificationTestResult {
  result: "shown" | "denied" | "unsupported" | "failed";
  permission: "not-determined" | "granted" | "denied" | "unsupported" | "unknown";
  daemonVersion: string;
  adapterVersion: string;
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

  async start(): Promise<void> {
    if (this.pollPromise !== undefined) return;
    const snapshot = await this.fetchSnapshot("");
    await this.reconfigure(snapshot.sources);
    this.generation = snapshot.generation;
    await this.refreshControl();
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
        const snapshot = await this.fetchSnapshot(query);
        if (snapshot.generation !== this.generation) await this.reconfigure(snapshot.sources);
        this.generation = snapshot.generation;
        await this.refreshControl();
      } catch {
        if (this.controller.signal.aborted) return;
        await delay(500, this.controller.signal).catch(() => undefined);
      }
    }
  }

  private async fetchSnapshot(query: string): Promise<{ generation: number; sources: NotificationSourceConfig[] }> {
    const timeout = AbortSignal.timeout(query === "" ? (this.options.snapshotTimeoutMs ?? 10_000) : 35_000);
    const signal = AbortSignal.any([this.controller.signal, timeout]);
    const response = await (this.options.fetch ?? globalThis.fetch)(`${this.options.localServerOrigin}/api/internal/device-notifications/sources${query}`, {
      headers: { "x-localapp-notification-control": this.options.controlToken }, redirect: "error", signal,
    });
    if (!response.ok || response.redirected) throw new Error("notification source snapshot failed");
    return parseSnapshot(await response.json());
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

  private async refreshControl(): Promise<void> {
    if (this.options.applyDisplayPolicy === undefined && this.options.readNativeStatus === undefined && this.options.runTestNotification === undefined) return;
    const fetch = this.options.fetch ?? globalThis.fetch;
    const headers = { "x-localapp-notification-control": this.options.controlToken };
    const requestSignal = () => AbortSignal.any([this.controller.signal, AbortSignal.timeout(10_000)]);
    const control = await fetch(`${this.options.localServerOrigin}/api/internal/device-notifications/control`, { headers, redirect: "error", signal: requestSignal() });
    if (!control.ok || control.redirected) throw new Error("notification control snapshot failed");
    const settings = parseControl(await control.json());
    this.options.applyDisplayPolicy?.(settings);
    if (this.options.readNativeStatus !== undefined) {
      const native = await this.options.readNativeStatus();
      const reported = await fetch(`${this.options.localServerOrigin}/api/internal/device-notifications/native-status`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(native),
        redirect: "error",
        signal: requestSignal(),
      });
      if (!reported.ok || reported.redirected) throw new Error("notification native status report failed");
    }
    if (this.options.runTestNotification === undefined) return;
    const claimed = await fetch(`${this.options.localServerOrigin}/api/internal/device-notifications/test/claim`, { method: "POST", headers, redirect: "error", signal: requestSignal() });
    if (!claimed.ok || claimed.redirected) throw new Error("notification test claim failed");
    const command = parseClaim(await claimed.json());
    if (command === null) return;
    let result: DeviceNotificationTestResult;
    try { result = await this.options.runTestNotification(command); }
    catch { result = { result: "failed", permission: "unknown", daemonVersion: "unknown", adapterVersion: "unknown" }; }
    const completed = await fetch(`${this.options.localServerOrigin}/api/internal/device-notifications/test/${encodeURIComponent(command.id)}/complete`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify(result),
      redirect: "error",
      signal: requestSignal(),
    });
    if (!completed.ok || completed.redirected) throw new Error("notification test completion failed");
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
    if (!source.enabled) return;
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
      || data.user_id !== source.targetUserId
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
  const sources = value.data.sources.map(parseSource);
  if (new Set(sources.map((source) => source.id)).size !== sources.length) throw new Error("Notification source snapshot is invalid");
  return { generation: value.data.generation, sources };
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
function parseControl(value: unknown): DeviceNotificationDisplaySettings {
  if (!record(value) || !exactKeys(value, ["success", "data"]) || value.success !== true || !record(value.data)
    || !exactKeys(value.data, ["generation", "settings"]) || !Number.isSafeInteger(value.data.generation) || value.data.generation < 0
    || !record(value.data.settings) || !exactKeys(value.data.settings, ["quietHours", "preview"])
    || (value.data.settings.preview !== "full" && value.data.settings.preview !== "hidden")) throw new Error("Notification control snapshot is invalid");
  let quietHours: DeviceNotificationDisplaySettings["quietHours"] = null;
  if (value.data.settings.quietHours !== null) {
    const candidate = value.data.settings.quietHours;
    if (!record(candidate) || !exactKeys(candidate, ["start", "end", "timeZone"])
      || typeof candidate.start !== "string" || typeof candidate.end !== "string" || typeof candidate.timeZone !== "string"
      || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(candidate.end)
      || candidate.start === candidate.end || candidate.timeZone.length < 1 || candidate.timeZone.length > 64) throw new Error("Notification control snapshot is invalid");
    try { new Intl.DateTimeFormat("en-US", { timeZone: candidate.timeZone }).format(); } catch { throw new Error("Notification control snapshot is invalid"); }
    quietHours = { start: candidate.start, end: candidate.end, timeZone: candidate.timeZone };
  }
  return { quietHours, preview: value.data.settings.preview };
}
function parseClaim(value: unknown): { id: string; userId: string } | null {
  if (!record(value) || !exactKeys(value, ["success", "data"]) || value.success !== true || !record(value.data) || !exactKeys(value.data, ["command"])) throw new Error("Notification test command is invalid");
  if (value.data.command === null) return null;
  const command = value.data.command;
  if (!record(command) || !exactKeys(command, ["id", "type", "userId"]) || command.type !== "test-notification"
    || typeof command.id !== "string" || !/^[0-9a-f-]{36}$/.test(command.id) || typeof command.userId !== "string" || command.userId.length < 1 || command.userId.length > 128) throw new Error("Notification test command is invalid");
  return { id: command.id, userId: command.userId };
}
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)); }
function delay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal.aborted) return reject(signal.reason); const timer = setTimeout(resolve, ms); timer.unref?.(); signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
