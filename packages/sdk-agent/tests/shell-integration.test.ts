import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Test the shellIntegration logic at the protocol level
import { postToParent, isToggleChatMessage } from "../src/postmessage-types.js";

describe("shellIntegration protocol", () => {
  let mockPostMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockPostMessage = vi.fn();
    vi.spyOn(window, "parent", "get").mockReturnValue({
      postMessage: mockPostMessage,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends ai_custom_mode declaration to parent", () => {
    postToParent({ type: "localapp:ai_custom_mode" });
    expect(mockPostMessage).toHaveBeenCalledWith(
      { type: "localapp:ai_custom_mode" },
      window.location.origin,
    );
  });

  it("recognizes toggle_chat message", () => {
    expect(isToggleChatMessage({ type: "localapp:toggle_chat" })).toBe(true);
  });

  it("rejects non-toggle_chat messages", () => {
    expect(isToggleChatMessage({ type: "localapp:tool_call" })).toBe(false);
    expect(isToggleChatMessage({ type: "something_else" })).toBe(false);
    expect(isToggleChatMessage(null)).toBe(false);
    expect(isToggleChatMessage(undefined)).toBe(false);
  });

  it("toggle_chat listener toggles state", () => {
    let chatOpen = false;
    function onMessage(event: MessageEvent) {
      if (isToggleChatMessage(event.data)) {
        chatOpen = !chatOpen;
      }
    }
    window.addEventListener("message", onMessage);

    // First toggle: false → true
    window.dispatchEvent(new MessageEvent("message", { data: { type: "localapp:toggle_chat" } }));
    expect(chatOpen).toBe(true);

    // Second toggle: true → false
    window.dispatchEvent(new MessageEvent("message", { data: { type: "localapp:toggle_chat" } }));
    expect(chatOpen).toBe(false);

    // Ignore other messages
    window.dispatchEvent(new MessageEvent("message", { data: { type: "localapp:tool_call" } }));
    expect(chatOpen).toBe(false);

    window.removeEventListener("message", onMessage);
  });

  it("does not send when window.parent === window", () => {
    vi.restoreAllMocks();
    // In jsdom, default window.parent === window, so postToParent should be no-op
    const localMock = vi.spyOn(window, "postMessage");
    postToParent({ type: "localapp:ai_custom_mode" });
    // postToParent checks window.parent !== window, so it won't post
    expect(localMock).not.toHaveBeenCalled();
  });
});
