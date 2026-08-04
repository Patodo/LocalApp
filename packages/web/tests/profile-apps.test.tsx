import { render, screen } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfileApps from "../app/(dashboard)/my/apps/page";

describe("ProfileApps", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: [
        { userId: "owner", name: "online-app", currentVersion: 2, updatedAt: "2026-07-20T00:00:00.000Z", lifecycleStatus: "online" },
        { userId: "owner", name: "offline-app", currentVersion: 3, updatedAt: "2026-07-20T01:00:00.000Z", lifecycleStatus: "offline" },
      ],
    }))));
  });

  it("shows lifecycle status and links offline apps to their shell status page", async () => {
    render(React.createElement(ProfileApps));

    await screen.findByRole("heading", { name: "我的应用" });
    expect(screen.getByText("已上线")).toBeInTheDocument();
    expect(screen.getByText("已下线")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开 online-app" })).toHaveAttribute("href", "/owner/online-app");
    expect(screen.getByRole("link", { name: "查看 offline-app 下线页" })).toHaveAttribute("href", "/owner/offline-app");
    expect(screen.getByRole("link", { name: "online-app 设置" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "offline-app 设置" })).toBeInTheDocument();
  });
});
