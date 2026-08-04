import { render, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { PlatformShell } from "./platform-shell";

const sendBeaconMock = vi.fn(() => true);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/auth-modals/auth-provider", () => ({
  useAuthModals: () => ({ openLogin: vi.fn() }),
}));

type EditSession = {
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  busy: boolean;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
};

type EditSessionRegistry = {
  registerEditSession(session: EditSession): () => void;
};

declare global {
  var __localapp_platform_edit_session_registry__: EditSessionRegistry | null | undefined;
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data: JSON.stringify(data) }));
    }
  }
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  globalThis.__localapp_platform_edit_session_registry__ = null;
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource);
  sendBeaconMock.mockClear();
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: sendBeaconMock });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
    if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
    if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
    return new Response("<html><body><div id=\"root\"></div></body></html>", {
      headers: { "Content-Type": "text/html" },
    });
  }));
});

describe("PlatformShell edit session shortcuts", () => {
  it("subscribes to app presence and renders the online count", async () => {
    const { unmount } = render(React.createElement(PlatformShell, { userId: "owner", name: "app" }));

    await waitFor(() => {
      expect(MockEventSource.instances[0]?.url).toMatch(/^\/serve\/owner\/app\/api\/presence\/events\?clientId=/);
    });

    MockEventSource.instances[0].emit("presence:snapshot", {
      type: "presence:snapshot",
      data: { appOwner: "owner", appName: "app", count: 4, anonymousCount: 1, authenticatedUsers: [] },
    });

    await waitFor(() => {
      expect(document.body.textContent).toContain("4");
    });

    unmount();
    expect(MockEventSource.instances[0].closed).toBe(true);
  });

  it("releases background SSE while keeping the presence lease until the page leaves", async () => {
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const { unmount } = render(React.createElement(PlatformShell, { userId: "owner", name: "app" }));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(MockEventSource.instances[0].closed).toBe(true);
    expect(MockEventSource.instances).toHaveLength(1);
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([input, init]) =>
        String(input) === "/serve/owner/app/api/presence/heartbeat" && init?.method === "POST",
      )).toBe(true);
    });

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(MockEventSource.instances).toHaveLength(2);
    expect(MockEventSource.instances[1].closed).toBe(false);

    window.dispatchEvent(new Event("blur"));
    expect(MockEventSource.instances[1].closed).toBe(true);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    expect(MockEventSource.instances).toHaveLength(3);
    expect(MockEventSource.instances[2].closed).toBe(false);
    unmount();
    expect(MockEventSource.instances[2].closed).toBe(true);
    expect(sendBeaconMock).toHaveBeenCalledWith(
      "/serve/owner/app/api/presence/leave",
      expect.any(Blob),
    );
    window.dispatchEvent(new Event("focus"));
    expect(MockEventSource.instances).toHaveLength(3);
  });

  it("dispatches save undo and redo shortcuts to the registered edit session", async () => {
    const save = vi.fn();
    const undo = vi.fn();
    const redo = vi.fn();

    render(React.createElement(PlatformShell, { userId: "owner", name: "app" }));

    await waitFor(() => {
      expect(globalThis.__localapp_platform_edit_session_registry__).toBeTruthy();
    });

    globalThis.__localapp_platform_edit_session_registry__!.registerEditSession({
      canSave: true,
      canUndo: true,
      canRedo: true,
      busy: false,
      onSave: save,
      onUndo: undo,
      onRedo: redo,
    });

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(undo).toHaveBeenCalledTimes(1);
    expect(redo).toHaveBeenCalledTimes(2);
  });

  it("keeps the latest edit session when a stale cleanup runs after re-registration", async () => {
    const firstSave = vi.fn();
    const secondSave = vi.fn();

    render(React.createElement(PlatformShell, { userId: "owner", name: "app" }));

    await waitFor(() => {
      expect(globalThis.__localapp_platform_edit_session_registry__).toBeTruthy();
    });

    const cleanupFirst = globalThis.__localapp_platform_edit_session_registry__!.registerEditSession({
      canSave: true,
      canUndo: false,
      canRedo: false,
      busy: false,
      onSave: firstSave,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
    });
    globalThis.__localapp_platform_edit_session_registry__!.registerEditSession({
      canSave: true,
      canUndo: false,
      canRedo: false,
      busy: false,
      onSave: secondSave,
      onUndo: vi.fn(),
      onRedo: vi.fn(),
    });

    cleanupFirst();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true }));

    expect(firstSave).not.toHaveBeenCalled();
    expect(secondSave).toHaveBeenCalledTimes(1);
  });

  it("does not intercept undo and redo shortcuts inside editable targets", async () => {
    const undo = vi.fn();
    const redo = vi.fn();

    render(
      React.createElement(
        React.Fragment,
        null,
        React.createElement("input", { "aria-label": "title" }),
        React.createElement(PlatformShell, { userId: "owner", name: "app" }),
      ),
    );

    await waitFor(() => {
      expect(globalThis.__localapp_platform_edit_session_registry__).toBeTruthy();
    });

    globalThis.__localapp_platform_edit_session_registry__!.registerEditSession({
      canSave: true,
      canUndo: true,
      canRedo: true,
      busy: false,
      onSave: vi.fn(),
      onUndo: undo,
      onRedo: redo,
    });

    const input = document.querySelector("input")!;
    input.focus();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true, cancelable: true }));

    expect(undo).not.toHaveBeenCalled();
    expect(redo).not.toHaveBeenCalled();
  });
});
