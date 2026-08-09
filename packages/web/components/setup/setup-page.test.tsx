import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SetupPage } from "./setup-page";

describe("SetupPage", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/setup?token=one-time-token");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });

  it("initializes the first administrator with an in-memory token and removes it from history", async () => {
    render(<SetupPage />);

    expect(window.location.search).toBe("");
    fireEvent.change(screen.getByLabelText("管理员用户名"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("管理员密码"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: "初始化 LocalApp" }));

    await waitFor(() => expect(screen.getByText(/初始化完成/)).toBeInTheDocument());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/setup/initialize", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({ token: "one-time-token", username: "owner", password: "correct-horse-battery" }),
    }));
  });

  it("retains the initial token when React development strict mode rerenders the page", async () => {
    render(<React.StrictMode><SetupPage /></React.StrictMode>);

    fireEvent.change(screen.getByLabelText("管理员用户名"), { target: { value: "owner" } });
    fireEvent.change(screen.getByLabelText("管理员密码"), { target: { value: "correct-horse-battery" } });
    fireEvent.click(screen.getByRole("button", { name: "初始化 LocalApp" }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/setup/initialize", expect.objectContaining({
      body: JSON.stringify({ token: "one-time-token", username: "owner", password: "correct-horse-battery" }),
    })));
  });
});
