import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeersPage } from "./peers-page";

describe("PeersPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/peers" && options?.method === "POST") {
        return new Response(JSON.stringify({ success: true, data: { id: "peer-1", name: "office", baseUrl: "https://office.example", verifiedAt: null } }), { status: 201 });
      }
      return new Response(JSON.stringify({ success: true, data: [] }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("submits a credential once, clears it in finally, and renders only public peer metadata", async () => {
    render(<PeersPage />);
    const apiKey = await screen.findByLabelText("目标 API Key");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("目标地址"), { target: { value: "https://office.example" } });
    fireEvent.change(apiKey, { target: { value: "peer-api-key-that-must-not-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "添加对端" }));

    await waitFor(() => expect(apiKey).toHaveValue(""));
    expect(await screen.findByText("office")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("peer-api-key-that-must-not-leak")).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/peers", expect.objectContaining({
      method: "POST", credentials: "include",
      body: JSON.stringify({ name: "office", baseUrl: "https://office.example", apiKey: "peer-api-key-that-must-not-leak", acceptInsecureHttp: false }),
    }));
  });

  it("clears the API Key even when peer creation fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/peers" && options?.method === "POST") return new Response(JSON.stringify({ success: false, error: "拒绝" }), { status: 400 });
      return new Response(JSON.stringify({ success: true, data: [] }));
    });
    render(<PeersPage />);
    const apiKey = await screen.findByLabelText("目标 API Key");
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "office" } });
    fireEvent.change(screen.getByLabelText("目标地址"), { target: { value: "https://office.example" } });
    fireEvent.change(apiKey, { target: { value: "peer-api-key-that-must-not-leak" } });
    fireEvent.click(screen.getByRole("button", { name: "添加对端" }));
    await waitFor(() => expect(apiKey).toHaveValue(""));
    expect(screen.getByRole("alert")).toHaveTextContent("拒绝");
  });
});
