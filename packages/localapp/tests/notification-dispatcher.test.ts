import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryStore, type DeliveryNotification } from "../src/notifications/delivery-store.js";
import { NotificationDispatcher } from "../src/notifications/notification-dispatcher.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function fixture(permission: "granted" | "denied" | "unsupported" | "not-determined" | "unknown" = "granted", now?: () => Date) {
  const root = await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-10b2-dispatcher-"));
  roots.push(root);
  const store = new DeliveryStore({ statePath: path.join(root, "notifications.json"), randomBytes: (size) => Buffer.alloc(size, 17) });
  await store.baseline("local", 0);
  const adapter = { permissionState: vi.fn(async () => permission), showNotification: vi.fn(async () => undefined), requestPermission: vi.fn() };
  const dispatcher = new NotificationDispatcher({ store, adapter, iconPath: path.join(root, "localapp.png"), now });
  return { root, store, adapter, dispatcher };
}

function notification(sequence = 1): DeliveryNotification {
  return { id: `n-${sequence}`, sequence, app_owner: "owner", app_name: "app", title: "Ready", body: "Open result", url: "/owner/app/", priority: "high", created_at: "2026-08-12T00:00:00.000Z" };
}

describe("NotificationDispatcher", () => {
  it("prepares before a granted display and commits only after native success", async () => {
    const { store, adapter, dispatcher } = await fixture();
    adapter.showNotification.mockImplementation(async (envelope) => {
      expect(await store.readSource("local")).toMatchObject({ cursor: 0, pending: { delivery: { id: "n-1" } } });
      expect(envelope).toMatchObject({ title: "Ready", body: "Open result", sourceLabel: "Local server", priority: "high" });
      expect(Object.keys(envelope).sort()).toEqual(["body", "iconPath", "identifier", "priority", "sourceLabel", "ticket", "title"]);
    });
    await expect(dispatcher.dispatch({ sourceId: "local", sourceLabel: "Local server", policy: "native", delivery: notification() })).resolves.toEqual({ outcome: "shown", sequence: 1 });
    expect(await store.readSource("local")).toMatchObject({ cursor: 1, pending: null });
    expect(adapter.requestPermission).not.toHaveBeenCalled();
  });

  for (const permission of ["denied", "unsupported", "not-determined", "unknown"] as const) {
    it(`commits ${permission} as inbox-only without display or permission request`, async () => {
      const { store, adapter, dispatcher } = await fixture(permission);
      await expect(dispatcher.dispatch({ sourceId: "local", sourceLabel: "Local", policy: "native", delivery: notification() })).resolves.toEqual({ outcome: "inbox-only", sequence: 1 });
      expect(adapter.showNotification).not.toHaveBeenCalled();
      expect(adapter.requestPermission).not.toHaveBeenCalled();
      expect(await store.readSource("local")).toMatchObject({ cursor: 1, pending: null });
    });
  }

  it("honors explicit inbox-only policy without consulting native permission", async () => {
    const { adapter, dispatcher } = await fixture();
    await expect(dispatcher.dispatch({ sourceId: "local", sourceLabel: "Local", policy: "inbox-only", delivery: notification() })).resolves.toMatchObject({ outcome: "inbox-only" });
    expect(adapter.permissionState).not.toHaveBeenCalled();
    expect(adapter.showNotification).not.toHaveBeenCalled();
  });

  it("keeps pending after native failure and retries with one stable replacement ticket", async () => {
    const { store, adapter, dispatcher } = await fixture();
    adapter.showNotification.mockRejectedValueOnce(new Error("native unavailable"));
    await expect(dispatcher.dispatch({ sourceId: "local", sourceLabel: "Local", policy: "native", delivery: notification() })).rejects.toThrow(/native unavailable/);
    const pending = await store.readPending("local");
    await dispatcher.dispatch({ sourceId: "local", sourceLabel: "Local", policy: "native", delivery: notification() });
    expect(adapter.showNotification.mock.calls[0]?.[0].ticket).toBe(adapter.showNotification.mock.calls[1]?.[0].ticket);
    expect(adapter.showNotification.mock.calls[0]?.[0].identifier).toBe(adapter.showNotification.mock.calls[1]?.[0].identifier);
    expect((await store.readSource("local"))?.cursor).toBe(1);
    expect(pending?.retryCount).toBe(0);
  });

  it("bounds transient native retries and then advances as inbox-only", async () => {
    const { store, adapter, dispatcher } = await fixture();
    adapter.showNotification.mockRejectedValue(new Error("desktop session unavailable"));
    const input = { sourceId: "local", sourceLabel: "Local", policy: "native" as const, delivery: notification() };
    for (let attempt = 0; attempt < 4; attempt += 1) await expect(dispatcher.dispatch(input)).rejects.toThrow(/desktop session unavailable/);
    await expect(dispatcher.dispatch(input)).resolves.toEqual({ outcome: "inbox-only", sequence: 1 });
    expect(adapter.showNotification).toHaveBeenCalledTimes(4);
    expect(await store.readSource("local")).toMatchObject({ cursor: 1, pending: null });
  });

  it("rejects an altered retry and an oversized envelope without mutating pending state", async () => {
    const { store, adapter, dispatcher } = await fixture();
    adapter.showNotification.mockRejectedValueOnce(new Error("native unavailable"));
    const input = { sourceId: "local", sourceLabel: "Local", policy: "native" as const, delivery: notification() };
    await expect(dispatcher.dispatch(input)).rejects.toThrow(/native unavailable/);
    await expect(dispatcher.dispatch({ ...input, delivery: { ...notification(), title: "Changed" } })).rejects.toThrow(/different pending/i);
    expect(adapter.showNotification).toHaveBeenCalledTimes(1);

    const other = new DeliveryStore({ statePath: path.join((await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-10b2-oversize-"))), "notifications.json") });
    roots.push(path.dirname(other.statePath));
    await other.baseline("peer", 0);
    const oversized = new NotificationDispatcher({ store: other, adapter, iconPath: path.resolve(repositoryRoot, "icon.png") });
    await expect(oversized.dispatch({ sourceId: "peer", sourceLabel: "Peer", policy: "native", delivery: { ...notification(), title: "x".repeat(4_096), body: "y".repeat(4_096) } })).rejects.toThrow(/NATIVE_NOTIFICATION_INVALID/);
    expect(await other.readPending("peer")).toBeNull();
  });

  it("dedupes committed delivery and rejects gaps before native calls", async () => {
    const { adapter, dispatcher } = await fixture();
    const input = { sourceId: "local", sourceLabel: "Local", policy: "native" as const, delivery: notification() };
    await dispatcher.dispatch(input);
    await expect(dispatcher.dispatch(input)).resolves.toEqual({ outcome: "duplicate", sequence: 1 });
    await expect(dispatcher.dispatch({ ...input, delivery: notification(3) })).rejects.toThrow(/gap/i);
    expect(adapter.showNotification).toHaveBeenCalledTimes(1);
  });

  it("does no work after abort and exposes only a generic summary envelope", async () => {
    const { adapter, dispatcher } = await fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(dispatcher.dispatch({ sourceId: "local", sourceLabel: "Local", policy: "native", delivery: notification(), signal: controller.signal })).resolves.toEqual({ outcome: "aborted", sequence: 1 });
    await dispatcher.dispatchSummary({ sourceId: "local", sourceLabel: "Peer", omittedCount: 12 });
    expect(adapter.showNotification).toHaveBeenCalledWith(expect.objectContaining({ title: "12 new notifications", body: "Open the Peer inbox" }));
  });

  it("rejects unsafe source labels before store/native interaction", async () => {
    const { store, adapter, dispatcher } = await fixture();
    await expect(dispatcher.dispatch({ sourceId: "local", sourceLabel: "<script>api-key", policy: "native", delivery: notification() })).rejects.toThrow(/source label/i);
    expect(adapter.permissionState).not.toHaveBeenCalled();
    expect((await store.readSource("local"))?.cursor).toBe(0);
  });

  it("rejects malformed constructor dependencies", async () => {
    const { store, root } = await fixture();
    expect(() => new NotificationDispatcher({ store, adapter: {} as never, iconPath: path.join(root, "icon.png") })).toThrow(/options/i);
  });

  it("suppresses native display during cross-midnight quiet hours and advances the cursor", async () => {
    const { store, adapter, dispatcher } = await fixture("granted", () => new Date("2026-08-12T14:00:00.000Z"));
    dispatcher.configure({ quietHours: { start: "22:30", end: "07:15", timeZone: "Asia/Tokyo" }, preview: "full" });
    await expect(dispatcher.dispatch({ sourceId: "local", sourceLabel: "Local", policy: "native", delivery: notification() })).resolves.toEqual({ outcome: "inbox-only", sequence: 1 });
    expect(adapter.permissionState).not.toHaveBeenCalled();
    expect(adapter.showNotification).not.toHaveBeenCalled();
    expect((await store.readSource("local"))?.cursor).toBe(1);
  });

  it("hides publisher preview content without changing the click ticket", async () => {
    const { adapter, dispatcher } = await fixture();
    dispatcher.configure({ quietHours: null, preview: "hidden" });
    await dispatcher.dispatch({ sourceId: "local", sourceLabel: "Private Peer", policy: "native", delivery: notification() });
    const envelope = adapter.showNotification.mock.calls[0]?.[0];
    expect(envelope).toMatchObject({ title: "New LocalApp notification", body: "Open Private Peer to view it" });
    expect(JSON.stringify(envelope)).not.toContain("Ready");
    expect(JSON.stringify(envelope)).not.toContain("Open result");
    expect(envelope.ticket).toMatch(/^[A-Za-z0-9_-]{16,256}$/);
  });

  it("requests permission only for an explicit test and does not re-prompt a denied state", async () => {
    const { adapter, dispatcher } = await fixture("not-determined");
    adapter.requestPermission.mockResolvedValueOnce("denied");
    await expect(dispatcher.sendTestNotification("11111111-1111-4111-8111-111111111111")).resolves.toEqual({ result: "denied", permission: "denied" });
    adapter.permissionState.mockResolvedValueOnce("denied");
    await expect(dispatcher.sendTestNotification("22222222-2222-4222-8222-222222222222")).resolves.toEqual({ result: "denied", permission: "denied" });
    expect(adapter.requestPermission).toHaveBeenCalledTimes(1);
    expect(adapter.showNotification).not.toHaveBeenCalled();
  });
});
