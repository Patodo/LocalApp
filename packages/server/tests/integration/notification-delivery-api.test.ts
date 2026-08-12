import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID, flushMetaDb, getDb } from "../../src/lib/meta-sqlite.js";
import { markRead, persistNotifications, softDelete } from "../../src/lib/notifications-db.js";
import { upsertSubscription } from "../../src/lib/subscriptions-db.js";
import { wsManager } from "../../src/lib/ws-manager.js";
import { createTestPage, createTestServer, getAppUrl, registerUser } from "./helpers.js";

const TASK_ROOT = path.resolve(__dirname, "../../../../tmp/task-9-notification-delivery-api");

async function login(baseUrl: string, username: string, password: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`login failed: ${await response.text()}`);
  const token = response.headers.get("set-cookie")?.match(/token=([^;]+)/)?.[1];
  if (!token) throw new Error("login cookie missing");
  return `token=${token}`;
}

async function forcePassword(baseUrl: string, userId: string, oldPassword: string, newPassword: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/auth/force-change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, oldPassword, newPassword }),
  });
  if (!response.ok) throw new Error(`force password failed: ${await response.text()}`);
}

function highWater(): number {
  const result = getDb().exec("SELECT high_water FROM notification_delivery_state WHERE singleton = 1");
  return Number(result[0]?.values[0]?.[0] ?? -1);
}

describe.sequential("GET /api/inbox/delivery", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let adminCookie: string;
  let aliceCookie: string;
  let bobCookie: string;

  beforeAll(async () => {
    fs.mkdirSync(TASK_ROOT, { recursive: true });
    const server = await createTestServer({ dataRoot: TASK_ROOT });
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;

    await forcePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");
    adminCookie = await login(baseUrl, BOOTSTRAP_USER_ID, "test123456");
    await registerUser(baseUrl, "delivery-alice");
    await registerUser(baseUrl, "delivery-bob");
    aliceCookie = await login(baseUrl, "delivery-alice", "test123456");
    bobCookie = await login(baseUrl, "delivery-bob", "test123456");
  });

  afterAll(async () => {
    await stop();
    fs.rmSync(TASK_ROOT, { recursive: true, force: true });
  });

  it("requires authentication", async () => {
    const response = await fetch(`${baseUrl}/api/inbox/delivery?afterSequence=0&limit=100`);
    expect(response.status).toBe(401);
  });

  it.each([
    "",
    "?limit=10",
    "?afterSequence=-1",
    "?afterSequence=01",
    "?afterSequence=1.0",
    "?afterSequence=1e2",
    "?afterSequence=%2B1",
    `?afterSequence=${Number.MAX_SAFE_INTEGER + 1}`,
    "?afterSequence=0&afterSequence=1",
    "?afterSequence=0&limit=0",
    "?afterSequence=0&limit=101",
    "?afterSequence=0&limit=01",
    "?afterSequence=0&limit=1.0",
    "?afterSequence=0&unknown=1",
    "?afterSequence=0&since=2026-08-12",
    "?afterSequence=0&since=2026-08-12T01:02:03%2B09:00",
    "?afterSequence=0&since=not-a-date",
    `?afterSequence=0&since=${encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000).toISOString())}`,
    `?afterSequence=0&since=${encodeURIComponent(new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())}`,
    `?afterSequence=0&since=${encodeURIComponent(new Date(Date.now() + 60 * 1000).toISOString())}`,
  ])("rejects noncanonical, duplicate, unknown, or excessive query %s", async (query) => {
    const response = await fetch(`${baseUrl}/api/inbox/delivery${query}`, { headers: { Cookie: aliceCookie } });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ success: false, error: "Invalid delivery query" });
  });

  it("returns exact safe serializer fields, snapshot pagination, and omittedCount", async () => {
    const afterSequence = highWater();
    for (const [title, data] of [
      ["page-one", { secret: "must-not-leak-1" }],
      ["page-two", { secret: "must-not-leak-2" }],
      ["page-three", { secret: "must-not-leak-3" }],
    ] as const) {
      persistNotifications([{
        userId: "delivery-alice",
        appOwner: "owner",
        appName: "app",
        title,
        body: "plain body",
        url: "/owner/app/inbox",
        priority: "normal",
        data,
      }]);
    }

    const response = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${afterSequence}&limit=1`,
      { headers: { Cookie: aliceCookie } },
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(Object.keys(body.data).sort()).toEqual([
      "hasMore", "items", "nextSequence", "omittedCount", "snapshotHighWater",
    ].sort());
    expect(body.data).toMatchObject({ hasMore: true, omittedCount: 2 });
    expect(body.data.snapshotHighWater).toBe(afterSequence + 3);
    expect(body.data.nextSequence).toBe(afterSequence + 1);
    expect(body.data.items).toHaveLength(1);
    expect(Object.keys(body.data.items[0]).sort()).toEqual([
      "app_name", "app_owner", "body", "created_at", "id", "priority", "sequence", "title", "url",
    ].sort());
    expect(body.data.items[0]).toMatchObject({
      sequence: afterSequence + 1,
      app_owner: "owner",
      app_name: "app",
      title: "page-one",
      body: "plain body",
      url: "/owner/app/inbox",
      priority: "normal",
    });
    expect(JSON.stringify(body.data)).not.toContain("must-not-leak");
    expect(JSON.stringify(body.data)).not.toContain("delivery_eligible");
    expect(JSON.stringify(body.data)).not.toContain("delivery-alice");

    const empty = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${body.data.snapshotHighWater}&limit=100`,
      { headers: { Cookie: aliceCookie } },
    );
    const emptyBody = await empty.json();
    expect(emptyBody.data).toEqual({
      items: [],
      nextSequence: body.data.snapshotHighWater,
      snapshotHighWater: body.data.snapshotHighWater,
      hasMore: false,
      omittedCount: 0,
    });
  });

  it("captures a stable snapshot so a later commit remains visible from the snapshot cursor", async () => {
    const afterSequence = highWater();
    persistNotifications([{
      userId: "delivery-alice", appOwner: "owner", appName: "app", title: "before-snapshot", priority: "normal",
    }]);
    const first = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${afterSequence}&limit=100`,
      { headers: { Cookie: aliceCookie } },
    );
    const firstBody = await first.json();

    persistNotifications([{
      userId: "delivery-alice", appOwner: "owner", appName: "app", title: "after-snapshot", priority: "normal",
    }]);
    expect(firstBody.data.items.map((item: { title: string }) => item.title)).toEqual(["before-snapshot"]);

    const next = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${firstBody.data.snapshotHighWater}&limit=100`,
      { headers: { Cookie: aliceCookie } },
    );
    const nextBody = await next.json();
    expect(nextBody.data.items.map((item: { title: string }) => item.title)).toEqual(["after-snapshot"]);
  });

  it("never moves an empty-page cursor backwards when the client is ahead of this database", async () => {
    const snapshotHighWater = highWater();
    const ahead = snapshotHighWater + 10;
    const response = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${ahead}&limit=100`,
      { headers: { Cookie: aliceCookie } },
    );
    const body = await response.json();
    expect(body.data).toEqual({
      items: [],
      nextSequence: ahead,
      snapshotHighWater,
      hasMore: false,
      omittedCount: 0,
    });
  });

  it("applies since inside the snapshot without changing eligibility", async () => {
    const afterSequence = highWater();
    const [oldPersisted] = persistNotifications([{
      userId: "delivery-alice", appOwner: "owner", appName: "app", title: "outside-window", priority: "normal",
    }]);
    getDb().run("UPDATE notifications SET created_at = ? WHERE id = ?", [
      new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
      oldPersisted.id,
    ]);
    flushMetaDb();
    persistNotifications([{
      userId: "delivery-alice", appOwner: "owner", appName: "app", title: "inside-window", priority: "normal",
    }]);
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const response = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${afterSequence}&limit=100&since=${encodeURIComponent(since)}`,
      { headers: { Cookie: aliceCookie } },
    );
    const body = await response.json();
    expect(body.data.items.map((item: { title: string }) => item.title)).toEqual(["inside-window"]);
    expect(body.data.omittedCount).toBe(0);
  });

  it("keeps read rows deliverable while excluding deleted and other-user rows", async () => {
    const afterSequence = highWater();
    const [readItem] = persistNotifications([{
      userId: "delivery-alice", appOwner: "owner", appName: "app", title: "already-read", priority: "normal",
    }]);
    const [deletedItem] = persistNotifications([{
      userId: "delivery-alice", appOwner: "owner", appName: "app", title: "deleted", priority: "normal",
    }]);
    persistNotifications([{
      userId: "delivery-bob", appOwner: "owner", appName: "app", title: "other-user", priority: "normal",
    }]);
    expect(markRead("delivery-alice", readItem.id)).not.toBeNull();
    expect(softDelete("delivery-alice", deletedItem.id)).toBe(true);

    const alice = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${afterSequence}&limit=100`,
      { headers: { Cookie: aliceCookie } },
    );
    const aliceBody = await alice.json();
    expect(aliceBody.data.items.map((item: { title: string }) => item.title)).toEqual(["already-read"]);

    const bob = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${afterSequence}&limit=100`,
      { headers: { Cookie: bobCookie } },
    );
    const bobBody = await bob.json();
    expect(bobBody.data.items.map((item: { title: string }) => item.title)).toEqual(["other-user"]);
  });

  it("fails closed by serializing a corrupted unsafe eligible URL as null", async () => {
    const afterSequence = highWater();
    const nextSequence = afterSequence + 1;
    getDb().run("BEGIN");
    getDb().run("UPDATE notification_delivery_state SET high_water = ? WHERE singleton = 1", [nextSequence]);
    getDb().run(
      `INSERT INTO notifications
        (id, user_id, app_owner, app_name, title, url, priority, created_at, delivery_seq, delivery_eligible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      ["unsafe-corrupt", "delivery-alice", "owner", "app", "unsafe", "/\\\\evil.example/x", "normal", new Date().toISOString(), nextSequence],
    );
    getDb().run("COMMIT");
    flushMetaDb();

    const response = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${afterSequence}&limit=100`,
      { headers: { Cookie: aliceCookie } },
    );
    const body = await response.json();
    expect(body.data.items).toEqual([
      expect.objectContaining({ id: "unsafe-corrupt", url: null }),
    ]);
  });

  it("uses the exact committed serializer for application live delivery and catch-up", async () => {
    const pageName = "delivery-live-app";
    await createTestPage(app, BOOTSTRAP_USER_ID, pageName);
    fs.writeFileSync(
      path.join(app.config.dataDir, BOOTSTRAP_USER_ID, pageName, "meta.json"),
      JSON.stringify({
        name: pageName,
        userId: BOOTSTRAP_USER_ID,
        description: "",
        currentVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
        metadata: {},
        notify: { enabled: true },
      }),
    );
    upsertSubscription("delivery-alice", BOOTSTRAP_USER_ID, pageName, "all");
    const afterSequence = highWater();
    const socket = new FakeSocket();
    wsManager.add("delivery-alice", socket as never, {
      clientKind: "notification-daemon",
      notificationProtocolVersion: 2,
    } as never);

    const notify = await fetch(`${baseUrl}/serve/${BOOTSTRAP_USER_ID}/${pageName}/api/notify`, {
      method: "POST",
      headers: {
        Cookie: adminCookie,
        "Content-Type": "application/json",
        Referer: `${baseUrl}/${BOOTSTRAP_USER_ID}/${pageName}/`,
      },
      body: JSON.stringify({
        title: "serializer parity",
        body: "same bytes",
        url: `/${BOOTSTRAP_USER_ID}/${pageName}/item/1`,
        priority: "high",
        data: { secret: "never-live" },
      }),
    });
    expect(notify.status).toBe(200);
    expect(socket.sent).toHaveLength(1);

    const catchUp = await fetch(
      `${baseUrl}/api/inbox/delivery?afterSequence=${afterSequence}&limit=100`,
      { headers: { Cookie: aliceCookie } },
    );
    const catchUpBody = await catchUp.json();
    const live = JSON.parse(socket.sent[0]);
    expect(live).toEqual({ type: "notify:notification", data: catchUpBody.data.items[0] });
    expect(JSON.stringify(live)).not.toContain("never-live");
    wsManager.remove("delivery-alice", socket as never);
  });
});

class FakeSocket {
  readyState = 1;
  OPEN = 1;
  sent: string[] = [];

  send(payload: string): void {
    this.sent.push(payload);
  }
}
