import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeersPage } from "./peers-page";

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  closeCalls = 0;
  constructor(readonly url: string) { MockEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, value: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
  close() { this.closeCalls += 1; }
}

const runningJob = {
  id: "job-1", ownerId: "localadmin", appName: "notes", peerId: "peer-1", syncId: "sync-1", withData: false,
  status: "staging", history: [{ status: "queued", at: "2026-08-09T00:00:00.000Z" }], error: null,
  createdAt: "2026-08-09T00:00:00.000Z", updatedAt: "2026-08-09T00:00:00.000Z", completedAt: null,
};

describe("PeersPage", () => {
  let initialPeers: Array<{ id: string; name: string; baseUrl: string; verifiedAt: null }>;

  beforeEach(() => {
    initialPeers = [];
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/peers" && options?.method === "POST") {
        return new Response(JSON.stringify({ success: true, data: { id: "peer-1", name: "office", baseUrl: "https://office.example", verifiedAt: null } }), { status: 201 });
      }
      if (String(input) === "/api/me/apps/notes/sync" && options?.method === "POST") {
        return new Response(JSON.stringify({ success: true, data: runningJob }), { status: 202 });
      }
      if (String(input) === "/api/sync-jobs/job-1/cancel") {
        return new Response(JSON.stringify({ success: true, data: { ...runningJob, status: "failed", error: "Cancelled" } }));
      }
      if (String(input) === "/api/peers") {
        return new Response(JSON.stringify({ success: true, data: initialPeers }));
      }
      if (String(input) === "/api/sync-jobs") return new Response(JSON.stringify({ success: true, data: [] }));
      return new Response(JSON.stringify({ success: true, data: [] }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submits a credential once, clears it in finally, and renders only public peer metadata", async () => {
    render(<PeersPage />);
    const apiKey = await screen.findByLabelText("目标 API Key");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("目标地址"), { target: { value: "https://office.example" } });
    fireEvent.change(apiKey, { target: { value: "peer-api-key-that-must-not-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "添加对端" }));

    await waitFor(() => expect(apiKey).toHaveValue(""));
    expect(await screen.findByText("office")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("peer-api-key-that-must-not-leak")).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/peers", expect.objectContaining({
      method: "POST", credentials: "include",
      body: JSON.stringify({ name: "office", baseUrl: "https://office.example", apiKey: "peer-api-key-that-must-not-leak", acceptInsecureHttp: false }),
    }));
  });

  it("clears the API Key even when peer creation fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/peers" && options?.method === "POST") return new Response(JSON.stringify({ success: false, error: "拒绝" }), { status: 400 });
      return new Response(JSON.stringify({ success: true, data: [] }));
    });
    render(<PeersPage />);
    const apiKey = await screen.findByLabelText("目标 API Key");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("目标地址"), { target: { value: "https://office.example" } });
    fireEvent.change(apiKey, { target: { value: "peer-api-key-that-must-not-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "添加对端" }));
    await waitFor(() => expect(apiKey).toHaveValue(""));
    expect(screen.getByRole("alert")).toHaveTextContent("拒绝");
  });

  it("starts app-only synchronization without a credential, streams one stable job source, and cancels before activation", async () => {
    initialPeers = [{ id: "peer-1", name: "office", baseUrl: "https://office.example", verifiedAt: null }];
    const view = render(<PeersPage />);
    const appName = await screen.findByLabelText("同步应用 office");
    fireEvent.change(appName, { target: { value: "notes" } });
    fireEvent.click(screen.getByRole("button", { name: "同步应用到 office" }));

    await screen.findByText("job-1");
    expect(screen.getByText("queued")).toBeInTheDocument();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/me/apps/notes/sync", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ peerId: "peer-1", withData: false }),
    }));
    const serializedCalls = JSON.stringify(vi.mocked(fetch).mock.calls);
    expect(serializedCalls).not.toContain("target-peer-key");
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].url).toBe("/api/sync-jobs/job-1/events");

    const untrustedHistoryText = '<img src=x onerror="alert(1)">';
    const installingJob = {
      ...runningJob,
      status: "installing",
      history: [...runningJob.history, { status: "installing", at: "2026-08-09T00:00:01.000Z", error: untrustedHistoryText }],
    };
    act(() => MockEventSource.instances[0].emit("status", installingJob));
    act(() => MockEventSource.instances[0].emit("status", installingJob));
    await waitFor(() => expect(screen.getByText("installing")).toBeInTheDocument());
    expect(screen.getByText(untrustedHistoryText)).toBeInTheDocument();
    expect(view.container.querySelector("img")).toBeNull();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0].closeCalls).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "取消同步 job-1" }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/sync-jobs/job-1/cancel", expect.objectContaining({ method: "POST", credentials: "include" })));
    view.unmount();
    expect(MockEventSource.instances[0].closeCalls).toBe(1);
  });

  it("closes a job stream exactly once on terminal status and does not reconnect", async () => {
    initialPeers = [{ id: "peer-1", name: "office", baseUrl: "https://office.example", verifiedAt: null }];
    const view = render(<PeersPage />);
    fireEvent.change(await screen.findByLabelText("同步应用 office"), { target: { value: "notes" } });
    fireEvent.click(screen.getByRole("button", { name: "同步应用到 office" }));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => MockEventSource.instances[0].emit("status", { ...runningJob, status: "completed", completedAt: "2026-08-09T00:01:00.000Z" }));
    await waitFor(() => expect(MockEventSource.instances[0].closeCalls).toBe(1));
    expect(MockEventSource.instances).toHaveLength(1);
    view.unmount();
    expect(MockEventSource.instances[0].closeCalls).toBe(1);
  });
});
