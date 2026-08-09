import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { StrictMode } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDesktopGatewayForTests, type DesktopGateway } from "../lib/desktop-gateway";
import type { DesktopEvent } from "../lib/types";
import { MessagesView } from "./messages-view";

const firstPage = {
  items: [
    {
      id: "n1",
      appOwner: "localapp",
      appName: "builder",
      title: "构建完成",
      body: "生产构建已发布。",
      url: "/apps/localapp/builder?from=notification#result",
      createdAt: "2026-07-14T09:30:00.000Z",
      read: false,
    },
    {
      id: "n2",
      appOwner: "localapp",
      appName: "issues",
      title: "新评论",
      createdAt: "2026-07-13T09:30:00.000Z",
      read: true,
    },
  ],
  nextCursor: "page-2",
};

function createGateway(): DesktopGateway {
  return {
    getAccount: vi.fn(),
    listInbox: vi.fn().mockResolvedValue(firstPage),
    getUnreadCount: vi.fn().mockResolvedValue(1),
    markNotificationRead: vi.fn().mockResolvedValue(undefined),
    deleteNotification: vi.fn().mockResolvedValue(undefined),
    markAllRead: vi.fn().mockResolvedValue(1),
    listFavorites: vi.fn(),
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
    disconnectBus: vi.fn(),
    reconnectBus: vi.fn(),
    openExternal: vi.fn().mockResolvedValue(undefined),
    openNotification: vi.fn().mockImplementation(async (notificationId) => ({
      ...firstPage.items[0],
      id: notificationId,
      read: true,
    })),
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  setDesktopGatewayForTests();
});

describe("MessagesView", () => {
  it("marks all messages read, deletes an item, and opens its validated link", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "标记全部已读" }));
    expect(gateway.markAllRead).toHaveBeenCalledOnce();
    expect(screen.getByText("构建完成")).not.toHaveClass("is-unread");

    await user.click(screen.getByRole("button", { name: "打开 构建完成" }));
    expect(gateway.openNotification).toHaveBeenCalledWith(
      "n1",
      "/apps/localapp/builder?from=notification#result",
    );

    await user.click(screen.getByRole("button", { name: "删除 构建完成" }));
    expect(gateway.deleteNotification).toHaveBeenCalledWith("n1");
    expect(screen.queryByText("构建完成")).not.toBeInTheDocument();
  });

  it("filters messages from the application source column instead of a dropdown", async () => {
    const user = userEvent.setup();
    setDesktopGatewayForTests(createGateway());

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    expect(screen.getByLabelText("应用消息源")).toBeVisible();
    expect(screen.queryByRole("combobox", { name: "来源应用" })).not.toBeInTheDocument();
    const sourceHeader = screen.getByRole("heading", { name: "消息" }).closest<HTMLElement>("header");
    expect(sourceHeader).not.toBeNull();
    expect(within(sourceHeader!).getByText("2 条消息")).toBeVisible();
    const mainHeader = screen.getByRole("heading", { name: "全部消息" }).closest<HTMLElement>(".messages-heading");
    expect(mainHeader).not.toBeNull();
    expect(within(mainHeader!).getByRole("button", { name: "全部" })).toBeVisible();
    expect(within(mainHeader!).getByRole("button", { name: "未读" })).toBeVisible();
    expect(screen.queryByText("来自 LocalApp 应用的重要更新。")).not.toBeInTheDocument();
    expect(document.querySelector(".messages-toolbar")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /localapp\/issues/ }));
    expect(screen.getByText("新评论")).toBeVisible();
    expect(screen.queryByText("构建完成")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "未读" }));
    expect(screen.getByText("没有符合当前筛选的消息")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /localapp\/builder/ }));
    expect(screen.getByText("构建完成")).toBeVisible();
    expect(screen.queryByText("新评论")).not.toBeInTheDocument();
  });

  it("keeps loaded messages visible when a refresh fails and retries without clearing them", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    gateway.listInbox = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(firstPage);
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新通知" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载消息");
    expect(screen.getByText("构建完成")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(gateway.listInbox).toHaveBeenCalledTimes(3);
    expect(screen.getByText("构建完成")).toBeVisible();
  });

  it("loads the next page without replacing existing messages", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    gateway.listInbox = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({
        items: [
          {
            id: "n3",
            appOwner: "localapp",
            appName: "builder",
            title: "部署开始",
            createdAt: "2026-07-12T09:30:00.000Z",
            read: false,
          },
        ],
      });
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(gateway.listInbox).toHaveBeenLastCalledWith({ cursor: "page-2", unreadOnly: false });
    expect(await screen.findByText("部署开始")).toBeVisible();
    expect(screen.getByText("构建完成")).toBeVisible();
  });

  it("retries a failed next page with its original cursor and preserves earlier pages", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    gateway.listInbox = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockResolvedValueOnce({
        items: [{ ...firstPage.items[0], id: "n3", title: "第二页" }],
        nextCursor: "page-3",
      })
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValueOnce({
        items: [{ ...firstPage.items[0], id: "n4", title: "第三页" }],
      });
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("第二页")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载消息");

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(gateway.listInbox).toHaveBeenLastCalledWith({ cursor: "page-3", unreadOnly: false });
    expect(await screen.findByText("第三页")).toBeVisible();
    expect(screen.getByText("构建完成")).toBeVisible();
    expect(screen.getByText("第二页")).toBeVisible();
  });

  it("loads unread pages from the server and resets the current page when mode changes", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    gateway.listInbox = vi
      .fn()
      .mockResolvedValueOnce({
        items: [{ ...firstPage.items[1], id: "read-page-one", title: "第一页已读", read: true }],
        nextCursor: "all-page-2",
      })
      .mockResolvedValueOnce({
        items: [{ ...firstPage.items[0], id: "unread-page-one", title: "后页未读" }],
        nextCursor: "unread-page-2",
      })
      .mockResolvedValueOnce({
        items: [{ ...firstPage.items[0], id: "unread-page-two", title: "更多未读" }],
      });
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("第一页已读")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "未读" }));
    expect(gateway.listInbox).toHaveBeenLastCalledWith({ unreadOnly: true });
    expect(await screen.findByText("后页未读")).toBeVisible();
    expect(screen.queryByText("第一页已读")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(gateway.listInbox).toHaveBeenLastCalledWith({ cursor: "unread-page-2", unreadOnly: true });
    expect(await screen.findByText("更多未读")).toBeVisible();
  });

  it("disables load-more while a refresh is pending", async () => {
    const user = userEvent.setup();
    const refresh = deferred<typeof firstPage>();
    const gateway = createGateway();
    gateway.listInbox = vi.fn().mockResolvedValueOnce(firstPage).mockReturnValueOnce(refresh.promise);
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新通知" }));
    expect(screen.getByRole("button", { name: "加载更多" })).toBeDisabled();
    refresh.resolve(firstPage);
    expect(await screen.findByText("构建完成")).toBeVisible();
  });

  it("does not restore a deleted message when an older refresh resolves afterwards", async () => {
    const user = userEvent.setup();
    const refresh = deferred<typeof firstPage>();
    const gateway = createGateway();
    gateway.listInbox = vi.fn().mockResolvedValueOnce(firstPage).mockReturnValueOnce(refresh.promise);
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新通知" }));
    await user.click(screen.getByRole("button", { name: "删除 构建完成" }));
    expect(screen.queryByText("构建完成")).not.toBeInTheDocument();
    refresh.resolve(firstPage);
    await Promise.resolve();
    expect(screen.queryByText("构建完成")).not.toBeInTheDocument();
  });

  it("does not restore unread state when mark-all succeeds before an older refresh", async () => {
    const user = userEvent.setup();
    const refresh = deferred<typeof firstPage>();
    const gateway = createGateway();
    gateway.listInbox = vi.fn().mockResolvedValueOnce(firstPage).mockReturnValueOnce(refresh.promise);
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新通知" }));
    await user.click(screen.getByRole("button", { name: "标记全部已读" }));
    expect(screen.getByText("构建完成")).not.toHaveClass("is-unread");
    refresh.resolve(firstPage);
    await Promise.resolve();
    expect(screen.getByText("构建完成")).not.toHaveClass("is-unread");
  });

  it("keeps the newest reconciliation when notification refreshes resolve out of order", async () => {
    const olderRefresh = deferred<typeof firstPage>();
    const newerPage = {
      items: [{ ...firstPage.items[0], id: "n-new", title: "最新通知" }],
    };
    const newerRefresh = deferred<typeof newerPage>();
    let eventHandler: ((event: DesktopEvent) => void) | undefined;
    const gateway = createGateway();
    gateway.listInbox = vi
      .fn()
      .mockResolvedValueOnce(firstPage)
      .mockReturnValueOnce(olderRefresh.promise)
      .mockReturnValueOnce(newerRefresh.promise);
    gateway.listen = vi.fn().mockImplementation(async (handler) => {
      eventHandler = handler;
      return () => undefined;
    });
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("构建完成")).toBeVisible();
    act(() => {
      eventHandler?.({
        type: "notification:received",
        notification: { ...firstPage.items[0], id: "n-live" },
      });
      eventHandler?.({ type: "inbox:missed", count: 2 });
    });
    await act(async () => {
      newerRefresh.resolve(newerPage);
      await newerRefresh.promise;
    });
    expect(await screen.findByText("最新通知")).toBeVisible();

    await act(async () => {
      olderRefresh.resolve(firstPage);
      await olderRefresh.promise;
    });
    expect(screen.getByText("最新通知")).toBeVisible();
    expect(screen.queryByText("构建完成")).not.toBeInTheDocument();
  });

  it("registers before initial reconciliation and includes an event emitted during registration", async () => {
    const callOrder: string[] = [];
    const livePage = {
      items: [{ ...firstPage.items[0], id: "n-during-registration", title: "注册期间通知" }],
    };
    const gateway = createGateway();
    gateway.listen = vi.fn().mockImplementation(async (handler) => {
      callOrder.push("listen");
      handler({
        type: "notification:received",
        notification: { ...firstPage.items[0], id: "n-during-registration" },
      });
      return () => undefined;
    });
    gateway.listInbox = vi.fn().mockImplementation(async () => {
      callOrder.push("list");
      return livePage;
    });
    setDesktopGatewayForTests(gateway);

    render(<MessagesView />);

    expect(await screen.findByText("注册期间通知")).toBeVisible();
    expect(callOrder[0]).toBe("listen");
  });

  it("releases every listener registration under StrictMode", async () => {
    const unlisten = vi.fn();
    const gateway = createGateway();
    const listen = vi.fn().mockResolvedValue(unlisten);
    gateway.listen = listen;
    setDesktopGatewayForTests(gateway);

    const rendered = render(
      <StrictMode>
        <MessagesView />
      </StrictMode>,
    );
    expect(await screen.findByText("构建完成")).toBeVisible();

    rendered.unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(unlisten).toHaveBeenCalledTimes(listen.mock.calls.length);
  });
});
