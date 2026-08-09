import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TasksPage } from "./tasks-page";

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  closed = false;
  closeCalls = 0;
  constructor(readonly url: string) { MockEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  close() { this.closeCalls += 1; this.closed = true; }
}

const runningTask = {
  id: "task-1", workspaceId: "workspace-1", kind: "build", executable: "npm", args: ["run", "build"],
  timeoutMs: 60000, requestedBy: "admin", status: "running", pid: 1, processIdentity: "p", exitCode: null,
  error: null, createdAt: "2026-08-09T00:00:00.000Z", startedAt: "2026-08-09T00:00:00.000Z", completedAt: null,
};

describe("TasksPage", () => {
  let role = "admin";
  let initialTasks: typeof runningTask[] = [];

  beforeEach(() => {
    role = "admin";
    initialTasks = [];
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/tasks" && options?.method === "POST") return new Response(JSON.stringify({ success: true, data: runningTask }), { status: 201 });
      if (url === "/api/tasks/task-1/cancel") return new Response(JSON.stringify({ success: true, data: { ...runningTask, status: "cancelled" } }));
      if (url === "/api/workspaces") return new Response(JSON.stringify({ success: true, data: [{ id: "workspace-1", name: "demo" }] }));
      if (url === "/api/me") return new Response(JSON.stringify({ success: true, data: { id: role, role } }));
      if (url === "/api/tasks") return new Response(JSON.stringify({ success: true, data: initialTasks }));
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

  it("keeps one EventSource open across repeated running status events and closes it once when terminal", async () => {
    const view = render(<TasksPage />);
    await screen.findByLabelText("工作区");
    fireEvent.click(screen.getByRole("button", { name: "启动构建" }));
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    act(() => MockEventSource.instances[0]?.emit("status", { ...runningTask, pid: 2 }));
    act(() => MockEventSource.instances[0]?.emit("status", { ...runningTask, pid: 3 }));
    await waitFor(() => expect(screen.getByText(/· running/)).toBeInTheDocument());
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.closed).toBe(false);
    expect(MockEventSource.instances[0]?.closeCalls).toBe(0);

    act(() => MockEventSource.instances[0]?.emit("status", { ...runningTask, status: "succeeded", completedAt: "2026-08-09T00:01:00.000Z" }));
    await waitFor(() => expect(MockEventSource.instances[0]?.closed).toBe(true));
    expect(MockEventSource.instances[0]?.closeCalls).toBe(1);
    view.unmount();
    expect(MockEventSource.instances).toHaveLength(1);
    expect(MockEventSource.instances[0]?.closeCalls).toBe(1);
  });

  it("lets an ordinary user view owned historical tasks without start controls", async () => {
    role = "user";
    initialTasks = [{ ...runningTask, status: "succeeded", requestedBy: "user", completedAt: "2026-08-09T00:01:00.000Z" }];
    render(<TasksPage />);

    expect(await screen.findByText("task-1")).toBeInTheDocument();
    expect(screen.getByText(/只有管理员可以启动新任务/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "启动构建" })).toBeNull();
  });
});
