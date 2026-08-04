import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

// Import the hook - we need to test it by wrapping in a component
import { registerToolsForShell } from "../src/use-register-tools.js";
import type { UseRegisterToolsOptions } from "../src/use-register-tools.js";

// We test the underlying logic directly to avoid @testing-library/react dependency
import { PostMessageBridge } from "../src/postmessage-bridge.js";
import { postToParent } from "../src/postmessage-types.js";
import { setPlatformToolRegistry } from "../src/native-registry.js";
import type { UserToolDef } from "../src/types.js";

// Re-implement the core logic for unit testing (the hook itself is a thin React wrapper)
function simulateRegisterTools(tools: Record<string, UserToolDef>, systemHint?: string) {
  const schemas = Object.entries(tools).map(([name, def]) => ({
    name,
    description: def.description,
    parameters: def.parameters,
  }));

  postToParent({
    type: "localapp:register_tools",
    tools: schemas,
    systemHint,
  });

  const bridge = new PostMessageBridge();
  for (const [name, def] of Object.entries(tools)) {
    bridge.registerTool(name, def.execute);
  }

  return bridge;
}

describe("useRegisterTools core logic", () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPostMessage = vi.fn();
    vi.spyOn(window, "parent", "get").mockReturnValue({
      postMessage: mockPostMessage,
    } as any);
  });

  afterEach(() => {
    setPlatformToolRegistry(null);
    vi.restoreAllMocks();
  });

  it("sends register_tools message with tool schemas (no execute)", () => {
    const execute = vi.fn().mockResolvedValue("ok");
    const bridge = simulateRegisterTools(
      {
        fillForm: {
          description: "Fill form field",
          parameters: { field: { type: "string", required: true } },
          execute,
        },
      },
      "test app",
    );

    try {
      expect(mockPostMessage).toHaveBeenCalledWith(
        {
          type: "localapp:register_tools",
          tools: [
            {
              name: "fillForm",
              description: "Fill form field",
              parameters: { field: { type: "string", required: true } },
            },
          ],
          systemHint: "test app",
        },
        window.location.origin,
      );
    } finally {
      bridge.destroy();
    }
  });

  it("executes tool when receiving tool_call from parent", async () => {
    const execute = vi.fn().mockResolvedValue("result");
    const bridge = simulateRegisterTools({
      myTool: { description: "test", parameters: {}, execute },
    });

    try {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "localapp:tool_call", callId: "c1", toolName: "myTool", args: { x: 1 } },
        }),
      );

      await vi.waitFor(() => expect(execute).toHaveBeenCalledWith({ x: 1 }));

      const resultCalls = mockPostMessage.mock.calls.filter((c: any[]) => c[0]?.type === "localapp:tool_result");
      expect(resultCalls).toHaveLength(1);
      expect(resultCalls[0][0]).toEqual({
        type: "localapp:tool_result",
        callId: "c1",
        result: "result",
        isError: false,
      });
    } finally {
      bridge.destroy();
    }
  });

  it("handles concurrent tool calls", async () => {
    const exec1 = vi.fn().mockResolvedValue("r1");
    const exec2 = vi.fn().mockResolvedValue("r2");
    const bridge = simulateRegisterTools({
      tool1: { description: "t1", parameters: {}, execute: exec1 },
      tool2: { description: "t2", parameters: {}, execute: exec2 },
    });

    try {
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "localapp:tool_call", callId: "c1", toolName: "tool1", args: {} },
        }),
      );
      window.dispatchEvent(
        new MessageEvent("message", {
          data: { type: "localapp:tool_call", callId: "c2", toolName: "tool2", args: {} },
        }),
      );

      await vi.waitFor(() => {
        expect(exec1).toHaveBeenCalled();
        expect(exec2).toHaveBeenCalled();
      });

      const results = mockPostMessage.mock.calls
        .filter((c: any[]) => c[0]?.type === "localapp:tool_result")
        .map((c: any[]) => c[0]);

      expect(results).toContainEqual({ type: "localapp:tool_result", callId: "c1", result: "r1", isError: false });
      expect(results).toContainEqual({ type: "localapp:tool_result", callId: "c2", result: "r2", isError: false });
    } finally {
      bridge.destroy();
    }
  });

  it("cleans up on destroy", async () => {
    const execute = vi.fn().mockResolvedValue("ok");
    const bridge = simulateRegisterTools({
      myTool: { description: "test", parameters: {}, execute },
    });

    bridge.destroy();

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "localapp:tool_call", callId: "c1", toolName: "myTool", args: {} },
      }),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(execute).not.toHaveBeenCalled();
  });

  it("registers tools into the same-window native shell registry instead of iframe parent", async () => {
    vi.spyOn(window, "parent", "get").mockReturnValue(window);
    const execute = vi.fn().mockResolvedValue("native-result");
    const unregister = vi.fn();
    const registerTools = vi.fn().mockReturnValue(unregister);
    setPlatformToolRegistry({ registerTools });

    const cleanup = registerToolsForShell(
      {
        nativeTool: {
          description: "Native tool",
          parameters: {
            value: { type: "string", required: true },
          },
          execute,
        },
      },
      "native app",
    );

    expect(mockPostMessage).not.toHaveBeenCalled();
    expect(registerTools).toHaveBeenCalledTimes(1);
    const [schemas, executeFns, systemHint] = registerTools.mock.calls[0];
    expect(schemas).toEqual([
      {
        name: "nativeTool",
        description: "Native tool",
        parameters: {
          type: "object",
          properties: { value: { type: "string" } },
          required: ["value"],
        },
      },
    ]);
    expect(systemHint).toBe("native app");
    await expect(executeFns.nativeTool({ value: "x" })).resolves.toBe("native-result");
    expect(execute).toHaveBeenCalledWith({ value: "x" });

    cleanup?.();
    expect(unregister).toHaveBeenCalledTimes(1);
  });
});
