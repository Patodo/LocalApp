import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryStore } from "../src/notifications/delivery-store.js";
import { NotificationDispatcher } from "../src/notifications/notification-dispatcher.js";
import { NotificationConnectionManager } from "../src/notifications/notification-manager.js";
import type { SourceSocket } from "../src/notifications/source-connection.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

describe("NotificationConnectionManager", () => {
  it("polls the loopback authority, keeps credentials in memory, and aborts owned sources", async () => {
    const root = await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-10c-manager-")); roots.push(root);
    const store = new DeliveryStore({ statePath: path.join(root, "state.json") });
    const adapter = { permissionState: vi.fn(async () => "unsupported" as const), showNotification: vi.fn(async () => undefined) };
    const dispatcher = new NotificationDispatcher({ store, adapter, iconPath: path.join(root, "icon.png") });
    const source = {
      id: "11111111-1111-4111-8111-111111111111", kind: "peer", generation: 4,
      sourceOrigin: "https://peer.example.test", targetUserId: "peer-user", accountLabel: "Peer user", sourceLabel: "Peer",
      enabled: true, capability: { available: true, reason: null }, credential: "secret_peer_credential_123456",
    };
    let snapshots = 0;
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes("/sources/") && url.endsWith("/status")) return Response.json({ success: true });
      if (snapshots++ === 0) return Response.json({ success: true, data: { generation: 1, sources: [source] } });
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
    }) as unknown as typeof globalThis.fetch;
    const socket = new FakeSocket();
    const createSocket = vi.fn(() => socket);
    const manager = new NotificationConnectionManager({ localServerOrigin: "http://127.0.0.1:43127", controlToken: "notification_control_123456789", store, dispatcher, fetch, createSocket });
    await manager.start();
    await waitFor(() => createSocket.mock.calls.length === 1);
    expect(manager.currentSource(source.id)).toMatchObject({ sourceOrigin: source.sourceOrigin, credential: source.credential });
    expect(calls[0]).toMatchObject({ url: "http://127.0.0.1:43127/api/internal/device-notifications/sources", init: { redirect: "error" } });
    expect((calls[0]?.init?.headers as Record<string, string>)["x-localapp-notification-control"]).toBe("notification_control_123456789");
    expect(JSON.stringify(calls.filter((call) => call.url.endsWith("/status")))).not.toContain(source.credential);
    await manager.stop();
    expect(socket.readyState).toBe(3);
  });

  it("fails initial startup on duplicate source identities", async () => {
    const root = await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-10c-manager-duplicate-")); roots.push(root);
    const store = new DeliveryStore({ statePath: path.join(root, "state.json") });
    const dispatcher = new NotificationDispatcher({ store, adapter: { permissionState: async () => "unsupported", showNotification: async () => undefined }, iconPath: path.join(root, "icon.png") });
    const source = { id: "11111111-1111-4111-8111-111111111111", kind: "local", generation: 1, sourceOrigin: "http://127.0.0.1:43127", targetUserId: "u", accountLabel: "U", sourceLabel: "Local", enabled: false, capability: { available: true, reason: null } };
    const manager = new NotificationConnectionManager({ localServerOrigin: "http://127.0.0.1:43127", controlToken: "notification_control_123456789", store, dispatcher, fetch: vi.fn(async () => Response.json({ success: true, data: { generation: 1, sources: [source, source] } })) as unknown as typeof globalThis.fetch });
    await expect(manager.start()).rejects.toThrow(/snapshot.*invalid/i);
    await manager.stop();
  });

  it("applies display policy and runs permission only for a claimed explicit test command", async () => {
    const root = await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-11-manager-command-")); roots.push(root);
    const store = new DeliveryStore({ statePath: path.join(root, "state.json") });
    const dispatcher = new NotificationDispatcher({ store, adapter: { permissionState: async () => "unsupported", showNotification: async () => undefined }, iconPath: path.join(root, "icon.png") });
    const applyDisplayPolicy = vi.fn();
    const readNativeStatus = vi.fn(async () => ({ permission: "not-determined" as const, daemonVersion: "0.1.0", adapterVersion: "0.1.0" }));
    const runTestNotification = vi.fn(async () => ({ result: "shown" as const, permission: "granted" as const, daemonVersion: "0.1.0", adapterVersion: "0.1.0" }));
    let sourcePolls = 0;
    let claims = 0;
    const calls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push(url);
      if (url.endsWith("/control")) return Response.json({ success: true, data: { generation: 1, settings: { quietHours: null, preview: "hidden" } } });
      if (url.endsWith("/native-status")) return Response.json({ success: true, data: { generation: 1 } });
      if (url.endsWith("/test/claim")) return Response.json({ success: true, data: { command: claims++ === 0 ? { id: "11111111-1111-4111-8111-111111111111", type: "test-notification", userId: "u" } : null } });
      if (url.includes("/test/") && url.endsWith("/complete")) return Response.json({ success: true, data: { generation: 2 } });
      if (url.includes("/sources")) {
        if (sourcePolls++ === 0) return Response.json({ success: true, data: { generation: 1, sources: [] } });
        return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true }));
      }
      throw new Error(`unexpected URL ${url}`);
    }) as unknown as typeof globalThis.fetch;
    const manager = new NotificationConnectionManager({
      localServerOrigin: "http://127.0.0.1:43127", controlToken: "notification_control_123456789", store, dispatcher, fetch,
      applyDisplayPolicy, readNativeStatus, runTestNotification,
    });
    expect(runTestNotification).not.toHaveBeenCalled();
    await manager.start();
    expect(applyDisplayPolicy).toHaveBeenCalledWith({ quietHours: null, preview: "hidden" });
    expect(readNativeStatus).toHaveBeenCalledTimes(1);
    expect(runTestNotification).toHaveBeenCalledTimes(1);
    expect(calls.some((url) => url.endsWith("/test/11111111-1111-4111-8111-111111111111/complete"))).toBe(true);
    await manager.stop();
  });
});

class FakeSocket extends EventEmitter implements SourceSocket {
  readyState = 0;
  send(): void {}
  close(code = 1000): void { if (this.readyState === 3) return; this.readyState = 3; this.emit("close", code); }
  override on(event: any, listener: (...args: any[]) => void): this { return super.on(event, listener); }
  off(event: any, listener: (...args: any[]) => void): this { return super.off(event, listener); }
}
async function waitFor(predicate: () => boolean): Promise<void> { const deadline = Date.now() + 3_000; while (Date.now() < deadline) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error("condition timed out"); }
