import {
  createDesktopApi,
  DesktopActionError,
  type DesktopApiEnvironment,
  type DesktopActionRequest,
  type DesktopActionResultError,
  type DesktopActionRunOptions,
  type DesktopActionSnapshot,
  type DesktopActionStatus,
  type DesktopActionTerminalStatus,
} from "./desktop.js";

export const DEVICE_ACTION_PROTOCOL_VERSION = 2;

export type DeviceActionStatus = DesktopActionStatus;
export type DeviceActionTerminalStatus = DesktopActionTerminalStatus;
export type DeviceActionResultError = DesktopActionResultError;
export type DeviceActionSnapshot<TResult = unknown> = DesktopActionSnapshot<TResult> & {
  permissions?: { filesystemRead?: string[]; filesystemWrite?: string[]; network?: boolean; childProcess?: boolean };
  permissionsDigest?: string;
};
export type DeviceActionErrorCode = "unsupported" | "offline" | "protocol_mismatch" | "aborted" | "observation_timeout" | "request_failed" | "invalid_response";
export const DeviceActionError = DesktopActionError;
export type DeviceActionError = DesktopActionError;
export type DeviceActionRequest = Omit<DesktopActionRequest, "permissions"> & {
  permissions: { filesystemRead?: string[]; filesystemWrite?: string[]; network?: boolean; childProcess?: boolean };
};
export type DeviceActionRunOptions<TResult = unknown> = Omit<DesktopActionRunOptions<TResult>, "onStatus"> & {
  onStatus?: (snapshot: DeviceActionSnapshot<TResult>) => void;
};

export interface DeviceApi {
  run<TResult = unknown>(request: DeviceActionRequest, options?: DeviceActionRunOptions<TResult>): Promise<DeviceActionSnapshot<TResult>>;
  get<TResult = unknown>(requestId: string): Promise<DeviceActionSnapshot<TResult>>;
}

export interface DeviceApiEnvironment extends DesktopApiEnvironment {}

/**
 * Generic device actions use the same observation implementation as the
 * legacy client, but all requests are routed to the canonical Server Device
 * Action endpoints. No application-specific installer contract is present.
 */
export function createDeviceApi(environment: DeviceApiEnvironment = {}): DeviceApi {
  const baseFetch = environment.fetch ?? globalThis.fetch?.bind(globalThis);
  const fetcher: typeof fetch | undefined = baseFetch
    ? async (input, init) => {
      const original = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const rewritten = rewriteDevicePath(original);
      let actualInit = init;
      if (init?.body && typeof init.body === "string" && init.method === "POST" && original.includes("/desktop-actions")) {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          actualInit = { ...init, body: JSON.stringify({ ...body, protocolVersion: DEVICE_ACTION_PROTOCOL_VERSION }) };
        } catch {
          // The canonical endpoint will return its normal invalid-payload response.
        }
      }
      const response = await baseFetch(rewritten, actualInit);
      if (!original.endsWith("/api/desktop-actions/capabilities") && !original.endsWith("/api/device-actions/capabilities")) return response;
      const body = await response.text();
      try {
        const parsed = JSON.parse(body) as { success?: boolean; data?: Record<string, unknown> };
        const capability = parsed.data ?? {};
        return new Response(JSON.stringify({
          success: parsed.success !== false,
          data: {
            supported: capability.supported !== false,
            online: true,
            protocolVersion: 1,
          },
        }), { status: response.status, headers: { "content-type": "application/json" } });
      } catch {
        return response;
      }
    }
    : undefined;
  const eventSource = environment.EventSource
    ? class DeviceEventSource {
      private readonly inner: EventSourceLike;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      onerror: ((event: Event) => unknown) | null = null;

      constructor(url: string) {
        this.inner = new environment.EventSource!(rewriteDevicePath(url));
        this.inner.onmessage = (event) => this.onmessage?.(event);
        this.inner.onerror = (event) => this.onerror?.(event);
      }

      addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
        this.inner.addEventListener?.(type === "desktop:action-updated" ? "device:action-updated" : type, listener);
      }

      close(): void { this.inner.close(); }
    }
    : undefined;
  const api = createDesktopApi({ ...environment, fetch: fetcher, ...(eventSource ? { EventSource: eventSource as never } : {}) });
  return api as unknown as DeviceApi;
}

export const device = createDeviceApi();

function rewriteDevicePath(value: string): string {
  return value.split("/api/desktop-actions").join("/api/device-actions");
}

interface EventSourceLike {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => unknown) | null;
  addEventListener?(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
}
