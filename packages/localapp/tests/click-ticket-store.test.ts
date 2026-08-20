import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClickTicketStore } from "../src/notifications/click-ticket-store.js";
import { DeliveryStore, type DeliveryNotification } from "../src/notifications/delivery-store.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

async function stores(now = new Date("2026-08-12T00:00:00.000Z")) {
  const root = await fs.mkdtemp(path.join(repositoryRoot, "tmp/task-10b1-ticket-"));
  roots.push(root);
  let current = now;
  const delivery = new DeliveryStore({
    statePath: path.join(root, "notifications.json"),
    now: () => current,
    randomBytes: (size) => Buffer.alloc(size, 11),
  });
  return {
    delivery,
    tickets: new ClickTicketStore(delivery),
    now: () => current,
    advance: (date: Date) => { current = date; },
  };
}

function notification(sequence = 1): DeliveryNotification {
  return { id: `n-${sequence}`, sequence, app_owner: "owner", app_name: "app", title: "Title", body: null, url: "/owner/app/", priority: "high", created_at: "2026-08-12T00:00:00.000Z" };
}

describe("ClickTicketStore", () => {
  it("atomically consumes a shown notification ticket exactly once", async () => {
    const { delivery, tickets } = await stores();
    await delivery.baseline("local", 0);
    const pending = await delivery.preparePending("local", notification());
    if (pending === null) throw new Error("expected pending delivery");
    await delivery.commitShown("local", 1);
    const [first, second] = await Promise.all([tickets.consume(pending.ticket), tickets.consume(pending.ticket)]);
    expect([first, second].filter(Boolean)).toEqual([{ kind: "notification", sourceId: "local", notificationId: "n-1" }]);
    expect(await tickets.consume("invalid-ticket-value")).toBeNull();
  });

  it("allows only one winner across independent store instances", async () => {
    const { delivery, now } = await stores();
    await delivery.baseline("local", 0);
    const instances = [delivery, ...Array.from({ length: 7 }, () => new DeliveryStore({ statePath: delivery.statePath, now }))];
    for (let sequence = 1; sequence <= 12; sequence += 1) {
      const pending = await delivery.preparePending("local", notification(sequence));
      if (pending === null) throw new Error("expected pending delivery");
      await delivery.commitShown("local", sequence);
      const results = await Promise.all(instances.map((store) => store.consumeTicket(pending.ticket)));
      expect(results.filter(Boolean)).toEqual([{ kind: "notification", sourceId: "local", notificationId: `n-${sequence}` }]);
    }
  });

  it("supports source-only summary intent and expires without revealing metadata", async () => {
    const { delivery, tickets, advance } = await stores();
    await delivery.baseline("peer-one", 7);
    const summary = await tickets.issueSummary("peer-one", new Date("2026-08-12T00:05:00.000Z"));
    expect(await tickets.consume(summary.ticket)).toEqual({ kind: "summary", sourceId: "peer-one" });
    const expired = await tickets.issueSummary("peer-one", new Date("2026-08-12T00:05:00.000Z"));
    advance(new Date("2026-08-12T00:06:00.000Z"));
    expect(await tickets.consume(expired.ticket)).toBeNull();
  });

  it("does not rewrite state for a well-formed unknown ticket", async () => {
    const { delivery, tickets } = await stores();
    await delivery.baseline("local", 0);
    const before = await fs.readFile(delivery.statePath);
    expect(await tickets.consume(Buffer.alloc(32, 88).toString("base64url"))).toBeNull();
    expect(await fs.readFile(delivery.statePath)).toEqual(before);
  });
});
