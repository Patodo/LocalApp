import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeviceApi, DEVICE_ACTION_PROTOCOL_VERSION } from "../src/index.js";

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ success: status < 400, data }), { status, headers: { "content-type": "application/json" } });
}

describe("device action SDK", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the canonical Device Action endpoints and protocol version", async () => {
    vi.stubGlobal("window", { location: { pathname: "/serve/owner/market/" } });
    const activate = vi.fn();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, protocolVersion: DEVICE_ACTION_PROTOCOL_VERSION }))
      .mockResolvedValueOnce(response({ requestId: "11111111-1111-4111-8111-111111111111", activationUrl: "localapp://action/11111111-1111-4111-8111-111111111111?origin=https%3A%2F%2Fserver.test&nonce=nonce_abcdefghijklmnopqrstuvwxyz-0123456789&protocolVersion=2" }))
      .mockResolvedValueOnce(response({ id: "11111111-1111-4111-8111-111111111111", status: "succeeded", result: { installed: true } }));

    const device = createDeviceApi({ fetch: fetchMock, activate, pollIntervalMs: 1 });
    const result = await device.run({ title: "Install", script: "return true", permissions: { filesystemWrite: ["/project/tmp"] } }, { observationTimeoutMs: 100 });

    expect(result).toMatchObject({ requestId: "11111111-1111-4111-8111-111111111111", status: "succeeded", result: { installed: true } });
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/device-actions/capabilities", { method: "GET" });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/serve/owner/market/api/device-actions");
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1]?.body as string).protocolVersion).toBe(2);
    expect(fetchMock.mock.calls[2]?.[0]).toBe("/api/device-actions/11111111-1111-4111-8111-111111111111");
    expect(activate).toHaveBeenCalledWith(expect.stringContaining("protocolVersion=2"));
  });

  it("navigates an exact same-origin local confirmation without invoking a Scheme anchor", async () => {
    const click = vi.fn();
    const dispatchEvent = vi.fn(() => false);
    const location = {
      pathname: "/serve/owner/market/",
      origin: "http://127.0.0.1:43127",
      href: "http://127.0.0.1:43127/owner/market/",
    };
    vi.stubGlobal("window", {
      dispatchEvent,
      location,
    });
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => null),
      createElement: vi.fn(() => ({ click, remove: vi.fn(), style: {}, href: "" })),
      body: { appendChild: vi.fn() },
    });
    const requestId = "22222222-2222-4222-8222-222222222222";
    const confirmationUrl = `http://127.0.0.1:43127/my/device-actions/?requestId=${requestId}`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ supported: true, protocolVersion: DEVICE_ACTION_PROTOCOL_VERSION }))
      .mockResolvedValueOnce(response({ requestId, activationUrl: confirmationUrl, status: "awaiting_trust" }))
      .mockResolvedValueOnce(response({ id: requestId, status: "cancelled" }));

    const device = createDeviceApi({ fetch: fetchMock, pollIntervalMs: 1 });
    await device.run({ title: "Install", script: "return true", permissions: {} }, { observationTimeoutMs: 100 });

    expect(dispatchEvent).toHaveBeenCalledOnce();
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: "localapp:platform_request",
      detail: {
        type: "localapp:platform_request",
        capability: "openRoute",
        payload: { href: `/my/device-actions/?requestId=${requestId}` },
      },
    });
    expect(location.href).toBe("http://127.0.0.1:43127/owner/market/");
    expect(click).not.toHaveBeenCalled();
  });
});
