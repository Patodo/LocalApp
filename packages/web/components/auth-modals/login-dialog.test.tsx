import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoginDialog } from "./login-dialog";
import { resolveAuthReturnTo } from "./auth-return";

const authState = vi.hoisted(() => ({
  loginOpen: true,
  loginReturnTo: "/test-owner/outer-ai-usage/?tab=records#latest" as string | null,
  closeLogin: vi.fn(),
  openChangePassword: vi.fn(),
  setPendingOldPassword: vi.fn(),
}));

vi.mock("./auth-provider", () => ({ useAuthModals: () => authState }));

describe("LoginDialog return target", () => {
  const originalLocation = window.location;

  afterEach(() => {
    vi.restoreAllMocks();
    authState.loginReturnTo = "/test-owner/outer-ai-usage/?tab=records#latest";
    delete (window as any).location;
    (window as any).location = originalLocation;
  });

  it("returns to the blocked application after login", async () => {
    const mockLocation = { href: "http://localhost/test-owner/outer-ai-usage/", origin: "http://localhost" };
    delete (window as any).location;
    (window as any).location = mockLocation;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      headers: { "Content-Type": "application/json" },
    })));

    render(<LoginDialog />);
    fireEvent.change(screen.getByLabelText("用户名或邮箱"), { target: { value: "test-owner" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "123456" } });
    fireEvent.submit(screen.getByRole("button", { name: "登录" }).closest("form")!);

    await waitFor(() => expect(mockLocation.href).toBe("/test-owner/outer-ai-usage/?tab=records#latest"));
  });

  it("rejects cross-origin return targets", () => {
    expect(resolveAuthReturnTo("https://evil.example/steal-session")).toBe("/");
  });
});
