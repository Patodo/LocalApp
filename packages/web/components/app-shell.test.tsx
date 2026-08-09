import { render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppShell from "./app-shell";

vi.mock("next/navigation", () => ({
  usePathname: () => "/my/info",
}));

vi.mock("@/components/auth-modals/auth-provider", () => ({
  useAuthModals: () => ({ openLogin: vi.fn() }),
}));

describe("AppShell dashboard content width", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { id: "u1", name: "test-owner", role: "user" },
    }), { headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a 1600px shared content cap while preserving responsive padding", async () => {
    render(<AppShell><div data-testid="dashboard-content">内容</div></AppShell>);

    const content = await screen.findByTestId("dashboard-content");
    expect(content.parentElement).toHaveClass("mx-auto", "max-w-[1600px]", "p-4", "md:p-6");
    expect(content.parentElement).not.toHaveClass("max-w-7xl");
  });
});

describe("AppShell control-plane navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      success: true,
      data: { id: "admin", name: "admin", role: "admin" },
    }), { headers: { "Content-Type": "application/json" } })));
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: false,
      media: "(max-width: 1023px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows Studio, tasks, and system administration in the Web shell", async () => {
    render(<AppShell><div>content</div></AppShell>);

    expect(await screen.findByRole("link", { name: "Studio" })).toHaveAttribute("href", "/my/studio");
    expect(screen.getByRole("link", { name: "任务" })).toHaveAttribute("href", "/my/tasks");
    expect(screen.getByRole("link", { name: "系统设置" })).toHaveAttribute("href", "/my/system");
  });
});
