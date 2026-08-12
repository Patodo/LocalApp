import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryStore, type DeliveryNotification } from "../src/notifications/delivery-store.js";
import { NotificationDispatcher } from "../src/notifications/notification-dispatcher.js";
import { SourceConnection, type SourceSocket } from "../src/notifications/source-connection.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function fixture(cursor?: number, connectionDelay?: (ms: number, signal: AbortSignal) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-10c-source-"));
  roots.push(root);
  const store = new DeliveryStore({ statePath: path.join(root, "state.json") });
  const id = "11111111-1111-4111-8111-111111111111";
  if (cursor !== undefined) await store.baseline(id, cursor);
  const native = { permissionState: vi.fn(async () => "granted" as const), showNotification: vi.fn(async () => undefined) };
  const dispatcher = new NotificationDispatcher({ store, adapter: native, iconPath: path.join(root, "icon.png") });
  const socket = new FakeSocket();
  const statuses: unknown[] = [];
  const connection = (fetch: typeof globalThis.fetch = vi.fn()) => new SourceConnection({
    source: { id, generation: 1, sourceOrigin: "https://peer.example.test", targetUserId: "u", sourceLabel: "Peer", enabled: true, credential: "secret_credential_123456789" },
    store,
    dispatcher,
    fetch,
    createSocket: (url, credential) => {
      expect(url).toBe("wss://peer.example.test/api/ws?client=notification-daemon&notificationProtocolVersion=2");
      expect(credential).toBe("secret_credential_123456789");
      return socket;
    },
    reportStatus: async (_id, status) => { statuses.push(status); },
    delay: connectionDelay ?? ((_ms, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }))),
    jitter: () => 0,
  });
  return { id, store, native, socket, statuses, connection };
}

function delivery(sequence: number): DeliveryNotification {
  return { id: `n-${sequence}`, sequence, app_owner: "owner", app_name: "app", title: `Title ${sequence}`, body: null, url: "/owner/app/", priority: "normal", created_at: "2026-08-12T00:00:00.000Z" };
}

describe("SourceConnection", () => {
  it("baselines first ready high-water without replaying history", async () => {
    const { id, store, native, socket, statuses, connection } = await fixture();
    const active = connection();
    active.start();
    await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open();
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 9 } });
    await waitFor(() => statuses.some((status: any) => status.state === "connected"));
    expect(await store.readSource(id)).toMatchObject({ cursor: 9, pending: null });
    expect(native.showNotification).not.toHaveBeenCalled();
    await active.stop();
  });

  it("drains catch-up before buffered live events in sequence order", async () => {
    const { store, native, socket, statuses, connection } = await fixture(0);
    let resolveFetch!: (response: Response) => void;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; })) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start();
    await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open();
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 2 } });
    await waitFor(() => fetch.mock.calls.length === 1);
    socket.frame({ type: "notify:notification", data: delivery(3) });
    resolveFetch(Response.json({ success: true, data: { items: [delivery(2)], nextSequence: 2, snapshotHighWater: 2, hasMore: false, omittedCount: 0 } }));
    await waitFor(async () => (await store.readSource("11111111-1111-4111-8111-111111111111"))?.cursor === 3);
    await waitFor(() => statuses.some((status: any) => status.state === "connected"));
    expect(native.showNotification.mock.calls.map((call) => call[0].title)).toEqual(["Title 2", "Title 3"]);
    expect(statuses).toEqual(expect.arrayContaining([expect.objectContaining({ state: "connected", cursor: 3 })]));
    await active.stop();
  });

  it("emits one exact summary and advances an omitted snapshot", async () => {
    const { id, store, native, socket, statuses, connection } = await fixture(3);
    const fetch = vi.fn(async () => Response.json({ success: true, data: { items: [delivery(4), delivery(5)], nextSequence: 5, snapshotHighWater: 20, hasMore: true, omittedCount: 15 } })) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting")); socket.open();
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 20 } });
    await waitFor(async () => (await store.readSource(id))?.cursor === 20);
    expect(native.showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "17 new notifications" }));
    await active.stop();
  });

  it("stops retrying after an authentication close", async () => {
    const { socket, statuses, connection } = await fixture(0);
    const active = connection();
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting")); socket.open(); socket.close(4401, "bad key");
    await waitFor(() => statuses.some((status: any) => status.error?.code === "SOURCE_AUTHENTICATION_FAILED"));
    expect(statuses.filter((status: any) => status.state === "connecting")).toHaveLength(1);
    await active.stop();
  });

  it("rejects a ready frame bound to a different authenticated user", async () => {
    const { socket, statuses, connection } = await fixture(0);
    const active = connection();
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open(); socket.frame({ type: "bus:ready", data: { userId: "other-user", notificationProtocolVersion: 2, latestSequence: 0 } });
    await waitFor(() => statuses.some((status: any) => status.error?.code === "SOURCE_IDENTITY_MISMATCH"));
    await active.stop();
  });

  it("advances an empty authoritative page and rejects malformed frames after ready", async () => {
    const { id, store, socket, statuses, connection } = await fixture(3);
    const fetch = vi.fn(async () => Response.json({ success: true, data: { items: [], nextSequence: 10, snapshotHighWater: 10, hasMore: false, omittedCount: 0 } })) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open(); socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 10 } });
    await waitFor(async () => (await store.readSource(id))?.cursor === 10);
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 10 } });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(statuses).toEqual(expect.arrayContaining([expect.objectContaining({ error: expect.objectContaining({ code: "SOURCE_PROTOCOL_INVALID" }) })]));
    await active.stop();
  });

  it("uses authoritative catch-up instead of skipping a live gap", async () => {
    const { id, store, native, socket, statuses, connection } = await fixture(10, async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, data: { items: [], nextSequence: 10, snapshotHighWater: 10, hasMore: false, omittedCount: 0 } }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { items: [delivery(11), delivery(12)], nextSequence: 12, snapshotHighWater: 12, hasMore: false, omittedCount: 0 } })) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open(); socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 10 } });
    await waitFor(() => statuses.some((status: any) => status.state === "connected"));
    socket.frame({ type: "notify:notification", data: delivery(12) });
    await waitFor(async () => (await store.readSource(id))?.cursor === 12);
    expect(native.showNotification.mock.calls.map((call) => call[0].title)).toEqual(["Title 11", "Title 12"]);
    await active.stop();
  });

  it("aborts and settles an in-flight catch-up before retrying after a protocol failure", async () => {
    const { id, store, native, socket, statuses, connection } = await fixture(0);
    let aborted = false;
    const fetch = vi.fn((_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => { aborted = true; reject(init.signal?.reason); }, { once: true });
    })) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open(); socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 1 } });
    await waitFor(() => fetch.mock.calls.length === 1);
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 1 } });
    await waitFor(() => statuses.some((status: any) => status.error?.code === "SOURCE_PROTOCOL_INVALID"));
    expect(aborted).toBe(true);
    expect((await store.readSource(id))?.cursor).toBe(0);
    expect(native.showNotification).not.toHaveBeenCalled();
    await active.stop();
  });

  it("aborts a live-gap catch-up immediately on a protocol failure", async () => {
    const { id, store, native, socket, statuses, connection } = await fixture(10, async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    let secondAborted = false;
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, data: { items: [], nextSequence: 10, snapshotHighWater: 10, hasMore: false, omittedCount: 0 } }))
      .mockImplementationOnce((_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => { secondAborted = true; reject(init.signal?.reason); }, { once: true }))) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open(); socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 10 } });
    await waitFor(() => statuses.some((status: any) => status.state === "connected"));
    socket.frame({ type: "notify:notification", data: delivery(12) });
    await waitFor(() => fetch.mock.calls.length === 2);
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 12 } });
    await waitFor(() => statuses.some((status: any) => status.error?.code === "SOURCE_PROTOCOL_INVALID"));
    expect(secondAborted).toBe(true);
    expect((await store.readSource(id))?.cursor).toBe(10);
    expect(native.showNotification).not.toHaveBeenCalled();
    await active.stop();
  });

  it("does not advance an authoritative page after dispatch is aborted by a protocol failure", async () => {
    const { id, store, native, socket, statuses, connection } = await fixture(10);
    let releasePermission!: (state: "granted") => void;
    native.permissionState.mockImplementationOnce(() => new Promise((resolve) => { releasePermission = resolve; }));
    const fetch = vi.fn(async () => Response.json({ success: true, data: { items: [delivery(11)], nextSequence: 11, snapshotHighWater: 11, hasMore: false, omittedCount: 0 } })) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open(); socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 11 } });
    await waitFor(() => native.permissionState.mock.calls.length === 1);
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 11 } });
    releasePermission("granted");
    await waitFor(() => statuses.some((status: any) => status.error?.code === "SOURCE_PROTOCOL_INVALID"));
    expect((await store.readSource(id))?.cursor).toBe(10);
    expect((await store.readSource(id))?.pending?.delivery.sequence).toBe(11);
    expect(native.showNotification).not.toHaveBeenCalled();
    await active.stop();
  });

  it("does not advance an omitted snapshot after summary dispatch is aborted", async () => {
    const { id, store, native, socket, statuses, connection } = await fixture(10);
    let releasePermission!: (state: "granted") => void;
    native.permissionState.mockImplementationOnce(() => new Promise((resolve) => { releasePermission = resolve; }));
    const fetch = vi.fn(async () => Response.json({ success: true, data: { items: [delivery(11)], nextSequence: 11, snapshotHighWater: 20, hasMore: true, omittedCount: 9 } })) as unknown as typeof globalThis.fetch;
    const active = connection(fetch);
    active.start(); await waitFor(() => statuses.some((status: any) => status.state === "connecting"));
    socket.open(); socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 20 } });
    await waitFor(() => native.permissionState.mock.calls.length === 1);
    socket.frame({ type: "bus:ready", data: { userId: "u", notificationProtocolVersion: 2, latestSequence: 20 } });
    releasePermission("granted");
    await waitFor(() => statuses.some((status: any) => status.error?.code === "SOURCE_PROTOCOL_INVALID"));
    expect((await store.readSource(id))?.cursor).toBe(10);
    expect(native.showNotification).not.toHaveBeenCalled();
    await active.stop();
  });
});

class FakeSocket extends EventEmitter implements SourceSocket {
  readyState = 0;
  sent: string[] = [];
  send(data: string): void { this.sent.push(data); }
  open(): void { this.readyState = 1; this.emit("open"); }
  frame(value: unknown): void { this.emit("message", Buffer.from(JSON.stringify(value))); }
  close(code = 1000, reason = ""): void { const wasOpen = this.readyState !== 3; this.readyState = 3; if (wasOpen) this.emit("close", code, Buffer.from(reason)); }
  override on(event: any, listener: (...args: any[]) => void): this { return super.on(event, listener); }
  off(event: any, listener: (...args: any[]) => void): this { return super.off(event, listener); }
}

async function waitFor(predicate: () => boolean | Promise<boolean>): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error("condition timed out");
}
