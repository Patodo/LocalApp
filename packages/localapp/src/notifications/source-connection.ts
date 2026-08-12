import WebSocket from "ws";
import { DeliveryStore, validateDeliveryNotification, type DeliveryNotification } from "./delivery-store.js";
import { NotificationDispatcher } from "./notification-dispatcher.js";

export interface NotificationSourceConfig {
  id: string;
  generation: number;
  sourceOrigin: string;
  targetUserId: string;
  sourceLabel: string;
  enabled: boolean;
  capabilityReason?: string | null;
  credential?: string;
}

export interface SourceConnectionStatus {
  generation: number;
  state: "pending" | "connecting" | "connected" | "error";
  cursor: number | null;
  lastEventAt: string | null;
  error: { code: string; message: string } | null;
}

export interface SourceSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: "open" | "message" | "close" | "error", listener: (...args: any[]) => void): this;
  off(event: "open" | "message" | "close" | "error", listener: (...args: any[]) => void): this;
}

export interface SourceConnectionOptions {
  source: NotificationSourceConfig;
  store: DeliveryStore;
  dispatcher: NotificationDispatcher;
  fetch?: typeof globalThis.fetch;
  createSocket?: (url: string, credential: string) => SourceSocket;
  reportStatus?: (sourceId: string, status: SourceConnectionStatus, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
  delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  jitter?: () => number;
  connectTimeoutMs?: number;
  heartbeatMs?: number;
  readTimeoutMs?: number;
}

const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export class SourceConnection {
  readonly source: NotificationSourceConfig;
  private readonly options: SourceConnectionOptions;
  private readonly controller = new AbortController();
  private running: Promise<void> | undefined;
  private socket: SourceSocket | undefined;

  constructor(options: SourceConnectionOptions) {
    this.source = validateSource(options.source);
    this.options = options;
  }

  start(): void {
    if (this.running !== undefined || !this.source.enabled) return;
    this.running = this.run().finally(() => { this.running = undefined; });
    void this.running.catch(() => undefined);
  }

  async stop(): Promise<void> {
    this.controller.abort();
    this.socket?.close(1000, "LocalApp stopping");
    await this.running?.catch(() => undefined);
  }

  private async run(): Promise<void> {
    let attempt = 0;
    while (!this.controller.signal.aborted) {
      try {
        await this.connectOnce();
        attempt = 0;
      } catch (error) {
        if (this.controller.signal.aborted) return;
        const auth = error instanceof SourceConnectionError && error.code === "SOURCE_AUTHENTICATION_FAILED";
        await this.report("error", await this.cursor(), { code: publicCode(error), message: "Notification source connection failed" });
        if (auth) return;
        const backoff = Math.min(30_000, 250 * 2 ** Math.min(attempt++, 7));
        await (this.options.delay ?? abortableDelay)(Math.round(backoff * (0.75 + 0.5 * (this.options.jitter?.() ?? Math.random()))), this.controller.signal).catch(() => undefined);
      }
    }
  }

  private async connectOnce(): Promise<void> {
    const attemptController = new AbortController();
    const attemptSignal = AbortSignal.any([this.controller.signal, attemptController.signal]);
    await this.report("connecting", await this.cursor(), null);
    attemptSignal.throwIfAborted();
    const socket = (this.options.createSocket ?? createRealSocket)(webSocketUrl(this.source.sourceOrigin), this.source.credential!);
    this.socket = socket;
    const live: DeliveryNotification[] = [];
    let ready: { userId: string; latestSequence: number } | undefined;
    let pongAt = Date.now();
    let protocolFailure: unknown;
    let rejectConnection!: (error: unknown) => void;
    const connectionFailure = new Promise<never>((_resolve, reject) => { rejectConnection = reject; });
    void connectionFailure.catch(() => undefined);
    attemptSignal.addEventListener("abort", () => rejectConnection(attemptSignal.reason), { once: true });
    if (attemptSignal.aborted) rejectConnection(attemptSignal.reason);
    const readyPromise = new Promise<void>((resolve) => {
      const timeout = setTimeout(() => rejectConnection(new SourceConnectionError("SOURCE_CONNECT_TIMEOUT")), this.options.connectTimeoutMs ?? 10_000);
      timeout.unref?.();
      socket.on("message", (raw: unknown) => {
        try {
          const frame = parseFrame(raw);
          if (frame.type === "bus:ready") {
            if (ready !== undefined) throw new SourceConnectionError("SOURCE_PROTOCOL_INVALID");
            ready = frame.data; clearTimeout(timeout); resolve();
          }
          else if (frame.type === "bus:pong") pongAt = Date.now();
          else if (frame.type === "notify:notification") live.push(frame.data);
        } catch (error) { protocolFailure = error; attemptController.abort(); clearTimeout(timeout); rejectConnection(error); socket.close(1002, "Invalid notification protocol"); }
      });
      socket.on("close", (code: number) => { clearTimeout(timeout); rejectConnection(protocolFailure ?? new SourceConnectionError(code === 4401 ? "SOURCE_AUTHENTICATION_FAILED" : "SOURCE_SOCKET_CLOSED")); });
      socket.on("error", () => { clearTimeout(timeout); rejectConnection(new SourceConnectionError("SOURCE_SOCKET_ERROR")); });
    });
    try {
      await Promise.race([readyPromise, connectionFailure]);
      if (ready === undefined || ready.userId !== this.source.targetUserId) throw new SourceConnectionError("SOURCE_IDENTITY_MISMATCH");
      const synchronization = (async () => {
        const current = await this.options.store.readSource(this.source.id);
        if (current === null) {
          await this.options.store.baseline(this.source.id, ready!.latestSequence);
        } else {
          if (current.pending !== null) await this.options.dispatcher.dispatch({ sourceId: this.source.id, sourceLabel: current.pending.sourceLabel, policy: "native", delivery: current.pending.delivery, signal: attemptSignal });
          await this.catchUp(attemptSignal);
        }
        for (const delivery of live.sort((a, b) => a.sequence - b.sequence)) await this.dispatch(delivery, attemptSignal, false);
      })();
      try { await Promise.race([synchronization, connectionFailure]); }
      catch (error) { attemptController.abort(); await synchronization.catch(() => undefined); throw error; }
      await this.report("connected", await this.cursor(), null);
      await this.liveLoop(socket, live, () => pongAt, connectionFailure, () => protocolFailure, attemptSignal);
    } catch (error) {
      if (protocolFailure !== undefined) throw protocolFailure;
      throw error;
    } finally {
      attemptController.abort();
      socket.close();
      if (this.socket === socket) this.socket = undefined;
    }
  }

  private async catchUp(signal: AbortSignal): Promise<void> {
    let source = await this.options.store.readSource(this.source.id);
    if (source === null) throw new SourceConnectionError("SOURCE_STATE_MISSING");
    const since = new Date((this.options.now?.() ?? new Date()).getTime() - 24 * 60 * 60 * 1_000).toISOString();
    let first = true;
    while (!signal.aborted) {
      const page = await this.fetchPage(source.cursor, since, signal);
      if (first && page.omittedCount > 0) {
        await this.options.dispatcher.dispatchSummary({ sourceId: this.source.id, sourceLabel: this.source.sourceLabel, omittedCount: page.items.length + page.omittedCount, signal });
        await this.options.store.advanceCursor(this.source.id, source.cursor, page.snapshotHighWater);
        return;
      }
      for (const delivery of page.items) await this.dispatch(delivery, signal, true);
      source = (await this.options.store.readSource(this.source.id))!;
      if (!page.hasMore) {
        await this.options.store.advanceCursor(this.source.id, source.cursor, page.nextSequence);
        return;
      }
      first = false;
    }
  }

  private async fetchPage(afterSequence: number, since: string, signal: AbortSignal): Promise<DeliveryPage> {
    const url = `${this.source.sourceOrigin}/api/inbox/delivery?afterSequence=${afterSequence}&limit=100&since=${encodeURIComponent(since)}`;
    return withDeadline(async (signal) => {
      const response = await (this.options.fetch ?? globalThis.fetch)(url, { headers: { "X-API-Key": this.source.credential! }, redirect: "error", signal });
      if (response.status === 401 || response.status === 403) throw new SourceConnectionError("SOURCE_AUTHENTICATION_FAILED");
      if (!response.ok || response.redirected) throw new SourceConnectionError("SOURCE_DELIVERY_FAILED");
      return parseDeliveryPage(await response.json(), afterSequence);
    }, signal, this.options.readTimeoutMs ?? 10_000);
  }

  private async dispatch(delivery: DeliveryNotification, signal: AbortSignal, authoritativeGap: boolean): Promise<void> {
    let current = await this.options.store.readSource(this.source.id);
    if (current === null || delivery.sequence <= current.cursor) return;
    if (current.pending === null && delivery.sequence > current.cursor + 1) {
      if (authoritativeGap) {
        await this.options.store.advanceCursor(this.source.id, current.cursor, delivery.sequence - 1);
      } else {
        await this.catchUp(signal);
        current = await this.options.store.readSource(this.source.id);
        if (current === null || delivery.sequence <= current.cursor) return;
        if (delivery.sequence !== current.cursor + 1) throw new SourceConnectionError("SOURCE_DELIVERY_GAP");
      }
    }
    await this.options.dispatcher.dispatch({ sourceId: this.source.id, sourceLabel: this.source.sourceLabel, policy: "native", delivery, signal });
  }

  private async liveLoop(socket: SourceSocket, live: DeliveryNotification[], getPong: () => number, connectionFailure: Promise<never>, getProtocolFailure: () => unknown, signal: AbortSignal): Promise<void> {
    const heartbeat = this.options.heartbeatMs ?? 15_000;
    while (!this.controller.signal.aborted && socket.readyState === WebSocket.OPEN) {
      while (live.length > 0) await this.dispatch(live.shift()!, signal, false);
      if (Date.now() - getPong() > heartbeat * 2 + 5_000) throw new SourceConnectionError("SOURCE_HEARTBEAT_TIMEOUT");
      socket.send(JSON.stringify({ type: "bus:ping", data: { t: Date.now() } }));
      await Promise.race([(this.options.delay ?? abortableDelay)(heartbeat, signal), connectionFailure]);
    }
    if (!this.controller.signal.aborted) throw getProtocolFailure() ?? new SourceConnectionError("SOURCE_SOCKET_CLOSED");
  }

  private async cursor(): Promise<number | null> { return (await this.options.store.readSource(this.source.id))?.cursor ?? null; }
  private async report(state: SourceConnectionStatus["state"], cursor: number | null, error: SourceConnectionStatus["error"]): Promise<void> {
    await this.options.reportStatus?.(this.source.id, { generation: this.source.generation, state, cursor, lastEventAt: state === "connected" ? new Date().toISOString() : null, error }, this.controller.signal);
  }
}

interface DeliveryPage { items: DeliveryNotification[]; nextSequence: number; snapshotHighWater: number; hasMore: boolean; omittedCount: number }

function parseFrame(raw: unknown): { type: "bus:ready"; data: { userId: string; latestSequence: number } } | { type: "bus:pong" } | { type: "notify:notification"; data: DeliveryNotification } {
  const text = typeof raw === "string" ? raw : Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  if (Buffer.byteLength(text) > 64 * 1024) throw new SourceConnectionError("SOURCE_PROTOCOL_INVALID");
  const value: unknown = JSON.parse(text);
  if (!record(value) || !exactKeys(value, ["type", "data"]) || typeof value.type !== "string") throw new SourceConnectionError("SOURCE_PROTOCOL_INVALID");
  if (value.type === "bus:ready" && record(value.data) && exactKeys(value.data, ["userId", "notificationProtocolVersion", "latestSequence"])
    && value.data.notificationProtocolVersion === 2 && validSequence(value.data.latestSequence) && typeof value.data.userId === "string") return { type: "bus:ready", data: { userId: value.data.userId, latestSequence: value.data.latestSequence } };
  if (value.type === "bus:pong" && record(value.data) && exactKeys(value.data, ["t"]) && typeof value.data.t === "number") return { type: "bus:pong" };
  if (value.type === "notify:notification") return { type: "notify:notification", data: validateDeliveryNotification(value.data) };
  throw new SourceConnectionError("SOURCE_PROTOCOL_INVALID");
}

function parseDeliveryPage(value: unknown, afterSequence: number): DeliveryPage {
  if (!record(value) || !exactKeys(value, ["success", "data"]) || value.success !== true || !record(value.data)
    || !exactKeys(value.data, ["items", "nextSequence", "snapshotHighWater", "hasMore", "omittedCount"]) || !Array.isArray(value.data.items)
    || !validSequence(value.data.nextSequence) || !validSequence(value.data.snapshotHighWater) || typeof value.data.hasMore !== "boolean"
    || !Number.isSafeInteger(value.data.omittedCount) || (value.data.omittedCount as number) < 0) throw new SourceConnectionError("SOURCE_DELIVERY_INVALID");
  const items = value.data.items.map(validateDeliveryNotification);
  if (items.length > 100 || value.data.snapshotHighWater < afterSequence || value.data.nextSequence < afterSequence || value.data.nextSequence > value.data.snapshotHighWater
    || items.some((item, index) => item.sequence <= afterSequence || item.sequence > value.data.snapshotHighWater || (index > 0 && item.sequence <= items[index - 1]!.sequence))
    || (items.length > 0 && items[items.length - 1]!.sequence !== value.data.nextSequence)
    || (value.data.hasMore !== ((value.data.omittedCount as number) > 0))) throw new SourceConnectionError("SOURCE_DELIVERY_INVALID");
  return { items, nextSequence: value.data.nextSequence, snapshotHighWater: value.data.snapshotHighWater, hasMore: value.data.hasMore, omittedCount: value.data.omittedCount as number };
}

function validateSource(value: NotificationSourceConfig): NotificationSourceConfig {
  const candidate: unknown = value;
  if (!record(candidate) || !exactKeys(candidate, ["id", "generation", "sourceOrigin", "targetUserId", "sourceLabel", "enabled", ...(candidate.capabilityReason === undefined ? [] : ["capabilityReason"]), ...(candidate.credential === undefined ? [] : ["credential"])])
    || typeof value.id !== "string" || !SOURCE_ID.test(value.id) || !Number.isSafeInteger(value.generation) || value.generation < 1
    || typeof value.targetUserId !== "string" || value.targetUserId.length < 1 || value.targetUserId.length > 128
    || typeof value.sourceLabel !== "string" || value.sourceLabel.length < 1 || value.sourceLabel.length > 128 || /[<>\u0000-\u001f]/.test(value.sourceLabel)
    || typeof value.enabled !== "boolean" || (value.capabilityReason !== undefined && value.capabilityReason !== null && typeof value.capabilityReason !== "string")
    || (value.enabled && (typeof value.credential !== "string" || value.credential.length < 16))) throw new Error("Notification source configuration is invalid");
  const origin = new URL(value.sourceOrigin);
  if (origin.origin !== value.sourceOrigin || !["http:", "https:"].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== "/") throw new Error("Notification source configuration is invalid");
  return { ...value, sourceOrigin: origin.origin };
}

function webSocketUrl(origin: string): string { const url = new URL(origin); url.protocol = url.protocol === "https:" ? "wss:" : "ws:"; url.pathname = "/api/ws"; url.search = "client=notification-daemon&notificationProtocolVersion=2"; return url.href; }
function createRealSocket(url: string, credential: string): SourceSocket { return new WebSocket(url, { headers: { Authorization: `Bearer ${credential}` }, followRedirects: false, handshakeTimeout: 10_000 }) as unknown as SourceSocket; }
function validSequence(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0; }
function record(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { const actual = Object.keys(value).sort(); const expected = [...keys].sort(); return actual.length === expected.length && actual.every((key, index) => key === expected[index]); }
function publicCode(error: unknown): string { return error instanceof SourceConnectionError ? error.code : "SOURCE_CONNECTION_FAILED"; }
class SourceConnectionError extends Error { constructor(readonly code: string) { super(code); } }
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> { return new Promise((resolve, reject) => { if (signal.aborted) return reject(signal.reason); const timer = setTimeout(resolve, ms); timer.unref?.(); signal.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true }); }); }
async function withDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, timeoutMs: number): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([parent, timeout]);
  try { return await operation(signal); }
  catch (error) { if (timeout.aborted && !parent.aborted) throw new SourceConnectionError("SOURCE_READ_TIMEOUT"); throw error; }
}
