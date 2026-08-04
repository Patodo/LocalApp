// ---- Shell/app message protocol ----

const PREFIX = "localapp:";

// Native same-page runtime is the production default. These message types are
// retained for legacy framed apps, dev compatibility, and same-window events.

// ---- App to Shell messages ----

export interface RegisterToolsMessage {
  type: typeof PREFIX extends `${infer P}` ? `${P}register_tools` : never;
  tools: ToolSchema[];
  systemHint?: string;
}

export interface AiCustomModeMessage {
  type: "localapp:ai_custom_mode";
}

export interface HideShellMessage {
  type: "localapp:hide_shell";
}

export type PlatformCapability =
  | "getCurrentUser"
  | "getServerTime"
  | "copyText"
  | "downloadFile"
  | "confirm"
  | "openRoute"
  | "auth.login"
  | "ai.open"
  | "ai.close"
  | "ai.toggle";

export interface PlatformRequestMessage {
  type: "localapp:platform_request";
  id: string;
  capability: PlatformCapability;
  payload?: unknown;
}

export interface PlatformResponseMessage {
  type: "localapp:platform_response";
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface ToolResultMessage {
  type: "localapp:tool_result";
  callId: string;
  result: unknown;
  isError?: boolean;
}

// ---- Shell to App messages ----

export interface ToolCallMessage {
  type: "localapp:tool_call";
  callId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface ToggleChatMessage {
  type: "localapp:toggle_chat";
}

// ---- Shared types ----

export interface ToolSchema {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: {
      [key: string]: {
        type: string;
        description?: string;
      };
    };
    required?: string[];
  };
}

// ---- Message type guards ----

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isRegisterToolsMessage(v: unknown): v is RegisterToolsMessage {
  return isObject(v) && v.type === "localapp:register_tools";
}

export function isAiCustomModeMessage(v: unknown): v is AiCustomModeMessage {
  return isObject(v) && v.type === "localapp:ai_custom_mode";
}

export function isToolResultMessage(v: unknown): v is ToolResultMessage {
  return isObject(v) && v.type === "localapp:tool_result";
}

export function isToolCallMessage(v: unknown): v is ToolCallMessage {
  return isObject(v) && v.type === "localapp:tool_call";
}

export function isToggleChatMessage(v: unknown): v is ToggleChatMessage {
  return isObject(v) && v.type === "localapp:toggle_chat";
}

export function isHideShellMessage(v: unknown): v is HideShellMessage {
  return isObject(v) && v.type === "localapp:hide_shell";
}

export function isPlatformRequestMessage(v: unknown): v is PlatformRequestMessage {
  return (
    isObject(v) &&
    v.type === "localapp:platform_request" &&
    typeof v.id === "string" &&
    typeof v.capability === "string"
  );
}

export function isPlatformResponseMessage(v: unknown): v is PlatformResponseMessage {
  return (
    isObject(v) &&
    v.type === "localapp:platform_response" &&
    typeof v.id === "string" &&
    typeof v.ok === "boolean"
  );
}

// ---- Helper to send messages ----

export function postToParent(message: unknown): void {
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(message, window.location.origin);
  }
}

export function postToIframe(iframe: HTMLIFrameElement, message: unknown): void {
  iframe.contentWindow?.postMessage(message, window.location.origin);
}

export function hideShell(): void {
  postToParent({ type: "localapp:hide_shell" });
}
