import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SystemPage } from "./system-page";

describe("SystemPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/system/settings/network" && options?.method === "PUT") {
        return new Response(JSON.stringify({ success: true, data: { restarting: true } }), { status: 202 });
      }
      return new Response(JSON.stringify({ success: true, data: {
        listenHost: "127.0.0.1", listenPort: 3000, publicUrl: "", workspaceDir: "workspaces", allowInsecureLan: false,
      } }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("requests an administrator network setting change with credentials", async () => {
    render(<SystemPage />);
    await screen.findByLabelText("监听端口");
    fireEvent.change(screen.getByLabelText("监听主机"), { target: { value: "0.0.0.0" } });
    fireEvent.change(screen.getByLabelText("监听端口"), { target: { value: "43127" } });
    fireEvent.click(screen.getByLabelText("允许不安全的局域网访问"));
    fireEvent.click(screen.getByRole("button", { name: "保存并重启" }));

    await waitFor(() => expect(screen.getByText("已请求重启以应用网络设置")).toBeInTheDocument());
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/system/settings/network", expect.objectContaining({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ listenHost: "0.0.0.0", listenPort: 43127, allowInsecureLan: true }),
    }));
  });
});
