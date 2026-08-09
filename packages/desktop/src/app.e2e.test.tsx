import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./app";
import {
  setDesktopGatewayForTests,
  type DesktopGateway,
} from "./lib/desktop-gateway";
import type { LocalApp, LocalRuntimeSnapshot } from "./lib/types";

afterEach(() => {
  cleanup();
  setDesktopGatewayForTests();
});

it("lets a first-time user install and open a local app without a server account", async () => {
  const user = userEvent.setup();
  const installedApp: LocalApp = {
    appId: "offline-notes",
    currentVersion: "1.0.0",
    installedVersions: ["1.0.0"],
    versionRoot: "/desktop/apps/offline-notes/versions/1.0.0",
    dataRoot: "/desktop/app-data/offline-notes",
    status: "ready",
  };
  let apps: LocalApp[] = [];
  const gateway = offlineGateway();
  gateway.listLocalApps = vi.fn(async () => apps);
  gateway.installLocalApp = vi.fn(async () => {
    apps = [installedApp];
  });
  gateway.getLocalRuntimeStatus = vi.fn(async (): Promise<LocalRuntimeSnapshot> => ({
    status: apps.length === 0 ? "stopped" : "running",
    restartCount: 0,
    ready: apps.length === 0
      ? undefined
      : { host: "127.0.0.1", port: 43127, pid: 4127 },
  }));
  setDesktopGatewayForTests(gateway);

  render(<App />);

  expect(await screen.findByLabelText("本地应用为空")).toBeVisible();
  expect(screen.queryByText("未配置服务器")).not.toBeInTheDocument();
  expect(screen.queryByText("未登录")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("连接状态")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("当前账户")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "安装应用包" })).toBeEnabled();
  expect(screen.queryByText(/请先登录|登录后/)).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "安装应用包" }));

  expect(gateway.installLocalApp).toHaveBeenCalledOnce();
  expect(await screen.findByRole("heading", { name: /offline-notes/ })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "打开 offline-notes" }));
  expect(gateway.openLocalApp).toHaveBeenCalledWith("offline-notes");

  await user.click(screen.getByRole("button", { name: "设置" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "退出登录" })).toBeDisabled(),
  );
  expect(screen.getByRole("button", { name: "退出程序" })).toBeEnabled();
});

it("refreshes and displays an app-specific runtime error after opening fails", async () => {
  const user = userEvent.setup();
  let app: LocalApp = {
    appId: "broken-app",
    currentVersion: "1.0.0",
    installedVersions: ["1.0.0"],
    versionRoot: "/desktop/apps/broken-app/versions/1.0.0",
    dataRoot: "/desktop/app-data/broken-app",
    status: "unavailable",
  };
  const gateway = offlineGateway();
  gateway.listLocalApps = vi.fn(async () => [app]);
  gateway.getLocalRuntimeStatus = vi.fn().mockResolvedValue({
    status: "running",
    restartCount: 0,
  });
  gateway.openLocalApp = vi.fn(async () => {
    app = {
      ...app,
      status: "error",
      error: "Migration 002_broken.sql failed",
    };
    throw new Error("Migration 002_broken.sql failed");
  });
  setDesktopGatewayForTests(gateway);
  render(<App />);

  await user.click(await screen.findByRole("button", { name: "打开 broken-app" }));

  expect(await screen.findByText("Migration 002_broken.sql failed")).toBeVisible();
  expect(screen.getByRole("button", { name: "打开 broken-app" })).toBeDisabled();
});

function offlineGateway(): DesktopGateway {
  return {
    getAccount: vi.fn().mockResolvedValue({
      id: "",
      displayName: "未登录",
      serverUrl: "",
      connection: "offline",
      unreadCount: 0,
    }),
    listInbox: vi.fn().mockResolvedValue({ items: [] }),
    getUnreadCount: vi.fn().mockResolvedValue(0),
    markNotificationRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAllRead: vi.fn().mockResolvedValue(0),
    listFavorites: vi.fn().mockResolvedValue([]),
    addFavorite: vi.fn(),
    removeFavorite: vi.fn(),
    openApp: vi.fn(),
    getSettings: vi.fn().mockResolvedValue({
      launchAtLogin: false,
      notificationsEnabled: true,
    }),
    updateSettings: vi.fn(),
    checkForUpdates: vi.fn().mockResolvedValue({ available: false }),
    installUpdate: vi.fn(),
    clearDependencyCache: vi.fn(),
    logout: vi.fn(),
    quitApp: vi.fn(),
    listTrustedApps: vi.fn().mockResolvedValue([]),
    revokeAppTrust: vi.fn(),
    disconnectBus: vi.fn(),
    reconnectBus: vi.fn(),
    openExternal: vi.fn(),
    openNotification: vi.fn(),
    takePendingActivations: vi.fn().mockResolvedValue([]),
    listPendingActions: vi.fn().mockResolvedValue([]),
    listRecoverableActions: vi.fn().mockResolvedValue([]),
    listLocalTasks: vi.fn().mockResolvedValue([]),
    readLocalTaskLogs: vi.fn().mockResolvedValue({
      stdout: "",
      stderr: "",
      stdoutTruncated: false,
      stderrTruncated: false,
    }),
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
