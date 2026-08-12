import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryStore, type DeliveryNotification } from "../src/notifications/delivery-store.js";
import { NotificationActivationResolver } from "../src/notifications/notification-manager.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))));

async function fixture() {
  const root = await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-10c-activation-")); roots.push(root);
  const store = new DeliveryStore({ statePath: path.join(root, "state.json"), randomBytes: (size) => Buffer.alloc(size, 23) });
  const sourceId = "11111111-1111-4111-8111-111111111111";
  await store.baseline(sourceId, 0);
  const pending = await store.preparePending(sourceId, notification(), undefined, "Peer", path.join(root, "icon.png"));
  if (pending === null) throw new Error("expected pending");
  await store.commitShown(sourceId, 1);
  const source = { id: sourceId, generation: 1, sourceOrigin: "https://peer.example.test", targetUserId: "peer-user", sourceLabel: "Peer", enabled: true, credential: "secret_key_123456789" };
  const open = vi.fn(async () => undefined);
  return { store, pending, source, open };
}
function notification(): DeliveryNotification { return { id: "n-1", sequence: 1, app_owner: "owner", app_name: "app", title: "T", body: null, url: "/owner/app/results/1", priority: "normal", created_at: "2026-08-12T00:00:00.000Z" }; }
function inboxData(url: string | null) { return { id: "n-1", user_id: "peer-user", app_owner: "owner", app_name: "app", title: "T", body: null, url, priority: "normal", data: null, created_at: "2026-08-12T00:00:00.000Z", read_at: null, deleted_at: null }; }

describe("NotificationActivationResolver", () => {
  it("consumes once, validates formal target, marks exact source row, then opens", async () => {
    const { store, pending, source, open } = await fixture();
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ success: true, data: inboxData("/owner/app/results/1") }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const resolver = new NotificationActivationResolver({ store, manager: { currentSource: () => source }, open, fetch });
    await resolver.resolve(pending.ticket);
    expect(fetch.mock.calls.map((call) => [call[0], call[1]?.method ?? "GET", call[1]?.redirect])).toEqual([
      ["https://peer.example.test/api/inbox/n-1", "GET", "error"],
      ["https://peer.example.test/api/inbox/n-1", "PATCH", "error"],
    ]);
    expect(open).toHaveBeenCalledWith("https://peer.example.test/owner/app/results/1");
    await resolver.resolve(pending.ticket);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects raw, cross-app, encoded separator, redirect, and cross-origin targets without marking read", async () => {
    for (const url of ["/serve/owner/app/", "/other/app/", "/owner/app/%2fescape", "//evil.example/x", "https://evil.example/x"]) {
      const { store, pending, source, open } = await fixture();
      const fetch = vi.fn(async () => Response.json({ success: true, data: inboxData(url) }));
      await new NotificationActivationResolver({ store, manager: { currentSource: () => source }, open, fetch }).resolve(pending.ticket);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(open).not.toHaveBeenCalled();
    }
  });

  it("rejects a row bound to a different source user", async () => {
    const { store, pending, source, open } = await fixture();
    const fetch = vi.fn(async () => Response.json({ success: true, data: { ...inboxData("/owner/app/"), user_id: "other-user" } }));
    await new NotificationActivationResolver({ store, manager: { currentSource: () => source }, open, fetch }).resolve(pending.ticket);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(open).not.toHaveBeenCalled();
  });

  it("opens source fallback on missing credential/auth and summary without marking a row", async () => {
    const first = await fixture();
    await new NotificationActivationResolver({ store: first.store, manager: { currentSource: () => ({ ...first.source, credential: undefined }) }, open: first.open }).resolve(first.pending.ticket);
    expect(first.open).toHaveBeenCalledWith("https://peer.example.test/");

    const second = await fixture();
    const fetch = vi.fn(async () => new Response("denied", { status: 401 }));
    await new NotificationActivationResolver({ store: second.store, manager: { currentSource: () => second.source }, open: second.open, fetch }).resolve(second.pending.ticket);
    expect(second.open).toHaveBeenCalledWith("https://peer.example.test/");

    const summary = await second.store.issueSummary(second.source.id);
    await new NotificationActivationResolver({ store: second.store, manager: { currentSource: () => second.source }, open: second.open, fetch }).resolve(summary.ticket);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does nothing for a disabled source even when its capability lost credentials", async () => {
    const { store, pending, source, open } = await fixture();
    await new NotificationActivationResolver({ store, manager: { currentSource: () => ({ ...source, enabled: false, credential: undefined, capabilityReason: "PEER_CREDENTIAL_INVALID" }) }, open }).resolve(pending.ticket);
    expect(open).not.toHaveBeenCalled();
  });
});
