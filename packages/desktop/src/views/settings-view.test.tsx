import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDesktopGatewayForTests, type DesktopGateway } from "../lib/desktop-gateway";
import { SettingsView } from "./settings-view";

function gateway() {
  return {
    getAccount: vi.fn().mockResolvedValue({
      id: "ada",
      displayName: "Ada",
      serverUrl: "https://work.example",
      connection: "connected",
      unreadCount: 0,
    }),
    getSettings: vi.fn().mockResolvedValue({
      launchAtLogin: false,
      notificationsEnabled: true,
      npmRegistry: "https://registry.npmjs.org/",
      httpProxyConfigured: true,
      httpsProxyConfigured: false,
    }),
    updateSettings: vi.fn().mockImplementation(async (input) => ({
      launchAtLogin: false,
      notificationsEnabled: true,
      npmRegistry: input.npmRegistry ?? "https://registry.npmjs.org/",
      httpProxyConfigured: Boolean(input.httpProxy),
      httpsProxyConfigured: Boolean(input.httpsProxy),
    })),
    listTrustedApps: vi.fn().mockResolvedValue([
      {
        serverOrigin: "https://work.example",
        appOwner: "alice",
        appName: "reports",
        publisherUserId: "publisher-1",
        publisherDisplayName: "Release Publisher",
        trustedAt: "2026-07-14T10:00:00Z",
      },
    ]),
    listServerProfiles: vi.fn().mockResolvedValue([]),
    saveServerProfile: vi.fn().mockResolvedValue([
      {
        name: "production",
        serverUrl: "https://work.example",
        active: false,
        loggedIn: true,
      },
    ]),
    removeServerProfile: vi.fn().mockResolvedValue([]),
    useServerProfile: vi.fn().mockResolvedValue(undefined),
    revokeAppTrust: vi.fn().mockResolvedValue(undefined),
    disconnectBus: vi.fn().mockResolvedValue(undefined),
    reconnectBus: vi.fn().mockResolvedValue(undefined),
    checkForUpdates: vi.fn().mockResolvedValue({
      available: true,
      version: "1.2.3",
      notes: "Security fixes",
    }),
    installUpdate: vi.fn().mockResolvedValue(undefined),
    clearDependencyCache: vi.fn().mockResolvedValue(undefined),
    logout: vi.fn().mockResolvedValue(undefined),
    quitApp: vi.fn().mockResolvedValue(undefined),
  } as unknown as DesktopGateway & {
    updateSettings: ReturnType<typeof vi.fn>;
    listTrustedApps: ReturnType<typeof vi.fn>;
    revokeAppTrust: ReturnType<typeof vi.fn>;
    checkForUpdates: ReturnType<typeof vi.fn>;
    installUpdate: ReturnType<typeof vi.fn>;
    clearDependencyCache: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
    quitApp: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  cleanup();
  setDesktopGatewayForTests();
});

describe("SettingsView", () => {
  it("updates registry and proxy secrets without displaying stored credentials", async () => {
    const user = userEvent.setup();
    const desktop = gateway();
    setDesktopGatewayForTests(desktop);

    render(<SettingsView />);

    expect(await screen.findByDisplayValue("https://registry.npmjs.org/")).toBeVisible();
    expect(screen.getByText("已配置 HTTP 代理")).toBeVisible();
    const httpProxy = screen.getByLabelText("HTTP 代理");
    expect(httpProxy).toHaveAttribute("type", "password");
    expect(httpProxy).toHaveValue("");
    expect(document.body).not.toHaveTextContent("proxy-secret");

    await user.clear(screen.getByLabelText("npm Registry"));
    await user.type(screen.getByLabelText("npm Registry"), "https://npm.internal.example/");
    await user.type(httpProxy, "http://user:proxy-secret@proxy.example:8080");
    await user.click(screen.getByRole("button", { name: "保存脚本环境" }));

    expect(desktop.updateSettings).toHaveBeenCalledWith({
      npmRegistry: "https://npm.internal.example/",
      httpProxy: "http://user:proxy-secret@proxy.example:8080",
    });
    expect(httpProxy).toHaveValue("");
    expect(document.body).not.toHaveTextContent("proxy-secret");
  });

  it("lists exact trusted publishers and revokes future access", async () => {
    const user = userEvent.setup();
    const desktop = gateway();
    setDesktopGatewayForTests(desktop);

    render(<SettingsView />);

    expect(await screen.findByText("alice/reports")).toBeVisible();
    expect(screen.getByText("Release Publisher")).toBeVisible();
    expect(screen.getAllByText("https://work.example")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "撤销 alice/reports 的信任" }));

    expect(desktop.revokeAppTrust).toHaveBeenCalledWith({
      serverOrigin: "https://work.example",
      appOwner: "alice",
      appName: "reports",
      publisherUserId: "publisher-1",
    });
    expect(screen.queryByText("alice/reports")).not.toBeInTheDocument();
  });

  it("checks and installs a signed desktop update through the narrow gateway", async () => {
    const user = userEvent.setup();
    const desktop = gateway();
    setDesktopGatewayForTests(desktop);

    render(<SettingsView />);
    await screen.findByDisplayValue("https://registry.npmjs.org/");
    await user.click(screen.getByRole("button", { name: "检查更新" }));

    expect(desktop.checkForUpdates).toHaveBeenCalledOnce();
    expect(screen.getByText("发现版本 1.2.3")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "安装更新" }));
    expect(desktop.installUpdate).toHaveBeenCalledOnce();
  });

  it("stores a named publish server without rendering its API key", async () => {
    const user = userEvent.setup();
    const desktop = gateway();
    setDesktopGatewayForTests(desktop);

    render(<SettingsView />);
    await screen.findByText("尚未配置发布服务器");
    await user.type(screen.getByLabelText("Profile 名称"), "production");
    await user.type(screen.getByLabelText("Profile Server URL"), "https://work.example");
    await user.type(screen.getByLabelText("Profile API Key"), "test-private-profile-key");
    await user.click(screen.getByRole("button", { name: "保存 Server" }));

    expect(desktop.saveServerProfile).toHaveBeenCalledWith({
      name: "production",
      serverUrl: "https://work.example",
      apiKey: "test-private-profile-key",
    });
    expect(await screen.findByText("production")).toBeVisible();
    expect(document.body).not.toHaveTextContent("test-private-profile-key");
    expect(screen.getByLabelText("Profile API Key")).toHaveValue("");
  });

  it("exposes narrow cache, logout, and quit maintenance actions", async () => {
    const user = userEvent.setup();
    const desktop = gateway();
    setDesktopGatewayForTests(desktop);

    render(<SettingsView />);
    await screen.findByDisplayValue("https://registry.npmjs.org/");
    await user.click(screen.getByRole("button", { name: "清除缓存" }));
    expect(desktop.clearDependencyCache).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "退出登录" }));
    expect(desktop.logout).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "退出程序" }));
    expect(desktop.quitApp).toHaveBeenCalledOnce();
  });
});
