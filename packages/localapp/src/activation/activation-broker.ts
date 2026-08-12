import type { DeviceActivationTicket } from "@localapp/server/device-action-ticket";
import { lifecycleError } from "../errors.js";
import type { ServiceManager } from "../service/service-manager.js";
import { parseActivationUrl } from "./activation-url.js";

export interface ActivationIpcClient {
  request(request: { type: "activation"; url: string }): Promise<{ ok: boolean; type?: string }>;
}

export interface ForwardActivationOptions {
  url: string;
  ipcClient: ActivationIpcClient;
  service: Pick<ServiceManager, "start">;
  deadlineMs?: number;
  delay?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface BrowserOpener { (url: string): Promise<void>; }
export interface NotificationTicketResolver {
  resolve(ticket: string): Promise<void>;
}

export interface ActivationBrokerOptions {
  fetch?: typeof globalThis.fetch;
  open: BrowserOpener;
  notificationResolver?: NotificationTicketResolver;
}

export interface ActivateOptions {
  url: string;
  listenUrl: string;
  controlToken: string;
}

const DEVICE_ACTION_STATUSES = new Set([
  "pending", "claimed", "awaiting_trust", "preparing", "running", "succeeded", "failed", "cancelled", "expired", "interrupted",
]);
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SERVICE_ABORT_DRAIN_LIMIT_MS = 100;

/** Adapter-side, bounded private-IPC delivery. It never launches a path itself. */
export async function forwardActivationToDaemon(options: ForwardActivationOptions): Promise<void> {
  parseActivationUrl(options.url);
  const deadline = Date.now() + (options.deadlineMs ?? 10_000);
  let started = false;
  let lastError: unknown;
  while (Date.now() <= deadline) {
    try {
      const response = await beforeDeadline(() => options.ipcClient.request({ type: "activation", url: options.url }), deadline);
      if (response.ok && response.type === "activation") return;
      throw lifecycleError("activation_ipc_rejected", "The LocalApp daemon rejected the Scheme activation");
    } catch (error) {
      if (!isUnreachable(error)) throw error;
      lastError = error;
      if (!started) {
        started = true;
        try {
          await beforeDeadline((signal) => options.service.start(signal), deadline, { drainAfterAbort: true });
        } catch (startError) {
          if (!isDeadlineElapsed(startError)) throw startError;
          break;
        }
      }
      if (Date.now() >= deadline) break;
      try {
        await beforeDeadline(
          (signal) => (options.delay ?? delay)(Math.min(100, Math.max(1, deadline - Date.now())), signal),
          deadline,
        );
      } catch (delayError) {
        if (!isDeadlineElapsed(delayError)) throw delayError;
        break;
      }
    }
  }
  throw lastError instanceof Error ? lastError : lifecycleError("activation_ipc_unreachable", "The LocalApp daemon activation endpoint is unavailable");
}

/** Daemon-side authority boundary. It reparses OS input before every use. */
export class ActivationBroker {
  private readonly fetch: typeof globalThis.fetch;
  private readonly open: BrowserOpener;
  private readonly notificationResolver: NotificationTicketResolver | undefined;

  constructor(options: ActivationBrokerOptions) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.open = options.open;
    this.notificationResolver = options.notificationResolver;
  }

  async activate(options: ActivateOptions): Promise<void> {
    const activation = parseActivationUrl(options.url);
    if (activation.kind === "notification") {
      if (this.notificationResolver === undefined) {
        throw lifecycleError("notification_ticket_resolver_unavailable", "Notification activation is unavailable until a ticket resolver is configured");
      }
      await this.notificationResolver.resolve(activation.ticket);
      return;
    }
    const confirmationUrl = await this.forwardDeviceAction(activation.ticket, options);
    await this.open(confirmationUrl);
  }

  private async forwardDeviceAction(ticket: DeviceActivationTicket, options: ActivateOptions): Promise<string> {
    const origin = canonicalLoopbackOrigin(options.listenUrl);
    if (typeof options.controlToken !== "string" || options.controlToken.length < 16) {
      throw lifecycleError("activation_control_unavailable", "The LocalApp device-control channel is unavailable");
    }
    let response: Response;
    try {
      response = await this.fetch(`${origin}/api/device-control/activations`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", "x-localapp-device-control": options.controlToken },
        body: JSON.stringify(ticket),
      });
    } catch {
      throw lifecycleError("activation_control_failed", "The LocalApp device-control channel rejected the activation");
    }
    if (response.status !== 200 || response.redirected) {
      throw lifecycleError("activation_control_failed", "The LocalApp device-control channel rejected the activation");
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw lifecycleError("activation_control_invalid", "The LocalApp device-control response is invalid"); }
    const data = parseConfirmationResponse(body);
    return validateConfirmationUrl(data.confirmationUrl, origin, data.requestId);
  }
}

function parseConfirmationResponse(value: unknown): { requestId: string; confirmationUrl: string } {
  if (!recordWithExactKeys(value, ["success", "data"]) || value.success !== true || !recordWithExactKeys(value.data, ["protocolVersion", "requestId", "status", "confirmationUrl"])) {
    throw lifecycleError("activation_control_invalid", "The LocalApp device-control response is invalid");
  }
  const data = value.data;
  if (data.protocolVersion !== 2 || typeof data.requestId !== "string" || !REQUEST_ID.test(data.requestId)
    || typeof data.status !== "string" || !DEVICE_ACTION_STATUSES.has(data.status) || typeof data.confirmationUrl !== "string") {
    throw lifecycleError("activation_control_invalid", "The LocalApp device-control response is invalid");
  }
  return { requestId: data.requestId, confirmationUrl: data.confirmationUrl };
}

function validateConfirmationUrl(value: string, origin: string, requestId: string): string {
  const expected = `${origin}/my/device-actions/?requestId=${requestId}`;
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw lifecycleError("activation_confirmation_invalid", "The LocalApp device-action confirmation target is invalid"); }
  if (value !== expected || parsed.origin !== origin || parsed.username || parsed.password || parsed.hash
    || parsed.pathname !== "/my/device-actions/" || [...parsed.searchParams.entries()].length !== 1
    || parsed.searchParams.get("requestId") !== requestId) {
    throw lifecycleError("activation_confirmation_invalid", "The LocalApp device-action confirmation target is invalid");
  }
  return expected;
}

function canonicalLoopbackOrigin(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw lifecycleError("activation_control_unavailable", "The LocalApp device-control channel is unavailable"); }
  if (parsed.origin !== value || !["127.0.0.1", "[::1]"].includes(parsed.host === "[::1]" ? "[::1]" : parsed.hostname)
    || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw lifecycleError("activation_control_unavailable", "The LocalApp device-control channel is unavailable");
  }
  return parsed.origin;
}

function recordWithExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function isUnreachable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ipc_unreachable";
}

function isDeadlineElapsed(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "activation_deadline_elapsed";
}

async function beforeDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadline: number,
  options: { drainAfterAbort?: boolean } = {},
): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw lifecycleError("activation_deadline_elapsed", "The LocalApp activation deadline elapsed");
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  let work: Promise<T> | undefined;
  try {
    work = Promise.resolve().then(() => operation(controller.signal));
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(lifecycleError("activation_deadline_elapsed", "The LocalApp activation deadline elapsed"));
        }, remaining);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    if (timedOut && options.drainAfterAbort && work !== undefined) await drainAbortedService(work);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (timedOut && !controller.signal.aborted) controller.abort();
  }
}

/**
 * The runtime service runner settles only after child_process `close`, so this
 * reaps an aborted launch before preserving the original deadline failure.
 * A non-cooperative injected test double cannot extend the activation forever.
 */
async function drainAbortedService(work: Promise<unknown>): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      work.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SERVICE_ABORT_DRAIN_LIMIT_MS);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(cleanupAndResolve, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(signal?.reason);
    };
    const cleanup = () => signal?.removeEventListener("abort", abort);
    function cleanupAndResolve() {
      cleanup();
      resolve();
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}
