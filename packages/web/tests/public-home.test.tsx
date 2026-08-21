import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import HomePage from "../app/(dashboard)/page";

vi.mock("@/components/auth-modals/auth-provider", () => ({
  useAuthModals: () => ({ openLogin: vi.fn() }),
}));

describe("public home", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/me") {
        return new Response(JSON.stringify({ success: false }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url === "/api/home/stats") {
        return new Response(JSON.stringify({
          success: true,
          data: { users: 12, pages: 8, schemas: 16, deploys: 42, monthDeploys: 7 },
        }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        latest: "1.0.0",
        min: "1.0.0",
        versions: {
          "1.0.0": {
            platforms: {
              "macos/aarch64": "/api/cli/download?os=macos&arch=aarch64",
            },
          },
        },
      }), { headers: { "Content-Type": "application/json" } });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("presents LocalApp as an Agent application platform", async () => {
    render(<HomePage />);

    expect(await screen.findByRole("heading", { name: "让 Agent 交付真正可运行的业务应用" })).toBeInTheDocument();
    expect(screen.getByText("创建并开发")).toBeInTheDocument();
    expect(screen.getByText("检查并发布")).toBeInTheDocument();
    expect(screen.getByText("代码可控")).toBeInTheDocument();
    expect(screen.getByText("声明式后端")).toBeInTheDocument();
    expect(screen.getByText("平台能力")).toBeInTheDocument();
    expect(screen.queryByText("Agent 应用发射台")).not.toBeInTheDocument();
    expect(screen.queryByText("CDN")).not.toBeInTheDocument();
  });

  it("offers a copyable starter.md instruction for agents", async () => {
    render(<HomePage />);

    expect(await screen.findByText("交给 Agent 一句话")).toBeInTheDocument();
    const phrase = screen.getByText(/阅读 http:\/\/localhost:3000\/starter\.md 的说明创建应用/);
    expect(phrase).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "查看 starter.md 完整说明" })).toHaveAttribute("href", "/starter.md");
  });

  it("shows only valid CLI commands in the workflow", async () => {
    render(<HomePage />);

    await screen.findByRole("heading", { name: "让 Agent 交付真正可运行的业务应用" });
    fireEvent.click(screen.getByText("连接实例"));
    expect(screen.getByText("localapp login http://localhost:3000")).toBeInTheDocument();
    fireEvent.click(screen.getByText("创建并开发"));
    expect(screen.getByText("localapp init my-app")).toBeInTheDocument();
    fireEvent.click(screen.getByText("检查并发布"));
    expect(screen.getByText("localapp check && localapp app install")).toBeInTheDocument();
  });
});
