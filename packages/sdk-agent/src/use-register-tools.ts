import { useEffect, useRef } from "react";
import { PostMessageBridge } from "./postmessage-bridge.js";
import { postToParent } from "./postmessage-types.js";
import type { ToolSchema } from "./postmessage-types.js";
import type { UserToolDef } from "./types.js";
import { getDevRegistry } from "./dev-bridge.js";
import { getPlatformToolRegistry } from "./native-registry.js";

export interface UseRegisterToolsOptions {
  tools?: Record<string, UserToolDef>;
  systemHint?: string;
}

function toSchema(tools: Record<string, UserToolDef>): ToolSchema[] {
  return Object.entries(tools).map(([name, def]) => {
    const properties: Record<string, { type: string; description?: string }> = {};
    const required: string[] = [];
    for (const [key, field] of Object.entries(def.parameters)) {
      const { type, description } = field;
      properties[key] = { type, ...(description ? { description } : {}) };
      if (field.required) required.push(key);
    }
    return {
      name,
      description: def.description,
      parameters: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    };
  });
}

function toExecuteFns(tools: Record<string, UserToolDef>): Record<string, (args: Record<string, unknown>) => Promise<unknown>> {
  const executeFns: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {};
  for (const [name, def] of Object.entries(tools)) {
    executeFns[name] = def.execute;
  }
  return executeFns;
}

export function registerToolsForShell(
  tools: Record<string, UserToolDef>,
  systemHint?: string,
): void | (() => void) {
  const schemas = toSchema(tools);
  const executeFns = toExecuteFns(tools);
  const devRegistry = getDevRegistry();

  if (devRegistry) {
    devRegistry.registerTools(schemas, executeFns, systemHint);
    return;
  }

  const nativeRegistry = getPlatformToolRegistry();
  if (nativeRegistry) {
    return nativeRegistry.registerTools(schemas, executeFns, systemHint);
  }

  postToParent({
    type: "localapp:register_tools",
    tools: schemas,
    systemHint,
  });

  const bridge = new PostMessageBridge();
  for (const [name, def] of Object.entries(tools)) {
    bridge.registerTool(name, def.execute);
  }

  return () => {
    bridge.destroy();
  };
}

export function useRegisterTools(options: UseRegisterToolsOptions = {}): void {
  const cleanupRef = useRef<void | (() => void)>(undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const { tools, systemHint } = optionsRef.current;
    if (!tools || Object.keys(tools).length === 0) return;

    cleanupRef.current = registerToolsForShell(tools, systemHint);
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = undefined;
    };
  }, []);
}
