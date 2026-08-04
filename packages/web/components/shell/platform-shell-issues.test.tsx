import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformShell } from "./platform-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/components/auth-modals/auth-provider", () => ({
  useAuthModals: () => ({ openLogin: vi.fn() }),
}));

vi.mock("./platform-agent", () => ({
  usePlatformAgent: () => ({
    chatMessages: [],
    isRunning: false,
    aiError: null,
    agentSend: vi.fn(),
    handleToolResult: vi.fn(),
  }),
}));

vi.mock("./issues-modal", () => ({
  IssuesModal: ({ selectedIssueId, selectedIssueNumber, onIssueNavigate, onIssuesChanged, onClose }: { selectedIssueId?: number | null; selectedIssueNumber?: number | null; onIssueNavigate?: (issueId: number | null, mode?: "push" | "replace") => void; onIssuesChanged?: () => void; onClose: () => void }) => (
    <div role="dialog" aria-label="Issues test dialog" data-testid="mock-issues-workspace" data-localapp-issues-workspace>
      <span data-testid="selected-issue-id">{selectedIssueId ?? "list"}</span>
      <span data-testid="selected-issue-number">{selectedIssueNumber ?? "none"}</span>
      <button type="button" onClick={() => onIssueNavigate?.(12)}>打开测试 Issue</button>
      <button type="button" onClick={() => onIssueNavigate?.(null)}>返回测试列表</button>
      <button type="button" onClick={() => onIssueNavigate?.(99, "replace")}>规范化编号引用</button>
      <button type="button" onClick={onIssuesChanged}>模拟 Issue 变更</button>
      <button type="button" onClick={onClose}>关闭测试面板</button>
    </div>
  ),
}));

class MockEventSource {
  addEventListener() {}
  close() {}
}

function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  vi.stubGlobal("EventSource", MockEventSource);
  window.history.replaceState(null, "", "/owner/app");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PlatformShell Issue count", () => {
  it("opens a deep-linked Issue and follows browser history without changing app URL state", async () => {
    window.history.replaceState(null, "", "/owner/app?tab=history&localappIssueId=12#stage-2");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      return json({ success: true, data: [] });
    }));

    render(<PlatformShell userId="owner" name="app" />);
    expect(await screen.findByTestId("selected-issue-id")).toHaveTextContent("12");

    fireEvent.click(screen.getByRole("button", { name: "返回测试列表" }));
    expect(window.location.href).toContain("?tab=history&localappIssues=1#stage-2");
    expect(window.location.href).not.toContain("localappIssueId");

    window.history.pushState(null, "", "/owner/app?tab=history&localappIssueId=21#stage-2");
    fireEvent.popState(window);
    expect(await screen.findByTestId("selected-issue-id")).toHaveTextContent("21");
  });

  it("writes detail navigation to history and clears it when the workspace closes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      return json({ success: true, data: [] });
    }));
    render(<PlatformShell userId="owner" name="app" />);

    fireEvent.click(await screen.findByRole("button", { name: /^Issue/ }));
    fireEvent.click(screen.getByRole("button", { name: "打开测试 Issue" }));
    expect(window.location.search).toBe("?localappIssues=1&localappIssueId=12");
    fireEvent.click(screen.getByRole("button", { name: "关闭测试面板" }));
    expect(window.location.search).toBe("");
  });

  it("restores the Issue history entry when browser navigation would close an uploading workspace", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      return json({ success: true, data: [] });
    }));
    window.history.replaceState(null, "", "/owner/app?localappIssues=1&localappIssueId=12");
    render(<PlatformShell userId="owner" name="app" />);
    const workspace = await screen.findByTestId("mock-issues-workspace");
    const queue = document.createElement("div");
    queue.tabIndex = -1;
    queue.setAttribute("data-localapp-issue-attachment-queue", "true");
    queue.setAttribute("aria-busy", "true");
    workspace.appendChild(queue);

    window.history.pushState(null, "", "/owner/app");
    fireEvent.popState(window);

    expect(screen.getByRole("dialog", { name: "Issues test dialog" })).toBeInTheDocument();
    expect(screen.getByTestId("selected-issue-id")).toHaveTextContent("12");
    expect(window.location.search).toBe("?localappIssues=1&localappIssueId=12");
    expect(queue).toHaveFocus();
  });

  it("opens a public-number deep link and replaces it with the resolved database id", async () => {
    window.history.replaceState(null, "", "/owner/app?localappIssueNumber=42");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      return json({ success: true, data: [] });
    }));
    render(<PlatformShell userId="owner" name="app" />);

    expect(await screen.findByTestId("selected-issue-number")).toHaveTextContent("42");
    fireEvent.click(screen.getByRole("button", { name: "规范化编号引用" }));
    expect(window.location.search).toBe("?localappIssues=1&localappIssueId=99");
    expect(screen.getByTestId("selected-issue-number")).toHaveTextContent("none");
  });

  it("prefers the JSON meta.open count over the response data length", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      if (url.startsWith("/api/issues?")) {
        return json({
          success: true,
          data: [{ id: 1 }, { id: 2 }],
          meta: { open: 7 },
        });
      }
      return json({ success: true, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PlatformShell userId="owner" name="app" />);

    await screen.findByRole("button", { name: "Issue，7 个待处理" });
  });

  it("falls back to data length when meta.open is not a finite non-negative number", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      if (url.startsWith("/api/issues?")) {
        return json({
          success: true,
          data: [{ id: 1 }, { id: 2 }, { id: 3 }],
          meta: { open: -1 },
        });
      }
      return json({ success: true, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PlatformShell userId="owner" name="app" />);

    await screen.findByRole("button", { name: "Issue，3 个待处理" });
  });

  it("loads the Open count and refreshes it after the Issue workspace changes", async () => {
    let issueQueries = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      if (url.startsWith("/api/issues?")) {
        issueQueries += 1;
        const length = issueQueries === 1 ? 2 : 4;
        return json({ success: true, data: Array.from({ length }, (_, id) => ({ id })) });
      }
      return new Response("<html><body><div id=\"root\"></div></body></html>", {
        headers: { "Content-Type": "text/html" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PlatformShell userId="owner" name="app" />);

    const issueEntry = await screen.findByRole("button", { name: "Issue，2 个待处理" });
    fireEvent.click(issueEntry);
    const workspace = await screen.findByTestId("mock-issues-workspace");
    expect(workspace.closest("[data-localapp-app-area]")).not.toBeNull();
    expect(screen.getByTestId("shell-nav-background")).toHaveAttribute("inert");
    expect(screen.getByTestId("shell-nav-background")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("shell-nav-background")).toHaveClass("shrink-0");
    expect(screen.getByTestId("app-background")).toHaveAttribute("inert");
    expect(screen.getByTestId("app-background")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("app-background")).toHaveClass("absolute", "inset-0");
    expect(workspace.closest("[inert]")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "模拟 Issue 变更" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Issue，4 个待处理", hidden: true })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "关闭测试面板" }));
    expect(screen.getByTestId("shell-nav-background")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("shell-nav-background")).not.toHaveAttribute("aria-hidden");
    expect(screen.getByTestId("app-background")).not.toHaveAttribute("inert");
    expect(screen.getByTestId("app-background")).not.toHaveAttribute("aria-hidden");
    expect(issueQueries).toBe(2);
  });

  it("keeps the last Open count when a refresh times out", async () => {
    let issueQueries = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      if (url.startsWith("/api/issues?")) {
        issueQueries += 1;
        if (issueQueries === 1) return json({ success: true, data: [{ id: 1 }, { id: 2 }], meta: { open: 2 } });
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      }
      return json({ success: true, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PlatformShell userId="owner" name="app" />);

    await screen.findByRole("button", { name: "Issue，2 个待处理" });
    fireEvent.click(screen.getByRole("button", { name: "Issue，2 个待处理" }));
    const changeButton = await screen.findByRole("button", { name: "模拟 Issue 变更" });
    vi.useFakeTimers();
    fireEvent.click(changeButton);
    await vi.advanceTimersByTimeAsync(8_000);

    expect(screen.getByRole("button", { name: "Issue，2 个待处理", hidden: true })).toBeInTheDocument();
  });

  it("ignores a stale Open count response after a newer refresh completes", async () => {
    const issueResolvers: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") return json({ success: true, data: { id: "u1", name: "alice" } });
      if (url.includes("/meta")) return json({ success: true, data: { name: "app", userId: "owner", lifecycleStatus: "online" } });
      if (url.includes("/api/favorites")) return json({ success: true, data: { count: 0, favorited: false } });
      if (url.startsWith("/api/issues?")) {
        return new Promise<Response>((resolve) => issueResolvers.push(resolve));
      }
      return json({ success: true, data: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<PlatformShell userId="owner" name="app" />);

    await waitFor(() => expect(issueResolvers).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Issue" }));
    fireEvent.click(await screen.findByRole("button", { name: "模拟 Issue 变更" }));
    await waitFor(() => expect(issueResolvers).toHaveLength(2));

    issueResolvers[1](json({ success: true, data: Array.from({ length: 4 }, (_, id) => ({ id })) }));
    await screen.findByRole("button", { name: "Issue，4 个待处理", hidden: true });
    issueResolvers[0](json({ success: true, data: Array.from({ length: 2 }, (_, id) => ({ id })) }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("button", { name: "Issue，4 个待处理", hidden: true })).toBeInTheDocument();
  });
});
