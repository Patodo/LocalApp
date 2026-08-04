import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PostMessageBridge } from "../src/postmessage-bridge.js";

function createMessageEvent(data: unknown): MessageEvent {
  return new MessageEvent("message", { data, source: {} as MessageEventSource });
}

describe("PostMessageBridge", () => {
  let bridge: PostMessageBridge;
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPostMessage = vi.fn();
    // Mock window.parent getter to return consistent object
    vi.spyOn(window, "parent", "get").mockReturnValue({
      postMessage: mockPostMessage,
    } as any);
    bridge = new PostMessageBridge();
  });

  afterEach(() => {
    bridge.destroy();
    vi.restoreAllMocks();
  });

  it("executes a registered tool and posts result to parent", async () => {
    const execute = vi.fn().mockResolvedValue("filled name");
    bridge.registerTool("fillForm", execute);

    window.dispatchEvent(
      createMessageEvent({
        type: "localapp:tool_call",
        callId: "c1",
        toolName: "fillForm",
        args: { field: "name", value: "张三" },
      }),
    );

    await vi.waitFor(() => expect(execute).toHaveBeenCalled());

    expect(execute).toHaveBeenCalledWith({ field: "name", value: "张三" });
    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: "localapp:tool_result", callId: "c1", result: "filled name", isError: false },
      window.location.origin,
    );
  });

  it("handles concurrent tool calls independently", async () => {
    const exec1 = vi.fn().mockResolvedValue("result1");
    const exec2 = vi.fn().mockResolvedValue("result2");
    bridge.registerTool("tool1", exec1);
    bridge.registerTool("tool2", exec2);

    window.dispatchEvent(
      createMessageEvent({ type: "localapp:tool_call", callId: "c1", toolName: "tool1", args: {} }),
    );
    window.dispatchEvent(
      createMessageEvent({ type: "localapp:tool_call", callId: "c2", toolName: "tool2", args: {} }),
    );

    await vi.waitFor(() => {
      expect(exec1).toHaveBeenCalled();
      expect(exec2).toHaveBeenCalled();
    });

    const calls = mockPostMessage.mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContainEqual({ type: "localapp:tool_result", callId: "c1", result: "result1", isError: false });
    expect(calls).toContainEqual({ type: "localapp:tool_result", callId: "c2", result: "result2", isError: false });
  });

  it("posts error result when execute throws", async () => {
    const execute = vi.fn().mockRejectedValue(new Error("boom"));
    bridge.registerTool("failTool", execute);

    window.dispatchEvent(
      createMessageEvent({ type: "localapp:tool_call", callId: "e1", toolName: "failTool", args: {} }),
    );

    await vi.waitFor(() => expect(execute).toHaveBeenCalled());

    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: "localapp:tool_result", callId: "e1", result: "boom", isError: true },
      window.location.origin,
    );
  });

  it("ignores messages for unregistered tools", async () => {
    window.dispatchEvent(
      createMessageEvent({ type: "localapp:tool_call", callId: "x1", toolName: "unknown", args: {} }),
    );

    await new Promise((r) => setTimeout(r, 20));
    expect(mockPostMessage).not.toHaveBeenCalled();
  });

  it("ignores non-tool_call messages", async () => {
    const execute = vi.fn();
    bridge.registerTool("tool1", execute);

    window.dispatchEvent(createMessageEvent({ type: "localapp:register_tools", tools: [] }));
    window.dispatchEvent(createMessageEvent({ type: "something_else" }));

    await new Promise((r) => setTimeout(r, 10));
    expect(execute).not.toHaveBeenCalled();
  });

  it("stops listening after destroy", async () => {
    const execute = vi.fn();
    bridge.registerTool("tool1", execute);
    bridge.destroy();

    window.dispatchEvent(
      createMessageEvent({ type: "localapp:tool_call", callId: "d1", toolName: "tool1", args: {} }),
    );

    await new Promise((r) => setTimeout(r, 10));
    expect(execute).not.toHaveBeenCalled();
  });
});
