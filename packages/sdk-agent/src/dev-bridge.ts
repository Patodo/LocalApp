import type { ToolSchema } from "./postmessage-types.js";

type ExecuteFn = (args: Record<string, unknown>) => Promise<unknown>;

export interface DevShellRegistry {
  registerTools: (tools: ToolSchema[], executeFns: Record<string, ExecuteFn>, systemHint?: string) => void;
}

const GLOBAL_KEY = "__LOCALAPP_DEV_SHELL__";

export function getDevRegistry(): DevShellRegistry | undefined {
  return (globalThis as Record<string, unknown>)[GLOBAL_KEY] as DevShellRegistry | undefined;
}

export function setDevRegistry(registry: DevShellRegistry): void {
  (globalThis as Record<string, unknown>)[GLOBAL_KEY] = registry;
}

export function isDevMode(): boolean {
  return getDevRegistry() !== undefined;
}
