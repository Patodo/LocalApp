import type { ToolSchema } from "./postmessage-types.js";

export type NativeToolExecute = (args: Record<string, unknown>) => Promise<unknown>;

export interface PlatformToolRegistry {
  registerTools(
    tools: ToolSchema[],
    executeFns: Record<string, NativeToolExecute>,
    systemHint?: string,
  ): void | (() => void);
}

export interface PlatformEditSession {
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy?: boolean;
  onSave: () => void | Promise<void>;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
}

export interface PlatformEditSessionRegistry {
  registerEditSession(session: PlatformEditSession): void | (() => void);
}

const TOOL_REGISTRY_KEY = "__localapp_platform_tool_registry__";
const EDIT_SESSION_REGISTRY_KEY = "__localapp_platform_edit_session_registry__";

type RegistryGlobal = typeof globalThis & {
  __localapp_platform_tool_registry__?: PlatformToolRegistry | null;
  __localapp_platform_edit_session_registry__?: PlatformEditSessionRegistry | null;
};

function registryGlobal(): RegistryGlobal {
  return globalThis as RegistryGlobal;
}

export function setPlatformToolRegistry(registry: PlatformToolRegistry | null): void {
  registryGlobal()[TOOL_REGISTRY_KEY] = registry;
}

export function getPlatformToolRegistry(): PlatformToolRegistry | null {
  return registryGlobal()[TOOL_REGISTRY_KEY] ?? null;
}

export function isPlatformToolRegistryAvailable(): boolean {
  return getPlatformToolRegistry() !== null;
}

export function setPlatformEditSessionRegistry(registry: PlatformEditSessionRegistry | null): void {
  registryGlobal()[EDIT_SESSION_REGISTRY_KEY] = registry;
}

export function getPlatformEditSessionRegistry(): PlatformEditSessionRegistry | null {
  return registryGlobal()[EDIT_SESSION_REGISTRY_KEY] ?? null;
}

export function isPlatformEditSessionRegistryAvailable(): boolean {
  return getPlatformEditSessionRegistry() !== null;
}
