import { describe, expect, it, vi } from "vitest";
import {
  ActivationBroker,
  forwardActivationToDaemon,
} from "../src/activation/activation-broker.js";

const actionId = "11111111-1111-4111-8111-111111111111";
const nonce = "nonce_abcdefghijklmnopqrstuvwxyz-0123456789";
const url = `localapp://action/${actionId}?origin=https%3A%2F%2Fserver.example.test&nonce=${nonce}&protocolVersion=2`;

describe("Scheme activation broker", () => {
  it("starts only the injected current-user service then retries the complete URL through private IPC", async () => {
    const start = vi.fn(async () => undefined);
    const request = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "ipc_unreachable" }))
      .mockResolvedValueOnce({ ok: true, type: "activation" });

    await forwardActivationToDaemon({
      url,
      ipcClient: { request },
      service: { start },
      deadlineMs: 100,
      delay: async () => undefined,
    });

    expect(start).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith({ type: "activation", url });
  });

  it("reparses the URL then posts only the canonical ticket with the memory-only control token", async () => {
    const open = vi.fn(async () => undefined);
    const fetch = vi.fn(async (input: string, init: RequestInit) => {
      expect(input).toBe("http://127.0.0.1:43127/api/device-control/activations");
      expect(init.redirect).toBe("error");
      expect(init.headers).toEqual({ "content-type": "application/json", "x-localapp-device-control": "memory-only-token" });
      expect(init.body).toBe(JSON.stringify({ protocolVersion: 2, sourceOrigin: "https://server.example.test", actionId, nonce }));
      return response({
        success: true,
        data: {
          protocolVersion: 2,
          requestId: "22222222-2222-4222-8222-222222222222",
          status: "awaiting_trust",
          confirmationUrl: "http://127.0.0.1:43127/my/device-actions/?requestId=22222222-2222-4222-8222-222222222222",
        },
      });
    });
    const broker = new ActivationBroker({ fetch, open });

    await broker.activate({ url, listenUrl: "http://127.0.0.1:43127", controlToken: "memory-only-token" });

    expect(open).toHaveBeenCalledWith("http://127.0.0.1:43127/my/device-actions/?requestId=22222222-2222-4222-8222-222222222222");
  });

  it.each([
    "http://localhost:43127/my/device-actions/?requestId=22222222-2222-4222-8222-222222222222",
    "http://127.0.0.1:43127/serve/owner/app/?requestId=22222222-2222-4222-8222-222222222222",
    "http://127.0.0.1:43127/my/device-actions/?requestId=22222222-2222-4222-8222-222222222222&extra=1",
  ])("never opens a malformed confirmation target: %s", async (confirmationUrl) => {
    const open = vi.fn(async () => undefined);
    const broker = new ActivationBroker({
      open,
      fetch: async () => response({ success: true, data: {
        protocolVersion: 2,
        requestId: "22222222-2222-4222-8222-222222222222",
        status: "awaiting_trust",
        confirmationUrl,
      } }),
    });

    await expect(broker.activate({ url, listenUrl: "http://127.0.0.1:43127", controlToken: "memory-only-token" }))
      .rejects.toMatchObject({ code: "activation_confirmation_invalid" });
    expect(open).not.toHaveBeenCalled();
  });

  it("fails closed for notification tickets until a resolver is injected", async () => {
    const open = vi.fn(async () => undefined);
    const broker = new ActivationBroker({ open, fetch: vi.fn() });
    await expect(broker.activate({
      url: "localapp://notification/open?ticket=notification_ticket_0123456789",
      listenUrl: "http://127.0.0.1:43127",
      controlToken: "memory-only-token",
    })).rejects.toMatchObject({ code: "notification_ticket_resolver_unavailable" });
    expect(open).not.toHaveBeenCalled();
  });
});

function response(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}
