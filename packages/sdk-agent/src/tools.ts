import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { UserToolDef } from "./types.js";

function createGetCurrentUserTool(): AgentTool {
  return {
    name: "getCurrentUser",
    label: "Get current user",
    description: "Return the current signed-in user id and name, or null when unauthenticated.",
    parameters: Type.Object({}),
    execute: async () => {
      try {
        const res = await fetch("/api/me", { credentials: "include" });
        if (!res.ok) return { content: [{ type: "text", text: "null" }], details: {} };
        const body = await res.json();
        if (!body.success || !body.data) return { content: [{ type: "text", text: "null" }], details: {} };
        return {
          content: [{ type: "text", text: JSON.stringify({ id: body.data.id, name: body.data.name }) }],
          details: body.data,
        };
      } catch {
        return { content: [{ type: "text", text: "null" }], details: {} };
      }
    },
  };
}

export function createSystemTools(): AgentTool[] {
  return [createGetCurrentUserTool()];
}

export function convertUserTool(name: string, getDef: () => UserToolDef): AgentTool {
  const def = getDef();
  if (!def.description) {
    console.warn(`[Agent SDK] Tool "${name}" is missing a description; add one to help the LLM understand it.`);
  }
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const [key, field] of Object.entries(def.parameters)) {
    const t = field.type;
    const prop: any = { type: t, description: field.description };
    properties[key] = prop;
    if (field.required) required.push(key);
  }

  return {
    name,
    label: name,
    description: def.description,
    parameters: required.length > 0
      ? Type.Object(properties, { required })
      : Type.Object(properties),
    execute: async (_id, params) => {
      try {
        const result = await getDef().execute(params as Record<string, unknown>);
        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
          details: result,
        };
      } catch (err) {
        return {
          content: [{ type: "text", text: `Execution failed: ${err instanceof Error ? err.message : String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  };
}
