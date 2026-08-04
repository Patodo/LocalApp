import { detectBasePath } from "./client.js";

export const DESKTOP_ACTION_PROTOCOL_VERSION = 1;

export type DesktopActionStatus =
  | "pending"
  | "claimed"
  | "awaiting_trust"
  | "preparing"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired"
  | "interrupted";

export type DesktopActionTerminalStatus = Extract<
  DesktopActionStatus,
  "succeeded" | "failed" | "cancelled" | "expired" | "interrupted"
>;

export interface DesktopActionRequest {
  title: string;
  description?: string;
  script: string;
  dependencies?: Record<string, string>;
  input?: unknown;
  timeoutSeconds?: number;
}

export interface DesktopActionResultError {
  message: string;
  code?: string;
}

export interface DesktopActionSnapshot<TResult = unknown> {
  requestId: string;
  status: DesktopActionStatus;
  result: TResult | null;
  error: DesktopActionResultError | null;
  title?: string;
  description?: string | null;
  appOwner?: string;
  appName?: string;
  appVersion?: string | null;
  publisherUserId?: string;
  publisherDisplayName?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string;
  claimedAt?: string | null;
  completedAt?: string | null;
}

export type DesktopActionErrorCode =
  | "unsupported"
  | "offline"
  | "protocol_mismatch"
  | "aborted"
  | "observation_timeout"
  | "request_failed"
  | "invalid_response";

export class DesktopActionError extends Error {
  readonly code: DesktopActionErrorCode;
  readonly status: number;
  readonly requestId?: string;

  constructor(code: DesktopActionErrorCode, message: string, options: { status?: number; requestId?: string } = {}) {
    super(message);
    this.name = "DesktopActionError";
    this.code = code;
    this.status = options.status ?? 0;
    this.requestId = options.requestId;
  }
}

export interface DesktopActionRunOptions<TResult = unknown> {
  signal?: AbortSignal;
  observationTimeoutMs?: number;
  onRequestId?: (requestId: string) => void;
  onStatus?: (snapshot: DesktopActionSnapshot<TResult>) => void;
}

export interface DesktopApi {
  run<TResult = unknown>(request: DesktopActionRequest, options?: DesktopActionRunOptions<TResult>): Promise<DesktopActionSnapshot<TResult>>;
  get<TResult = unknown>(requestId: string): Promise<DesktopActionSnapshot<TResult>>;
}

interface EventSourceLike {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => unknown) | null;
  addEventListener?(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}

interface EventSourceConstructor {
  new(url: string): EventSourceLike;
}

export interface DesktopApiEnvironment {
  fetch?: typeof fetch;
  EventSource?: EventSourceConstructor;
  activate?: (url: string) => void;
  pollIntervalMs?: number;
}

interface CapabilityResponse {
  supported: boolean;
  online: boolean;
  protocolVersion: number;
}

interface CreateResponse {
  requestId: string;
  activationUrl: string;
  status?: DesktopActionStatus;
}

const TERMINAL_STATUSES = new Set<DesktopActionStatus>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "interrupted",
]);
const DEFAULT_OBSERVATION_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 1000;

export function createDesktopApi(environment: DesktopApiEnvironment = {}): DesktopApi {
  const getFetch = (): typeof fetch | undefined => environment.fetch ?? globalThis.fetch?.bind(globalThis);
  const getEventSource = (): EventSourceConstructor | undefined => environment.EventSource ?? globalThis.EventSource;
  const activate = environment.activate ?? activateCustomProtocol;
  const pollIntervalMs = environment.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  async function get<TResult = unknown>(requestId: string): Promise<DesktopActionSnapshot<TResult>> {
    const raw = await requestJson(
      getFetch(),
      `/api/desktop-actions/${encodeURIComponent(requestId)}`,
      { method: "GET" },
    );
    return toSnapshot<TResult>(unwrapData(raw), requestId);
  }

  async function run<TResult = unknown>(
    request: DesktopActionRequest,
    options: DesktopActionRunOptions<TResult> = {},
  ): Promise<DesktopActionSnapshot<TResult>> {
    throwIfAborted(options.signal);
    await negotiate(getFetch(), options.signal);
    throwIfAborted(options.signal);
    const raw = await requestJson(getFetch(), `${detectBasePath()}/desktop-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, protocolVersion: DESKTOP_ACTION_PROTOCOL_VERSION }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const created = toCreateResponse(unwrapData(raw));
    options.onRequestId?.(created.requestId);
    options.onStatus?.({
      requestId: created.requestId,
      status: created.status ?? "pending",
      result: null,
      error: null,
    });
    activate(created.activationUrl);
    return observe<TResult>(created.requestId, options);
  }

  function observe<TResult>(
    requestId: string,
    options: DesktopActionRunOptions<TResult>,
  ): Promise<DesktopActionSnapshot<TResult>> {
    return new Promise((resolve, reject) => {
      let source: EventSourceLike | null = null;
      let settled = false;
      let polling = false;
      const timeoutMs = options.observationTimeoutMs ?? DEFAULT_OBSERVATION_TIMEOUT_MS;
      const EventSourceImpl = getEventSource();

      const finish = (callback: () => void): void => {
        if (settled) return;
        settled = true;
        source?.close();
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", abort);
        callback();
      };
      const fail = (code: DesktopActionErrorCode, message: string): void => {
        finish(() => reject(new DesktopActionError(code, message, { requestId })));
      };
      const accept = (snapshot: DesktopActionSnapshot<TResult>): void => {
        if (settled) return;
        options.onStatus?.(snapshot);
        if (TERMINAL_STATUSES.has(snapshot.status)) finish(() => resolve(snapshot));
      };
      const abort = (): void => fail("aborted", "Desktop action observation was aborted");
      const timeout = setTimeout(
        () => fail("observation_timeout", "Desktop action observation timed out"),
        Math.max(0, timeoutMs),
      );

      if (options.signal?.aborted) {
        abort();
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });

      const poll = async (): Promise<void> => {
        if (polling || settled) return;
        polling = true;
        while (!settled) {
          try {
            accept(await get<TResult>(requestId));
          } catch (error) {
            if (error instanceof DesktopActionError && error.status >= 400 && error.status < 500) {
              finish(() => reject(error));
              return;
            }
          }
          if (!settled) await delay(pollIntervalMs, options.signal);
        }
      };

      if (!EventSourceImpl) {
        void poll();
        return;
      }

      source = new EventSourceImpl(`/api/desktop-actions/${encodeURIComponent(requestId)}/events`);
      const receive = (event: MessageEvent<string>): void => {
        try {
          accept(toSnapshot<TResult>(unwrapData(parseJson(event.data)), requestId));
        } catch {
          // Ignore malformed event frames; the stream or timeout remains authoritative.
        }
      };
      source.onmessage = receive;
      source.addEventListener?.("desktop:action-updated", receive);
      source.onerror = () => {
        source?.close();
        source = null;
        void poll();
      };
    });
  }

  return { run, get };
}

async function negotiate(fetchRequest: typeof fetch | undefined, signal?: AbortSignal): Promise<void> {
  let raw: unknown;
  try {
    raw = await requestJson(fetchRequest, "/api/desktop-actions/capabilities", {
      method: "GET",
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    if (error instanceof DesktopActionError && error.code === "aborted") throw error;
    if (error instanceof DesktopActionError && error.status === 404) {
      throw new DesktopActionError("unsupported", "Desktop actions are not supported by this server", { status: 404 });
    }
    if (error instanceof DesktopActionError && error.status > 0) throw error;
    throw new DesktopActionError("offline", "Desktop action capability could not be reached");
  }
  const capability = toCapability(unwrapData(raw));
  if (!capability.supported) throw new DesktopActionError("unsupported", "Desktop actions are not supported by this server");
  if (capability.protocolVersion !== DESKTOP_ACTION_PROTOCOL_VERSION) {
    throw new DesktopActionError("protocol_mismatch", "Desktop action protocol version is incompatible");
  }
  if (!capability.online) throw new DesktopActionError("offline", "No compatible LocalApp Desktop client is online");
}

async function requestJson(fetchRequest: typeof fetch | undefined, url: string, init: RequestInit): Promise<unknown> {
  if (!fetchRequest) throw new DesktopActionError("offline", "Fetch is not available in this environment");
  let response: Response;
  try {
    response = await fetchRequest(url, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw new DesktopActionError("aborted", "Desktop action request was aborted");
    }
    throw new DesktopActionError("offline", `Could not reach ${url}`);
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    if (isAbortError(error)) {
      throw new DesktopActionError("aborted", "Desktop action request was aborted");
    }
    throw error;
  }
  let body: unknown;
  try {
    body = text ? parseJson(text) : null;
  } catch {
    body = null;
  }
  if (!response.ok || isFailedEnvelope(body)) {
    throw new DesktopActionError(
      "request_failed",
      readErrorMessage(body) ?? `Desktop action request failed with HTTP ${response.status}`,
      { status: response.status },
    );
  }
  if (body === null) {
    throw new DesktopActionError("invalid_response", `Desktop action endpoint returned a non-JSON response (HTTP ${response.status})`, {
      status: response.status,
    });
  }
  return body;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

function unwrapData(value: unknown): unknown {
  if (isRecord(value) && "data" in value && (value.success === true || "success" in value)) return value.data;
  return value;
}

function isFailedEnvelope(value: unknown): boolean {
  return isRecord(value) && value.success === false;
}

function readErrorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.error === "string") return value.error;
  if (isRecord(value.error) && typeof value.error.message === "string") return value.error.message;
  return undefined;
}

function toCapability(value: unknown): CapabilityResponse {
  if (!isRecord(value)
    || typeof value.supported !== "boolean"
    || typeof value.online !== "boolean"
    || typeof value.protocolVersion !== "number") {
    throw new DesktopActionError("invalid_response", "Desktop capability response is invalid");
  }
  return value as unknown as CapabilityResponse;
}

function toCreateResponse(value: unknown): CreateResponse {
  if (!isRecord(value)
    || typeof value.requestId !== "string"
    || typeof value.activationUrl !== "string"
    || !value.activationUrl.startsWith("localapp://")) {
    throw new DesktopActionError("invalid_response", "Desktop action creation response is invalid");
  }
  return value as unknown as CreateResponse;
}

function toSnapshot<TResult>(value: unknown, fallbackRequestId?: string): DesktopActionSnapshot<TResult> {
  if (!isRecord(value)) throw new DesktopActionError("invalid_response", "Desktop action status response is invalid");
  const requestId = typeof value.requestId === "string"
    ? value.requestId
    : typeof value.id === "string"
      ? value.id
      : fallbackRequestId;
  if (!requestId || !isDesktopActionStatus(value.status)) {
    throw new DesktopActionError("invalid_response", "Desktop action status response is invalid", { requestId: fallbackRequestId });
  }
  const snapshot: DesktopActionSnapshot<TResult> = {
    requestId,
    status: value.status,
    result: (value.result ?? null) as TResult | null,
    error: toResultError(value.error),
  };
  copyString(value, snapshot, "title");
  copyNullableString(value, snapshot, "description");
  copyString(value, snapshot, "appOwner");
  copyString(value, snapshot, "appName");
  copyNullableString(value, snapshot, "appVersion");
  copyString(value, snapshot, "publisherUserId");
  copyNullableString(value, snapshot, "publisherDisplayName");
  copyString(value, snapshot, "createdAt");
  copyString(value, snapshot, "updatedAt");
  copyString(value, snapshot, "expiresAt");
  copyNullableString(value, snapshot, "claimedAt");
  copyNullableString(value, snapshot, "completedAt");
  return snapshot;
}

function toResultError(value: unknown): DesktopActionResultError | null {
  if (!isRecord(value) || typeof value.message !== "string") return null;
  return typeof value.code === "string" ? { message: value.message, code: value.code } : { message: value.message };
}

function copyString(source: Record<string, unknown>, target: object, key: string): void {
  if (typeof source[key] === "string") Object.assign(target, { [key]: source[key] });
}

function copyNullableString(source: Record<string, unknown>, target: object, key: string): void {
  if (typeof source[key] === "string" || source[key] === null) Object.assign(target, { [key]: source[key] });
}

function isDesktopActionStatus(value: unknown): value is DesktopActionStatus {
  return typeof value === "string" && (
    value === "pending"
    || value === "claimed"
    || value === "awaiting_trust"
    || value === "preparing"
    || value === "running"
    || value === "succeeded"
    || value === "failed"
    || value === "cancelled"
    || value === "expired"
    || value === "interrupted"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DesktopActionError("aborted", "Desktop action request was aborted");
}

function activateCustomProtocol(url: string): void {
  if (typeof document === "undefined") return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.style.display = "none";
  document.body?.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = (): void => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timeout = setTimeout(finish, Math.max(0, ms));
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export const desktop = createDesktopApi();
