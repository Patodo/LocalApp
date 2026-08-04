import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setDesktopGatewayForTests, type DesktopGateway } from "../lib/desktop-gateway";
import { FavoritesView } from "./favorites-view";

const favorites = [
  {
    id: 1,
    storedPagePath: "test-owner/team-workload",
    appPath: "/test-owner/team-workload",
    pageName: "Team Workload",
    ownerName: "Test Owner",
    createdAt: "2026-07-14T09:30:00.000Z",
  },
  {
    id: 2,
    storedPagePath: "/localapp/issue-tracker",
    appPath: "/localapp/issue-tracker",
    pageName: "Issue Tracker",
    ownerName: "LocalApp",
    createdAt: "2026-07-13T09:30:00.000Z",
  },
];

function createGateway() {
  return {
    getAccount: vi.fn(),
    listInbox: vi.fn(),
    getUnreadCount: vi.fn(),
    markNotificationRead: vi.fn(),
    deleteNotification: vi.fn(),
    markAllRead: vi.fn(),
    listFavorites: vi.fn().mockResolvedValue(favorites),
    removeFavorite: vi.fn().mockResolvedValue(undefined),
    openApp: vi.fn().mockResolvedValue(undefined),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    openExternal: vi.fn(),
    takePendingActivations: vi.fn().mockResolvedValue([]),
    listPendingActions: vi.fn().mockResolvedValue([]),
    listRecoverableActions: vi.fn().mockResolvedValue([]),
    claimAction: vi.fn(),
    updateActionStatus: vi.fn(),
    listen: vi.fn(),
  } as unknown as DesktopGateway & {
    listFavorites: ReturnType<typeof vi.fn>;
    removeFavorite: ReturnType<typeof vi.fn>;
    openApp: ReturnType<typeof vi.fn>;
  };
}

afterEach(() => {
  cleanup();
  setDesktopGatewayForTests();
});

describe("FavoritesView", () => {
  it("opens normalized app paths and removes the original stored path", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    setDesktopGatewayForTests(gateway);

    render(<FavoritesView />);

    expect(await screen.findByText("Team Workload")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "搜索收藏" }), "workload");
    expect(screen.getByText("Team Workload")).toBeVisible();
    expect(screen.queryByText("Issue Tracker")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开 Team Workload" }));
    expect(gateway.openApp).toHaveBeenCalledWith("/test-owner/team-workload");

    await user.click(screen.getByRole("button", { name: "移除 Team Workload" }));
    expect(gateway.removeFavorite).toHaveBeenCalledWith("test-owner/team-workload");
  });

  it("removes a favorite optimistically and restores it when the request fails", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    gateway.removeFavorite.mockRejectedValueOnce(new Error("network unavailable"));
    setDesktopGatewayForTests(gateway);

    render(<FavoritesView />);

    expect(await screen.findByText("Team Workload")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "移除 Team Workload" }));

    expect(gateway.removeFavorite).toHaveBeenCalledWith("test-owner/team-workload");
    expect(await screen.findByRole("alert")).toHaveTextContent("无法移除收藏");
    expect(screen.getByText("Team Workload")).toBeVisible();
  });

  it("shows a retryable error while preserving loaded favorites", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    gateway.listFavorites
      .mockResolvedValueOnce(favorites)
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(favorites);
    setDesktopGatewayForTests(gateway);

    render(<FavoritesView />);

    expect(await screen.findByText("Team Workload")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "刷新收藏" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载收藏");
    expect(screen.getByText("Team Workload")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(gateway.listFavorites).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Team Workload")).toBeVisible();
  });

  it("shows the server maximum result set and derives an owner when ownerName is absent", async () => {
    const user = userEvent.setup();
    const gateway = createGateway();
    const manyFavorites = Array.from({ length: 51 }, (_, index) => ({
      id: index + 1,
      storedPagePath: `team/app-${index + 1}`,
      appPath: `/team/app-${index + 1}`,
      pageName: `App ${index + 1}`,
      ownerName: index === 50 ? null : "Team",
      createdAt: "2026-07-14T09:30:00.000Z",
    }));
    gateway.listFavorites.mockResolvedValueOnce(manyFavorites);
    setDesktopGatewayForTests(gateway);

    render(<FavoritesView />);

    expect(await screen.findByText("App 51")).toBeVisible();
    expect(screen.getByText("team")).toBeVisible();
    await user.type(screen.getByRole("searchbox", { name: "搜索收藏" }), "/team/app-51");
    expect(screen.getByText("App 51")).toBeVisible();
  });
});
