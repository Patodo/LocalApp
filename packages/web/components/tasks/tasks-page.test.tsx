import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./tasks-page";

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  closed = false;
  constructor(readonly url: string) { MockEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() { this.closed = true; }
}

const runningTask = {
  id: "task-1", workspaceId: "workspace-1", kind: "build", executable: "npm", args: ["run", "build"],
  timeoutMs: 60000, requestedBy: "admin", status: "running", pid: 1, processIdentity: "p", exitCode: null,
  error: null, createdAt: "2026-08-09T00:00:00.000Z", startedAt: "2026-08-09T00:00:00.000Z", completedAt: null,
};

describe("TasksPage", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks" && options?.method === "POST") return new Response(JSON.stringify({ success: true, data: runningTask }), { status: 201 });
      if (url === "/api/tasks/task-1/cancel") return new Response(JSON.stringify({ success: true, data: { ...runningTask, status: "cancelled" } }));
      if (url === "/api/workspaces") return new Response(JSON.stringify({ success: true, data: [{ id: "workspace-1", name: "demo" }] }));
      if (url === "/api/me") return new Response(JSON.stringify({ success: true, data: { id: "admin", role: "admin" } }));
      return new Response(JSON.stringify({ success: true, data: [] }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("starts an administrator task, streams its logs, and cancels it", async () => {
    const view = render(<TasksPage />);
    await screen.findByLabelText("工作区");
    fireEvent.change(screen.getByLabelText("工作区"), { target: { value: "workspace-1" } });
    fireEvent.click(screen.getByRole("button", { name: "启动构建" }));

    await screen.findByText("task-1");
    expect(MockEventSource.instances[0]?.url).toBe("/api/tasks/task-1/events");
    fireEvent.click(screen.getByRole("button", { name: "取消任务 task-1" }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/tasks/task-1/cancel", expect.objectContaining({ method: "POST", credentials: "include" })));
    view.unmount();
    expect(MockEventSource.instances[0]?.closed).toBe(true);
  });
});
