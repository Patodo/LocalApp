import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceActionsPage } from "./device-actions-page";

const pending = {
  requestId: "11111111-1111-4111-8111-111111111111",
  status: "awaiting_trust",
  sourceOrigin: "http://127.0.0.1:3000",
  appOwner: "market",
  appName: "skills",
  appVersion: "1",
  publisherUserId: "publisher",
  publisherDisplayName: "Publisher",
  title: "Install fixture",
  description: "Write a fixture",
  permissions: { filesystemWrite: ["/project/tmp"] },
  permissionsDigest: "digest",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  completedAt: null,
  error: null,
};

describe("DeviceActionsPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("shows exact permissions and lets a local administrator trust the action", async () => {
    let refreshed = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/device-actions/local/11111111-1111-4111-8111-111111111111/trust") {
        return new Response(JSON.stringify({ success: true, data: { ...pending, status: "preparing" } }));
      }
      if (url === "/api/device-actions/local") {
        if (options?.method === "POST") return new Response(JSON.stringify({ success: true, data: pending }));
        const action = refreshed ? { ...pending, status: "succeeded" } : pending;
        refreshed = true;
        return new Response(JSON.stringify({ success: true, data: { actions: [action], trusts: [] } }));
      }
      return new Response(JSON.stringify({ success: true, data: {} }));
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<DeviceActionsPage />);
    expect(await screen.findByText("Install fixture")).toBeInTheDocument();
    expect(screen.getByText(/写入 \/project\/tmp/)).toBeInTheDocument();
    expect(screen.queryByText(/script|callback/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "信任并执行" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/device-actions/local/11111111-1111-4111-8111-111111111111/trust",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    ));
    expect(await screen.findByText("succeeded")).toBeInTheDocument();
  });
});
