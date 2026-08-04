import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AdminUsers from "../app/(dashboard)/my/users/page";

const usersResponse = {
  success: true,
  data: [
    {
      id: "alice",
      name: "alice",
      role: "user",
      createdAt: "2026-07-30T00:00:00.000Z",
      pages: 1,
      storageUsed: "1KB",
      mustChangePassword: false,
    },
  ],
  pagination: { page: 1, limit: 20, total: 1 },
};

const protectedUserResponse = {
  ...usersResponse,
  data: [{
    ...usersResponse.data[0],
    id: "localadmin",
    name: "localadmin",
    role: "admin",
  }],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AdminUsers one-time credentials", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.restoreAllMocks();
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  });

  it("shows newly provisioned credentials once and destroys them on close", async () => {
    const temporaryPassword = "test-password-123";
    const apiKey = "test-api-key-0123456789abcdef0123456789abcdef";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(usersResponse))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          id: "bob",
          name: "bob",
          role: "user",
          mustChangePassword: true,
          credentials: { temporaryPassword, apiKey },
        },
      }))
      .mockResolvedValueOnce(jsonResponse(usersResponse));
    vi.stubGlobal("fetch", fetchMock);
    const localStorageSet = vi.spyOn(Storage.prototype, "setItem");

    render(React.createElement(AdminUsers));
    await screen.findByRole("button", { name: "重置密码" });

    fireEvent.click(screen.getByRole("button", { name: "创建用户" }));
    fireEvent.change(screen.getByPlaceholderText("输入用户名"), {
      target: { value: "bob" },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await screen.findByRole("heading", { name: "一次性凭据" });
    expect(screen.getByText(temporaryPassword)).toBeInTheDocument();
    expect(screen.getByText(apiKey)).toBeInTheDocument();
    expect(screen.getByText(/关闭后无法再次查看/)).toBeInTheDocument();
    expect(screen.queryByText(/默认密码 localapp/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制全部" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining(temporaryPassword),
    ));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(apiKey));

    fireEvent.click(screen.getByRole("button", { name: "我已保存，关闭" }));
    expect(screen.queryByText(temporaryPassword)).not.toBeInTheDocument();
    expect(screen.queryByText(apiKey)).not.toBeInTheDocument();
    expect(localStorageSet).not.toHaveBeenCalled();
  });

  it("shows only the random password after reset", async () => {
    const temporaryPassword = "test-reset-password-987654";
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(usersResponse))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: { temporaryPassword, mustChangePassword: true },
      })));

    render(React.createElement(AdminUsers));
    await screen.findByRole("button", { name: "重置密码" });

    fireEvent.click(screen.getByRole("button", { name: "重置密码" }));
    fireEvent.click(screen.getByRole("button", { name: "确认" }));

    await screen.findByRole("heading", { name: "一次性凭据" });
    expect(screen.getByText(temporaryPassword)).toBeInTheDocument();
    expect(screen.queryByText("API Key")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制临时密码" })).toBeInTheDocument();
  });

  it("allows resetting the protected administrator while hiding destructive account actions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(protectedUserResponse)));

    render(React.createElement(AdminUsers));

    expect(await screen.findByRole("button", { name: "重置密码" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "降级为用户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument();
  });
});
