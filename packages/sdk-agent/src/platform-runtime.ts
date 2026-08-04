import {
  isPlatformResponseMessage,
  postToParent,
  type PlatformCapability,
  type PlatformRequestMessage,
  type PlatformResponseMessage,
} from "./postmessage-types.js";

export interface PlatformUser {
  id: string;
  name: string;
  displayName?: string | null;
  avatarUrl?: string | null;
}

export interface DownloadFileOptions {
  filename: string;
  mimeType?: string;
  data: string | ArrayBuffer | Blob;
}

export interface OpenRouteOptions {
  href: string;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: "default" | "danger";
}

export interface PlatformRuntime {
  getCurrentUser(): Promise<PlatformUser | null>;
  getServerTime(): Promise<{ now: string }>;
  copyText(text: string): Promise<{ success: true }>;
  downloadFile(options: DownloadFileOptions): Promise<{ success: true }>;
  confirm(options: ConfirmOptions): Promise<boolean>;
  openRoute(options: OpenRouteOptions): Promise<{ success: true }>;
  ai: {
    open(): Promise<{ success: true }>;
    close(): Promise<{ success: true }>;
    toggle(): Promise<{ success: true }>;
  };
  destroy(): void;
}

export interface CreatePlatformRuntimeOptions {
  requestId?: () => string;
  timeoutMs?: number;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 10_000;

function defaultRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `platform-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function sendToHost(message: PlatformRequestMessage): void {
  if (window.parent && window.parent !== window) {
    postToParent(message);
    return;
  }
  window.dispatchEvent(new CustomEvent("localapp:platform_request", { detail: message }));
}

export function createPlatformRuntime(options: CreatePlatformRuntimeOptions = {}): PlatformRuntime {
  const requestId = options.requestId ?? defaultRequestId;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pending = new Map<string, PendingRequest>();

  function onMessage(event: MessageEvent) {
    if (!isPlatformResponseMessage(event.data)) return;
    const message: PlatformResponseMessage = event.data;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.ok) {
      entry.resolve(message.result);
    } else {
      entry.reject(new Error(message.error || "Platform capability request failed"));
    }
  }

  window.addEventListener("message", onMessage);

  function request<T>(capability: PlatformCapability, payload?: unknown): Promise<T> {
    const id = requestId();
    const message: PlatformRequestMessage = {
      type: "localapp:platform_request",
      id,
      capability,
      ...(payload === undefined ? {} : { payload }),
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Platform capability request timed out: ${capability}`));
      }, timeoutMs);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timeout });
      sendToHost(message);
    });
  }

  return {
    getCurrentUser: () => request<PlatformUser | null>("getCurrentUser"),
    getServerTime: () => request<{ now: string }>("getServerTime"),
    copyText: (text: string) => request<{ success: true }>("copyText", { text }),
    downloadFile: (payload: DownloadFileOptions) => request<{ success: true }>("downloadFile", payload),
    confirm: (payload: ConfirmOptions) => request<boolean>("confirm", payload),
    openRoute: (payload: OpenRouteOptions) => request<{ success: true }>("openRoute", payload),
    ai: {
      open: () => request<{ success: true }>("ai.open"),
      close: () => request<{ success: true }>("ai.close"),
      toggle: () => request<{ success: true }>("ai.toggle"),
    },
    destroy: () => {
      window.removeEventListener("message", onMessage);
      for (const [id, entry] of pending.entries()) {
        clearTimeout(entry.timeout);
        entry.reject(new Error("Platform runtime destroyed"));
        pending.delete(id);
      }
    },
  };
}

let platformSingleton: PlatformRuntime | null = null;

function getPlatformSingleton(): PlatformRuntime {
  if (!platformSingleton) platformSingleton = createPlatformRuntime();
  return platformSingleton;
}

export const platform: PlatformRuntime = {
  getCurrentUser: () => getPlatformSingleton().getCurrentUser(),
  getServerTime: () => getPlatformSingleton().getServerTime(),
  copyText: (text: string) => getPlatformSingleton().copyText(text),
  downloadFile: (options: DownloadFileOptions) => getPlatformSingleton().downloadFile(options),
  confirm: (options: ConfirmOptions) => getPlatformSingleton().confirm(options),
  openRoute: (options: OpenRouteOptions) => getPlatformSingleton().openRoute(options),
  ai: {
    open: () => getPlatformSingleton().ai.open(),
    close: () => getPlatformSingleton().ai.close(),
    toggle: () => getPlatformSingleton().ai.toggle(),
  },
  destroy: () => {
    platformSingleton?.destroy();
    platformSingleton = null;
  },
};
export { isPlatformResponseMessage };
