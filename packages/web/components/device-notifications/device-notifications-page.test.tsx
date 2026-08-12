import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceNotificationsPage } from "./device-notifications-page";

const SECRET_CANARY = "localapp-api-key-secret-canary";

const localSource = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "local",
  sourceLabel: "本机 Server",
  accountLabel: "Local User",
  desiredEnabled: true,
  capability: { available: true, reason: null },
  connectionState: "connected",
  cursor: 42,
  lastEventAt: "2026-08-13T01:02:03.000Z",
  error: null,
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-13T01:02:03.000Z",
};

const peerSource = {
  id: "22222222-2222-4222-8222-222222222222",
  kind: "peer",
  sourceLabel: "团队 Server",
  accountLabel: "Remote User",
  desiredEnabled: false,
  capability: { available: true, reason: null },
  connectionState: "error",
  cursor: 9,
  lastEventAt: null,
  error: { code: "SOURCE_AUTH_FAILED", message: SECRET_CANARY },
  createdAt: "2026-08-12T00:00:00.000Z",
  updatedAt: "2026-08-13T01:02:03.000Z",
};

const overview = {
  deviceIntegration: { available: true },
  generation: 7,
  sources: [localSource, peerSource],
  availablePeers: [],
};

const settings = {
  deviceIntegration: { available: true },
  generation: 7,
  settings: { quietHours: null, preview: "full" as const },
  native: {
    permission: "denied",
    daemonVersion: "1.4.0",
    adapterVersion: "macos-2",
    updatedAt: "2026-08-13T01:02:03.000Z",
  },
  lastTest: null,
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetch(
  handler?: (url: string, init: RequestInit | undefined) => Response | Promise<Response> | undefined,
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handled = handler?.(String(input), init);
    if (handled) return await handled;
    if (String(input) === "/api/device-notifications/settings") {
      return json({ success: true, data: settings });
    }
    if (String(input) === "/api/device-notifications") {
      return json({ success: true, data: overview });
    }
    throw new Error(`Unexpected request: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("DeviceNotificationsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders a clear headless state and disables every device control", async () => {
    installFetch((url) => {
      if (url === "/api/device-notifications") {
        return json({ success: true, data: { deviceIntegration: { available: false }, generation: 0, sources: [] } });
      }
      if (url === "/api/device-notifications/settings") {
        return json({ success: true, data: {
          deviceIntegration: { available: false },
          generation: 0,
          settings: { quietHours: null, preview: "full" },
          native: { permission: "unsupported", daemonVersion: null, adapterVersion: null, updatedAt: null },
          lastTest: null,
        } });
      }
    });

    render(<DeviceNotificationsPage />);

    expect(screen.getByRole("status")).toHaveTextContent("正在加载设备通知设置");
    expect(await screen.findByText("此 Server 未启用本机设备集成")).toBeInTheDocument();
    expect(screen.getByText(/需要在桌面会话中启动 LocalApp daemon/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "启用此 Server 来源" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "保存显示设置" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "发送测试通知" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "刷新" })).toBeEnabled();
    expect(screen.getByLabelText("通知预览")).toBeDisabled();
    expect(screen.getByLabelText("启用安静时段")).toBeDisabled();
  });

  it("shows versions, permission help, source desired and actual state, cursor, event time, and a redacted error", async () => {
    installFetch();
    const view = render(<DeviceNotificationsPage />);

    expect(await screen.findByRole("heading", { name: "设备通知" })).toBeInTheDocument();
    expect(screen.getByText("可用")).toBeInTheDocument();
    expect(screen.getByText(/daemon 1\.4\.0/)).toBeInTheDocument();
    expect(screen.getByText(/adapter macos-2/)).toBeInTheDocument();
    expect(screen.getByText(/权限：已拒绝/)).toBeInTheDocument();
    expect(screen.getByText(/请在系统设置中允许通知/)).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "通知来源 本机 Server" })).toHaveTextContent("期望：启用");
    expect(screen.getByRole("article", { name: "通知来源 本机 Server" })).toHaveTextContent("实际：已连接");
    expect(screen.getByRole("article", { name: "通知来源 本机 Server" })).toHaveTextContent("游标：42");
    expect(screen.getByRole("article", { name: "通知来源 本机 Server" })).toHaveTextContent("2026-08-13T01:02:03.000Z");
    expect(screen.getByRole("article", { name: "通知来源 团队 Server" })).toHaveTextContent("来源认证失败");
    expect(view.container.textContent).not.toContain(SECRET_CANARY);
    expect(view.container.innerHTML).not.toContain(SECRET_CANARY);
  });

  it("saves quiet hours and hidden previews with the current generation", async () => {
    const fetchMock = installFetch((url, init) => {
      if (url === "/api/device-notifications/settings" && init?.method === "PUT") {
        return json({ success: true, data: {
          generation: 8,
          settings: { quietHours: { start: "22:30", end: "07:15", timeZone: "Asia/Tokyo" }, preview: "hidden" },
          native: settings.native,
          lastTest: null,
        } });
      }
    });
    render(<DeviceNotificationsPage />);

    fireEvent.click(await screen.findByLabelText("启用安静时段"));
    fireEvent.change(screen.getByLabelText("开始时间"), { target: { value: "22:30" } });
    fireEvent.change(screen.getByLabelText("结束时间"), { target: { value: "07:15" } });
    fireEvent.change(screen.getByLabelText("时区"), { target: { value: "Asia/Tokyo" } });
    fireEvent.change(screen.getByLabelText("通知预览"), { target: { value: "hidden" } });
    fireEvent.click(screen.getByRole("button", { name: "保存显示设置" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => (
      String(url) === "/api/device-notifications/settings" && init?.method === "PUT"
    ))).toBe(true));
    const putCall = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === "/api/device-notifications/settings" && init?.method === "PUT"
    ));
    expect(putCall?.[1]).toEqual(expect.objectContaining({
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    }));
    expect(JSON.parse(String(putCall?.[1]?.body))).toEqual({
      generation: 7,
      settings: { quietHours: { start: "22:30", end: "07:15", timeZone: "Asia/Tokyo" }, preview: "hidden" },
    });
    expect(await screen.findByText(/显示设置已保存/)).toHaveAttribute("role", "status");
    expect(screen.getByText("可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送测试通知" })).toBeEnabled();
  });

  it("uses existing local enable and disable routes without guessing an unavailable peer id", async () => {
    const fetchMock = installFetch((url, init) => {
      if (url === "/api/device-notifications/11111111-1111-4111-8111-111111111111/disable") {
        return json({ success: true, data: { generation: 8, source: { ...localSource, desiredEnabled: false, connectionState: "disabled" } } });
      }
      if (url === "/api/device-notifications/local/enable" && init?.method === "POST") {
        return json({ success: true, data: { generation: 9, source: { ...localSource, desiredEnabled: true, connectionState: "pending" } } });
      }
    });
    const view = render(<DeviceNotificationsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "停用 本机 Server" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/device-notifications/11111111-1111-4111-8111-111111111111/disable",
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify({ generation: 7 }) }),
    ));
    fireEvent.click(await screen.findByRole("button", { name: "启用 本机 Server" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/device-notifications/local/enable",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ generation: 8, label: "本机 Server" }),
      }),
    ));
    expect(screen.getByRole("button", { name: "启用 团队 Server" })).toBeDisabled();
    expect(screen.getByText(/需要从“对端连接”重新启用/)).toBeInTheDocument();
    expect(view.container.innerHTML).not.toMatch(/api[_-]?key|bearer|token/i);
  });

  it("submits a one-time test and reports its accepted lifecycle", async () => {
    const fetchMock = installFetch((url) => {
      if (url === "/api/device-notifications/test") {
        return json({ success: true, data: { generation: 8, test: { id: "test-1", state: "pending", result: null } } }, 202);
      }
    });
    render(<DeviceNotificationsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "发送测试通知" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/device-notifications/test",
      expect.objectContaining({ method: "POST", credentials: "include", body: JSON.stringify({ generation: 7 }) }),
    ));
    expect(await screen.findByText(/测试状态：pending/)).toBeInTheDocument();
  });

  it("enables a newly verified peer that has no historical notification source", async () => {
    const candidate = { peerId: "33333333-3333-4333-8333-333333333333", sourceLabel: "新对端", accountLabel: "Peer User" };
    const fetchMock = installFetch((url, init) => {
      if (url === "/api/device-notifications") return json({ success: true, data: { ...overview, availablePeers: [candidate] } });
      if (url === `/api/device-notifications/peers/${candidate.peerId}/enable`) {
        expect(init?.body).toBe(JSON.stringify({ generation: 7, label: "新对端" }));
        return json({ success: true, data: { generation: 8, source: { ...peerSource, id: candidate.peerId, peerId: candidate.peerId, sourceLabel: "新对端", desiredEnabled: true } } });
      }
    });
    render(<DeviceNotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "启用 新对端" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/device-notifications/peers/${candidate.peerId}/enable`, expect.objectContaining({ method: "POST" })));
    expect(await screen.findByText("对端通知来源已启用。")).toBeInTheDocument();
  });

  it("renders a completed test result using only stable public labels", async () => {
    installFetch((url) => {
      if (url === "/api/device-notifications/settings") {
        return json({ success: true, data: {
          ...settings,
          lastTest: { id: "test-1", state: "completed", result: "shown" },
        } });
      }
    });

    render(<DeviceNotificationsPage />);

    expect(await screen.findByText("测试状态：completed")).toBeInTheDocument();
    expect(screen.getByText("测试结果：已显示")).toBeInTheDocument();
  });

  it("reloads mismatched GET generations before allowing a mutation", async () => {
    let settingsGets = 0;
    let overviewGets = 0;
    const fetchMock = installFetch((url, init) => {
      if (url === "/api/device-notifications/settings" && init?.method === "PUT") {
        return json({ success: true, data: {
          generation: 10,
          settings: settings.settings,
          native: settings.native,
          lastTest: null,
        } });
      }
      if (url === "/api/device-notifications/settings") {
        settingsGets += 1;
        return json({ success: true, data: { ...settings, generation: settingsGets === 1 ? 7 : 9 } });
      }
      if (url === "/api/device-notifications") {
        overviewGets += 1;
        return json({ success: true, data: { ...overview, generation: overviewGets === 1 ? 8 : 9 } });
      }
    });

    render(<DeviceNotificationsPage />);
    fireEvent.click(await screen.findByRole("button", { name: "保存显示设置" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => (
      String(url) === "/api/device-notifications/settings" && init?.method === "PUT"
    ))).toBe(true));
    const putCall = fetchMock.mock.calls.find(([url, init]) => (
      String(url) === "/api/device-notifications/settings" && init?.method === "PUT"
    ));
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({ generation: 9 });
    expect(settingsGets).toBe(2);
    expect(overviewGets).toBe(2);
  });

  it("refreshes both snapshots and alerts after a generation conflict", async () => {
    let settingsGets = 0;
    let overviewGets = 0;
    const fetchMock = installFetch((url, init) => {
      if (url === "/api/device-notifications/settings" && init?.method === "PUT") {
        return json({ success: false, code: "DEVICE_NOTIFICATION_GENERATION_CONFLICT", error: SECRET_CANARY }, 409);
      }
      if (url === "/api/device-notifications/settings") {
        settingsGets += 1;
        return json({ success: true, data: settingsGets === 1 ? settings : {
          ...settings,
          generation: 9,
          settings: { quietHours: null, preview: "hidden" },
        } });
      }
      if (url === "/api/device-notifications") {
        overviewGets += 1;
        return json({ success: true, data: overviewGets === 1 ? overview : { ...overview, generation: 9 } });
      }
    });
    const view = render(<DeviceNotificationsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "保存显示设置" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("设置已在其他页面更新，已载入最新状态");
    await waitFor(() => expect(screen.getByLabelText("通知预览")).toHaveValue("hidden"));
    expect(settingsGets).toBe(2);
    expect(overviewGets).toBe(2);
    expect(view.container.innerHTML).not.toContain(SECRET_CANARY);
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(SECRET_CANARY);
  });

  it("renders a safe retryable alert when an API error contains a secret canary", async () => {
    let attempts = 0;
    installFetch((url) => {
      if (url === "/api/device-notifications/settings") {
        attempts += 1;
        if (attempts === 1) return json({ success: false, error: SECRET_CANARY, apiKey: SECRET_CANARY }, 500);
      }
    });
    const view = render(<DeviceNotificationsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("无法加载设备通知设置");
    expect(view.container.innerHTML).not.toContain(SECRET_CANARY);
    const retry = screen.getByRole("button", { name: "重试" });
    retry.focus();
    expect(retry).toHaveFocus();
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "设备通知" })).toBeInTheDocument();
  });
});
