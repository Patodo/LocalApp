import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDesktopApi,
  desktop,
  DesktopActionError,
  type DesktopActionSnapshot,
} from "../src/index.js";

function response(data: unknown, status = 200, contentType = "application/json"): Response {
  return new Response(contentType === "application/json" ? JSON.stringify({ success: status < 400, data }) : String(data), {
    status,
    headers: { "Content-Type": contentType },
  });
}

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  private listeners = new Map<string, Array<(event: MessageEvent<string>) => void>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  emit(data: unknown, type = "message"): void {
    const event = new MessageEvent(type, { data: JSON.stringify(data) });
    if (type === "message") this.onmessage?.(event);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  fail(): void {
    this.onerror?.();
  }
}

const action = {
  title: "Export report",
  script: "return { path: 'report.csv' };",
  input: { reportId: 7 },
  dependencies: { csv: "6.3.11" },
};

describe("desktop action API", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("window", { location: { pathname: "/serve/alice/reports/" } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("negotiates, creates, activates, and resolves a sanitized SSE terminal snapshot", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, online: true, protocolVersion: 1 }))
      .mockResolvedValueOnce(response({ requestId: "request-1", activationUrl: "localapp://action/request-1?nonce=secret" }));
    const click = vi.fn();
    const remove = vi.fn();
    const createElement = vi.fn(() => ({ click, remove, style: {}, href: "" }));
    vi.stubGlobal("document", { querySelector: vi.fn(() => null), createElement, body: { appendChild: vi.fn() } });

    const requestIds: string[] = [];
    const statuses: string[] = [];
    const desktop = createDesktopApi({
      fetch: fetchMock,
      EventSource: MockEventSource as never,
    });
    const resultPromise = desktop.run<{ path: string }>(action, {
      observationTimeoutMs: 100,
      onRequestId: (id) => requestIds.push(id),
      onStatus: (snapshot) => statuses.push(snapshot.status),
    });

    await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    MockEventSource.instances[0].emit({
      success: true,
      data: {
        id: "request-1",
        status: "succeeded",
        result: { path: "report.csv" },
        script: "must not escape",
        nonce: "must not escape",
        installationId: "desktop-a",
      },
    }, "desktop:action-updated");

    await expect(resultPromise).resolves.toEqual({
      requestId: "request-1",
      status: "succeeded",
      result: { path: "report.csv" },
      error: null,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/desktop-actions/capabilities", { method: "GET" });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/serve/alice/reports/api/desktop-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...action, protocolVersion: 1 }),
    });
    expect(MockEventSource.instances[0].url).toBe("/api/desktop-actions/request-1/events");
    expect(createElement).toHaveBeenCalledWith("a");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(requestIds).toEqual(["request-1"]);
    expect(statuses).toEqual(["pending", "succeeded"]);
  });

  it("falls back from an SSE error to bounded polling", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, online: true, protocolVersion: 1 }))
      .mockResolvedValueOnce(response({ requestId: "request-2", activationUrl: "localapp://action/request-2?nonce=n" }))
      .mockResolvedValueOnce(response({ id: "request-2", status: "running" }))
      .mockResolvedValueOnce(response({ id: "request-2", status: "succeeded", result: 42 }));
    const desktop = createDesktopApi({
      fetch: fetchMock,
      EventSource: MockEventSource as never,
      activate: vi.fn(),
      pollIntervalMs: 1,
    });

    const promise = desktop.run<number>(action);
    await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    MockEventSource.instances[0].fail();

    await expect(promise).resolves.toMatchObject({ requestId: "request-2", status: "succeeded", result: 42 });
    expect(MockEventSource.instances[0].close).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/desktop-actions/request-2", { method: "GET" });
  });

  it.each([
    [{ supported: false, online: false, protocolVersion: 1 }, "unsupported"],
    [{ supported: true, online: false, protocolVersion: 1 }, "offline"],
    [{ supported: true, online: true, protocolVersion: 2 }, "protocol_mismatch"],
  ] as const)("rejects unavailable capability %# with %s", async (capability, code) => {
    const fetchMock = vi.fn().mockResolvedValue(response(capability));
    const desktop = createDesktopApi({ fetch: fetchMock, activate: vi.fn() });

    await expect(desktop.run(action)).rejects.toMatchObject({ name: "DesktopActionError", code });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects a pre-aborted run before negotiation or side effects", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn();
    const activate = vi.fn();
    const desktop = createDesktopApi({ fetch: fetchMock, activate });

    await expect(desktop.run(action, { signal: controller.signal })).rejects.toMatchObject({
      name: "DesktopActionError",
      code: "aborted",
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("aborts in-flight capability negotiation with a stable error", async () => {
    const controller = new AbortController();
    const activate = vi.fn();
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const desktop = createDesktopApi({ fetch: fetchMock, activate });

    const promise = desktop.run(action, { signal: controller.signal });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/desktop-actions/capabilities", {
      method: "GET",
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "DesktopActionError", code: "aborted" });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(activate).not.toHaveBeenCalled();
  });

  it("aborts an in-flight creation request with a stable error", async () => {
    const controller = new AbortController();
    const activate = vi.fn();
    const onRequestId = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, online: true, protocolVersion: 1 }))
      .mockImplementationOnce((_url: string | URL | Request, init?: RequestInit) => Promise.resolve({
        ok: true,
        status: 200,
        text: () => new Promise<string>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
        }),
      } as Response));
    const desktop = createDesktopApi({ fetch: fetchMock, activate });

    const promise = desktop.run(action, { signal: controller.signal, onRequestId });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/desktop-actions/capabilities", {
      method: "GET",
      signal: controller.signal,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/serve/alice/reports/api/desktop-actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...action, protocolVersion: 1 }),
      signal: controller.signal,
    });
    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "DesktopActionError", code: "aborted" });
    expect(onRequestId).not.toHaveBeenCalled();
    expect(activate).not.toHaveBeenCalled();
  });

  it("aborts observation without cancelling the created action", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, online: true, protocolVersion: 1 }))
      .mockResolvedValueOnce(response({ requestId: "request-3", activationUrl: "localapp://action/request-3?nonce=n" }));
    const controller = new AbortController();
    const desktop = createDesktopApi({ fetch: fetchMock, EventSource: MockEventSource as never, activate: vi.fn() });

    const promise = desktop.run(action, { signal: controller.signal });
    await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "aborted", requestId: "request-3" });
    expect(MockEventSource.instances[0].close).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears a pending polling delay when observation is aborted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, online: true, protocolVersion: 1 }))
      .mockResolvedValueOnce(response({ requestId: "request-poll", activationUrl: "localapp://action/request-poll?nonce=n" }))
      .mockResolvedValueOnce(response({ id: "request-poll", status: "running" }));
    const controller = new AbortController();
    const desktop = createDesktopApi({ fetch: fetchMock, activate: vi.fn(), pollIntervalMs: 60_000 });

    const promise = desktop.run(action, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(2);

    controller.abort();

    await expect(promise).rejects.toMatchObject({ code: "aborted", requestId: "request-poll" });
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times out observation with a stable error code", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, online: true, protocolVersion: 1 }))
      .mockResolvedValueOnce(response({ requestId: "request-4", activationUrl: "localapp://action/request-4?nonce=n" }));
    const desktop = createDesktopApi({ fetch: fetchMock, EventSource: MockEventSource as never, activate: vi.fn() });
    const promise = desktop.run(action, { observationTimeoutMs: 50 });
    const expectation = expect(promise).rejects.toMatchObject({ code: "observation_timeout", requestId: "request-4" });
    await vi.advanceTimersByTimeAsync(50);

    await expectation;
  });

  it("recovers by request ID and converts HTML errors without leaking JSON parser failures", async () => {
    const terminal: DesktopActionSnapshot<number> = {
      requestId: "request-5",
      status: "succeeded",
      result: 7,
      error: null,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ id: "request-5", status: "succeeded", result: 7, script: "private", nonce: "private" }))
      .mockResolvedValueOnce(response("<!doctype html><title>Login</title>", 502, "text/html"));
    const desktop = createDesktopApi({ fetch: fetchMock });

    await expect(desktop.get<number>("request-5")).resolves.toEqual(terminal);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/desktop-actions/request-5", { method: "GET" });
    const rejected = desktop.get("request-html");
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/desktop-actions/request-html", { method: "GET" });
    await expect(rejected).rejects.toBeInstanceOf(DesktopActionError);
    await expect(rejected).rejects.not.toThrow("Unexpected token '<'");
  });

  it("resolves browser globals when the exported singleton is called", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, online: true, protocolVersion: 1 }))
      .mockResolvedValueOnce(response({ requestId: "request-global", activationUrl: "localapp://action/request-global?nonce=n" }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => ({ href: "", style: {}, click: vi.fn(), remove: vi.fn() })),
      body: { appendChild: vi.fn() },
    });

    const promise = desktop.run(action);
    await vi.waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    MockEventSource.instances[0].emit({ id: "request-global", status: "succeeded", result: true });

    await expect(promise).resolves.toMatchObject({ requestId: "request-global", result: true });
  });
});
