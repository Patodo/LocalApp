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
});
