import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ActivationBroker,
  forwardActivationToDaemon,
} from "../src/activation/activation-broker.js";
import { createSpawnServiceCommandRunner } from "../src/service/service-manager.js";

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

  it("waits for a cooperative aborted service start to finish cleanup within a deterministic bound", async () => {
    let cleanupSettled = false;
    const start = vi.fn(async (signal?: AbortSignal) => await new Promise<void>((resolve) => {
      const cleanup = () => setTimeout(() => {
        cleanupSettled = true;
        resolve();
      }, 150);
      if (signal?.aborted) cleanup();
      else signal?.addEventListener("abort", cleanup, { once: true });
    }));
    const result = await Promise.race([
      forwardActivationToDaemon({
        url,
        ipcClient: { request: async () => { throw Object.assign(new Error("endpoint absent"), { code: "ipc_unreachable" }); } },
        service: { start },
        deadlineMs: 20,
      }).then(() => "resolved", (error: unknown) => error),
      new Promise<"test timeout">((resolve) => setTimeout(() => resolve("test timeout"), 500)),
    ]);

    expect(result).toMatchObject({ code: "ipc_unreachable" });
    expect(start).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(cleanupSettled).toBe(true);
  });

  it("settles the deadline only after reaping an abort-resistant service command", async () => {
    const root = await fs.mkdtemp(path.resolve(process.cwd(), "../../tmp/task-8-activation-service-abort-"));
    const marker = path.join(root, "late-service-effect");
    const pidPath = path.join(root, "service-pid");
    const runner = createSpawnServiceCommandRunner();
    let spawnedPid: number | undefined;
    let activation: Promise<void> | undefined;
    const start = vi.fn(async (signal?: AbortSignal) => {
      await runner({
        command: process.execPath,
        args: ["-e", `process.on("SIGTERM", () => {}); require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "late"), 2_000); setInterval(() => {}, 1_000);`],
        signal,
      });
    });
    try {
      activation = forwardActivationToDaemon({
        url,
        ipcClient: { request: async () => { throw Object.assign(new Error("endpoint absent"), { code: "ipc_unreachable" }); } },
        service: { start },
        deadlineMs: 500,
      });
      spawnedPid = Number(await waitForFile(pidPath));
      await expect(activation).rejects.toMatchObject({ code: "ipc_unreachable" });

      expect(start).toHaveBeenCalledWith(expect.any(AbortSignal));
      expect(() => process.kill(spawnedPid!, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
      await expect(fs.access(marker)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await activation?.catch(() => undefined);
      if (spawnedPid !== undefined) {
        try { process.kill(spawnedPid, "SIGKILL"); } catch { /* the assertion expects this after a successful drain */ }
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("does not start the service for a malformed or refused private IPC response", async () => {
    const start = vi.fn(async () => undefined);
    await expect(forwardActivationToDaemon({
      url,
      ipcClient: { request: async () => { throw Object.assign(new Error("malformed"), { code: "ipc_response_invalid" }); } },
      service: { start },
      deadlineMs: 50,
    })).rejects.toMatchObject({ code: "ipc_response_invalid" });
    expect(start).not.toHaveBeenCalled();
  });

  it("does not start the service when the reachable daemon refuses activation", async () => {
    const start = vi.fn(async () => undefined);
    await expect(forwardActivationToDaemon({
      url,
      ipcClient: { request: async () => ({ ok: false, type: "activation" }) },
      service: { start },
      deadlineMs: 50,
    })).rejects.toMatchObject({ code: "activation_ipc_rejected" });
    expect(start).not.toHaveBeenCalled();
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

async function waitForFile(filePath: string): Promise<string> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    const value = await fs.readFile(filePath, "utf8").catch(() => undefined);
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("Timed out waiting for the spawned service process");
}
