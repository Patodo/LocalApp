import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App, preferTask } from "./app";
import { setDesktopGatewayForTests, type DesktopGateway } from "./lib/desktop-gateway";
import type { DesktopEvent, LocalTask } from "./lib/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createGateway(): DesktopGateway {
  return {
    getAccount: vi.fn().mockResolvedValue({
      id: "u1",
      displayName: "Ada",
      serverUrl: "https://work.example",
      connection: "offline",
      unreadCount: 0,
    }),
    listInbox: vi.fn().mockResolvedValue({ items: [] }),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    markNotificationRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAllRead: vi.fn(),
    listFavorites: vi.fn().mockResolvedValue([]),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    openApp: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({ available: false }),
    installUpdate: vi.fn(),
    clearDependencyCache: vi.fn(),
    logout: vi.fn(),
    quitApp: vi.fn(),
    listTrustedApps: vi.fn().mockResolvedValue([]),
    revokeAppTrust: vi.fn(),
    disconnectBus: vi.fn().mockResolvedValue(undefined),
    reconnectBus: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn(),
    openNotification: vi.fn(),
    takePendingActivations: vi.fn().mockResolvedValue([]),
    listPendingActions: vi.fn().mockResolvedValue([]),
    listRecoverableActions: vi.fn().mockResolvedValue([]),
    listLocalTasks: vi.fn().mockResolvedValue([]),
    readLocalTaskLogs: vi.fn().mockResolvedValue({ stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false }),
    claimAction: vi.fn(),
    trustAndRunTask: vi.fn(),
    rejectLocalTask: vi.fn(),
    cancelLocalTask: vi.fn(),
    setLocalTaskPinned: vi.fn(),
    listLocalApps: vi.fn().mockResolvedValue([]),
    getLocalRuntimeStatus: vi.fn().mockResolvedValue({
      status: "stopped",
      restartCount: 0,
    }),
    installLocalApp: vi.fn(),
    openLocalApp: vi.fn(),
    uninstallLocalApp: vi.fn(),
    deleteLocalApp: vi.fn(),
    listServerProfiles: vi.fn().mockResolvedValue([]),
    saveServerProfile: vi.fn(),
    removeServerProfile: vi.fn(),
    useServerProfile: vi.fn(),
    publishLocalApp: vi.fn(),
    createStudioProject: vi.fn(),
    listStudioProjects: vi.fn().mockResolvedValue([]),
    readStudioFile: vi.fn(),
    writeStudioFile: vi.fn(),
    listStudioDir: vi.fn().mockResolvedValue([]),
    deleteStudioProject: vi.fn(),
    buildStudioProject: vi.fn(),
    installStudioProject: vi.fn(),
    publishStudioProject: vi.fn(),
    reloadStudioProject: vi.fn(),
    runStudioAgent: vi.fn(),
    sendStudioMessage: vi.fn(),
    listAvailableAgents: vi.fn().mockResolvedValue([]),
    cancelStudioAgent: vi.fn(),
    listStudioAgents: vi.fn().mockResolvedValue([]),
    readStudioAgentLogs: vi.fn().mockResolvedValue({ sessionId: "", stdout: "", stderr: "" }),
    listen: vi.fn().mockResolvedValue(() => undefined),
  };
}

function claimedAction(status: LocalTask["status"] = "awaiting_trust"): LocalTask {
  return {
    id: "550e8400-e29b-41d4-a716-446655440000",
    serverOrigin: "https://work.example",
    appOwner: "alice",
    appName: "reports",
    appVersion: "7",
    publisherUserId: "publisher-1",
    publisherDisplayName: "Release Publisher",
    title: "Generate report",
    description: "Build the workbook",
    script: "return input.month",
    dependencies: { zod: "3.23.8" },
    input: { month: "2026-07" },
    timeoutSeconds: 45,
    status,
    workingDirectory: "C:\\Users\\Ada\\AppData\\Local\\LocalApp\\tasks\\550e8400-e29b-41d4-a716-446655440000\\work",
    pinned: false,
    createdAt: 1_784_024_000_000,
    updatedAt: 1_784_024_001_000,
  };
}

afterEach(() => {
  cleanup();
  setDesktopGatewayForTests();
});

it("never lets an older command response overwrite a newer terminal event", () => {
  const preparing = claimedAction("preparing");
  const succeeded = {
    ...preparing,
    status: "succeeded" as const,
    updatedAt: preparing.updatedAt + 2,
    result: { ok: true },
  };
  expect(preferTask(succeeded, preparing)).toBe(succeeded);
  expect(preferTask(preparing, succeeded)).toBe(succeeded);
});

it("loads and updates desktop settings and controls the bus lifecycle", async () => {
  const user = userEvent.setup();
  const gateway = createGateway();
  gateway.getAccount = vi.fn().mockResolvedValue({
    id: "u1",
    displayName: "Ada",
    serverUrl: "https://work.example",
    connection: "connected",
    unreadCount: 0,
  });
  gateway.getSettings = vi.fn().mockResolvedValue({
    launchAtLogin: false,
    notificationsEnabled: true,
  });
  gateway.updateSettings = vi.fn().mockImplementation(async (input) => ({
    launchAtLogin: input.launchAtLogin ?? false,
    notificationsEnabled: input.notificationsEnabled ?? true,
  }));
  setDesktopGatewayForTests(gateway);

  render(<App />);
  await user.click(screen.getByRole("button", { name: "设置" }));

  const notifications = await screen.findByRole("switch", { name: "系统通知" });
  const autostart = screen.getByRole("switch", { name: "登录时启动" });
  expect(notifications).toBeChecked();
  expect(autostart).not.toBeChecked();

  await user.click(notifications);
  expect(gateway.updateSettings).toHaveBeenCalledWith({ notificationsEnabled: false });
  await user.click(autostart);
  expect(gateway.updateSettings).toHaveBeenCalledWith({ launchAtLogin: true });

  await user.click(screen.getByRole("tab", { name: "服务器" }));
  await user.click(screen.getByRole("button", { name: "断开连接" }));
  expect(gateway.disconnectBus).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "重新连接" }));
  expect(gateway.reconnectBus).toHaveBeenCalledOnce();
});

describe("App navigation", () => {
  it("keeps the desktop shell focused on the main views", async () => {
    const user = userEvent.setup();

    render(<App />);

    await screen.findByLabelText("本地应用为空");

    const desktopNavigation = within(screen.getByRole("navigation", { name: "桌面功能" }));
    expect(desktopNavigation.getAllByRole("button")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "应用" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByText("应用浏览器")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收藏" }));

    expect(screen.getByRole("heading", { name: "收藏" })).toBeVisible();
    expect(await screen.findByLabelText("收藏为空")).toBeVisible();
    expect(screen.getByRole("button", { name: "收藏" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "应用" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps connection, account, and settings at the bottom of the sidebar", async () => {
    setDesktopGatewayForTests(createGateway());
    render(<App />);

    await screen.findByLabelText("本地应用为空");
    const settings = screen.getByRole("button", { name: "设置" });
    const connection = await screen.findByLabelText("连接状态");
    const account = screen.getByLabelText("当前账户");

    expect(connection.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(account.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

it("keeps a newer connection event when the initial account request resolves late", async () => {
  const account = deferred<Awaited<ReturnType<DesktopGateway["getAccount"]>>>();
  let eventHandler: ((event: DesktopEvent) => void) | undefined;
  const gateway = createGateway();
  gateway.getAccount = vi.fn().mockReturnValue(account.promise);
  gateway.listen = vi.fn().mockImplementation(async (handler) => {
    eventHandler = handler;
    return () => undefined;
  });
  setDesktopGatewayForTests(gateway);

  render(<App />);

  await act(async () => {
    await Promise.resolve();
  });
  act(() => eventHandler?.({ type: "connection:changed", status: "connected" }));
  // account 尚未加载，连接状态区块暂不渲染；等 account 到达后按最新 connection 显示。
  expect(screen.queryByText("已连接")).not.toBeInTheDocument();

  await act(async () => {
    account.resolve({
      id: "u1",
      displayName: "Ada",
      serverUrl: "https://work.example",
      connection: "offline",
      unreadCount: 0,
    });
    await account.promise;
  });

  expect(screen.getByText("已连接")).toBeVisible();
  expect(screen.queryByText("未连接")).not.toBeInTheDocument();
  expect(screen.getByText("Ada")).toBeVisible();
  expect(screen.getByText("https://work.example")).toBeVisible();
});

it("shows server, account, and live unread count in the top bar", async () => {
  let eventHandler: ((event: DesktopEvent) => void) | undefined;
  const gateway = createGateway();
  gateway.getUnreadCount = vi.fn().mockResolvedValue(4);
  gateway.listen = vi.fn().mockImplementation(async (handler) => {
    eventHandler = handler;
    return () => undefined;
  });
  setDesktopGatewayForTests(gateway);

  render(<App />);

  expect(await screen.findByText("https://work.example")).toBeVisible();
  expect(screen.getByText("Ada")).toBeVisible();
  expect(screen.getByLabelText("4 条未读消息")).toBeVisible();

  act(() => eventHandler?.({ type: "inbox:updated", unreadCount: 2 }));
  expect(screen.getByLabelText("2 条未读消息")).toBeVisible();
});

it("keeps a live unread event when the initial unread request resolves late", async () => {
  const unread = deferred<number>();
  let eventHandler: ((event: DesktopEvent) => void) | undefined;
  const gateway = createGateway();
  gateway.getUnreadCount = vi.fn().mockReturnValue(unread.promise);
  gateway.listen = vi.fn().mockImplementation(async (handler) => {
    eventHandler = handler;
    return () => undefined;
  });
  setDesktopGatewayForTests(gateway);

  render(<App />);
  await act(async () => Promise.resolve());
  act(() => eventHandler?.({ type: "inbox:updated", unreadCount: 7 }));
  expect(screen.getByLabelText("7 条未读消息")).toBeVisible();

  await act(async () => {
    unread.resolve(1);
    await unread.promise;
  });
  expect(screen.getByLabelText("7 条未读消息")).toBeVisible();
});

it("shows a persisted task and only trusts it after explicit confirmation", async () => {
  const user = userEvent.setup();
  const gateway = createGateway();
  gateway.takePendingActivations = vi.fn().mockResolvedValue([
    { requestId: "550e8400-e29b-41d4-a716-446655440000", nonce: "claim_nonce" },
  ]);
  gateway.claimAction = vi.fn().mockResolvedValue(claimedAction());
  gateway.trustAndRunTask = vi.fn().mockResolvedValue(
    claimedAction("preparing"),
  );
  gateway.rejectLocalTask = vi.fn().mockResolvedValue(
    claimedAction("cancelled"),
  );
  setDesktopGatewayForTests(gateway);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Generate report" })).toBeVisible();
  expect(screen.getAllByText("等待信任确认")).toHaveLength(2);
  expect(screen.getByText("https://work.example/alice/reports")).toBeVisible();
  expect(screen.getByText("Release Publisher")).toBeVisible();
  expect(screen.getByText("return input.month")).toBeVisible();
  expect(screen.queryByText("zod@3.23.8")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "依赖 (1)" }));
  expect(screen.getByText("zod@3.23.8")).toBeVisible();
  expect(screen.getByText(/当前用户的完整权限/)).toBeVisible();
  expect(screen.getByText(/45 秒/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "信任并运行" }));
  expect(gateway.trustAndRunTask).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "确认信任并运行" }));
  expect(gateway.trustAndRunTask).toHaveBeenCalledWith(
    "550e8400-e29b-41d4-a716-446655440000",
  );

});

it("loads local task history even while the platform is offline", async () => {
  const gateway = createGateway();
  gateway.listLocalTasks = vi.fn().mockResolvedValue([
    { ...claimedAction("succeeded"), title: "Stored offline result", result: { ok: true } },
  ]);
  gateway.listRecoverableActions = vi.fn().mockRejectedValue(new Error("offline"));
  gateway.listPendingActions = vi.fn().mockRejectedValue(new Error("offline"));
  setDesktopGatewayForTests(gateway);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Stored offline result" })).toBeVisible();
  expect(screen.getByText(/"ok": true/)).toBeVisible();
  expect(gateway.claimAction).not.toHaveBeenCalled();
});

it("renders a recovered task that Rust persisted before advancing status", async () => {
  const gateway = createGateway();
  gateway.listRecoverableActions = vi.fn().mockResolvedValue([claimedAction()]);
  setDesktopGatewayForTests(gateway);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Generate report" })).toBeVisible();
  expect(gateway.claimAction).not.toHaveBeenCalled();
});

it("recovers a crash after awaiting trust without claiming or reposting status", async () => {
  const gateway = createGateway();
  gateway.listRecoverableActions = vi.fn().mockResolvedValue([
    claimedAction("awaiting_trust"),
  ]);
  setDesktopGatewayForTests(gateway);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Generate report" })).toBeVisible();
  expect(screen.getAllByText("等待信任确认")).toHaveLength(2);
  expect(gateway.claimAction).not.toHaveBeenCalled();
});

it("retries a transient claim failure on reconnect and completes a successful claim once", async () => {
  let eventHandler: ((event: DesktopEvent) => void) | undefined;
  const action = claimedAction("claimed");
  const pending = {
    id: action.id,
    nonce: "claim_nonce",
    serverOrigin: action.serverOrigin,
    appOwner: action.appOwner,
    appName: action.appName,
    appVersion: action.appVersion,
    publisherUserId: action.publisherUserId,
    publisherDisplayName: action.publisherDisplayName,
    title: action.title,
    description: action.description,
    createdAt: "2026-07-14T10:00:00Z",
    expiresAt: "2026-07-14T10:10:00Z",
  };
  const gateway = createGateway();
  gateway.listRecoverableActions = vi.fn().mockResolvedValue([]);
  gateway.listen = vi.fn().mockImplementation(async (handler) => {
    eventHandler = handler;
    return () => undefined;
  });
  gateway.listPendingActions = vi.fn().mockResolvedValue([pending]);
  gateway.claimAction = vi.fn()
    .mockRejectedValueOnce(new Error("temporary outage"))
    .mockResolvedValue(action);
  setDesktopGatewayForTests(gateway);

  render(<App />);
  await waitFor(() => expect(gateway.claimAction).toHaveBeenCalledTimes(1));

  act(() => eventHandler?.({ type: "connection:changed", status: "connected" }));

  expect(await screen.findByRole("heading", { name: "Generate report" })).toBeVisible();
  await waitFor(() => expect(gateway.claimAction).toHaveBeenCalledTimes(2));

  act(() => eventHandler?.({ type: "action:activation" }));
  await act(async () => Promise.resolve());
  expect(gateway.claimAction).toHaveBeenCalledTimes(2);
});

it("still claims pending work when recoverable reconciliation fails", async () => {
  const gateway = createGateway();
  const action = claimedAction("claimed");
  gateway.listRecoverableActions = vi.fn().mockRejectedValue(new Error("temporary outage"));
  gateway.listPendingActions = vi.fn().mockResolvedValue([
    {
      id: action.id,
      nonce: "claim_nonce",
      serverOrigin: action.serverOrigin,
      appOwner: action.appOwner,
      appName: action.appName,
      appVersion: action.appVersion,
      publisherUserId: action.publisherUserId,
      publisherDisplayName: action.publisherDisplayName,
      title: action.title,
      description: action.description,
      createdAt: "2026-07-14T10:00:00Z",
      expiresAt: "2026-07-14T10:10:00Z",
    },
  ]);
  gateway.claimAction = vi.fn().mockResolvedValue(action);
  setDesktopGatewayForTests(gateway);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Generate report" })).toBeVisible();
  expect(gateway.claimAction).toHaveBeenCalledOnce();
});

it("claims an activation once across pending, event, and StrictMode startup races", async () => {
  let eventHandler: ((event: DesktopEvent) => void) | undefined;
  const activation = {
    requestId: "550e8400-e29b-41d4-a716-446655440000",
    nonce: "claim_nonce",
  };
  const gateway = createGateway();
  gateway.listen = vi.fn().mockImplementation(async (handler) => {
    eventHandler = handler;
    return () => undefined;
  });
  gateway.takePendingActivations = vi.fn().mockResolvedValue([activation]);
  gateway.listPendingActions = vi.fn().mockResolvedValue([
    {
      id: activation.requestId,
      nonce: activation.nonce,
      serverOrigin: "https://work.example",
      appOwner: "alice",
      appName: "reports",
      appVersion: "7",
      publisherUserId: "publisher-1",
      publisherDisplayName: "Release Publisher",
      title: "Generate report",
      description: null,
      createdAt: "2026-07-14T10:00:00Z",
      expiresAt: "2026-07-14T10:10:00Z",
    },
  ]);
  gateway.claimAction = vi.fn().mockResolvedValue({
    id: activation.requestId,
    serverOrigin: "https://work.example",
    appOwner: "alice",
    appName: "reports",
    appVersion: "7",
    publisherUserId: "publisher-1",
    publisherDisplayName: "Release Publisher",
    title: "Generate report",
    description: null,
    script: "return 1",
    dependencies: {},
    input: null,
    timeoutSeconds: 30,
    status: "claimed",
  });
  setDesktopGatewayForTests(gateway);

  render(<StrictMode><App /></StrictMode>);
  await act(async () => {
    eventHandler?.({ type: "action:activation" });
    await Promise.resolve();
  });

  await waitFor(() => expect(gateway.claimAction).toHaveBeenCalledOnce());
  expect(gateway.claimAction).toHaveBeenCalledWith(activation);
});
