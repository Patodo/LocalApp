import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPlatformRuntime, isPlatformResponseMessage } from "../src/platform-runtime.js";

function response(id: string, result: unknown) {
  return new MessageEvent("message", {
    data: { type: "localapp:platform_response", id, ok: true, result },
  });
}

describe("platform runtime", () => {
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

  it("sends headless platform capability requests to the parent shell", async () => {
    const runtime = createPlatformRuntime({ requestId: () => "req-download" });
    const done = runtime.downloadFile({
      filename: "report.csv",
      mimeType: "text/csv",
      data: "a,b\n1,2",
    });

    expect(mockPostMessage).toHaveBeenCalledWith(
      {
        type: "localapp:platform_request",
        id: "req-download",
        capability: "downloadFile",
        payload: { filename: "report.csv", mimeType: "text/csv", data: "a,b\n1,2" },
      },
      window.location.origin,
    );

    window.dispatchEvent(response("req-download", { success: true }));
    await expect(done).resolves.toEqual({ success: true });
    runtime.destroy();
  });

  it("exposes user, time, clipboard, route, confirm, and AI capabilities without owning app UI", async () => {
    const ids = ["req-user", "req-time", "req-copy", "req-route", "req-confirm", "req-ai"];
    const runtime = createPlatformRuntime({ requestId: () => ids.shift() ?? "req-extra" });

    const userPromise = runtime.getCurrentUser();
    const timePromise = runtime.getServerTime();
    const copyPromise = runtime.copyText("hello");
    const routePromise = runtime.openRoute({ href: "/my/apps" });
    const confirmPromise = runtime.confirm({
      title: "Delete record",
      message: "Confirm deleting this record?",
      confirmText: "Delete",
      cancelText: "Cancel",
      tone: "danger",
    });
    const aiPromise = runtime.ai.open();

    const messages = mockPostMessage.mock.calls.map((call) => call[0]);
    expect(messages.map((msg) => msg.capability)).toEqual([
      "getCurrentUser",
      "getServerTime",
      "copyText",
      "openRoute",
      "confirm",
      "ai.open",
    ]);
    expect(messages[2].payload).toEqual({ text: "hello" });
    expect(messages[3].payload).toEqual({ href: "/my/apps" });
    expect(messages[4].payload).toEqual({
      title: "Delete record",
      message: "Confirm deleting this record?",
      confirmText: "Delete",
      cancelText: "Cancel",
      tone: "danger",
    });

    window.dispatchEvent(response("req-user", { id: "test-owner", name: "test-owner" }));
    window.dispatchEvent(response("req-time", { now: "2026-06-18T12:00:00.000Z" }));
    window.dispatchEvent(response("req-copy", { success: true }));
    window.dispatchEvent(response("req-route", { success: true }));
    window.dispatchEvent(response("req-confirm", true));
    window.dispatchEvent(response("req-ai", { success: true }));

    await expect(userPromise).resolves.toEqual({ id: "test-owner", name: "test-owner" });
    await expect(timePromise).resolves.toEqual({ now: "2026-06-18T12:00:00.000Z" });
    await expect(copyPromise).resolves.toEqual({ success: true });
    await expect(routePromise).resolves.toEqual({ success: true });
    await expect(confirmPromise).resolves.toBe(true);
    await expect(aiPromise).resolves.toEqual({ success: true });
    runtime.destroy();
  });

  it("recognizes platform response messages", () => {
    expect(isPlatformResponseMessage({ type: "localapp:platform_response", id: "1", ok: true })).toBe(true);
    expect(isPlatformResponseMessage({ type: "localapp:platform_request", id: "1" })).toBe(false);
  });

  it("sends same-window platform requests when no parent shell exists", async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, "parent", "get").mockReturnValue(window);
    const onRequest = vi.fn((event: Event) => {
      const detail = (event as CustomEvent).detail;
      window.dispatchEvent(response(detail.id, { success: true }));
    });
    window.addEventListener("localapp:platform_request", onRequest);

    const runtime = createPlatformRuntime({ requestId: () => "local-copy" });

    await expect(runtime.copyText("local")).resolves.toEqual({ success: true });
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        type: "localapp:platform_request",
        id: "local-copy",
        capability: "copyText",
        payload: { text: "local" },
      },
    });
    window.removeEventListener("localapp:platform_request", onRequest);
    runtime.destroy();
  });

  it("routes same-window confirm through the platform host", async () => {
    vi.restoreAllMocks();
    vi.spyOn(window, "parent", "get").mockReturnValue(window);
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onRequest = vi.fn((event: Event) => {
      const detail = (event as CustomEvent).detail;
      window.dispatchEvent(response(detail.id, true));
    });
    window.addEventListener("localapp:platform_request", onRequest);
    const runtime = createPlatformRuntime({ requestId: () => "local-confirm" });

    await expect(runtime.confirm({ title: "Confirm action", message: "Continue?" })).resolves.toBe(true);
    expect(onRequest).toHaveBeenCalledTimes(1);
    expect(onRequest.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        type: "localapp:platform_request",
        id: "local-confirm",
        capability: "confirm",
        payload: { title: "Confirm action", message: "Continue?" },
      },
    });
    expect(nativeConfirm).not.toHaveBeenCalled();
    window.removeEventListener("localapp:platform_request", onRequest);
    runtime.destroy();
  });
});
