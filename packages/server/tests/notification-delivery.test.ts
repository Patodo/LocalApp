import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import {
  closeMetaDb,
  flushMetaDb,
  getDb,
  initMetaDb,
  type MetaAtomicFileOperations,
} from "../src/lib/meta-sqlite.js";
import { persistNotifications, type NotificationRecord } from "../src/lib/notifications-db.js";
import { upsertSubscription } from "../src/lib/subscriptions-db.js";
import { wsManager } from "../src/lib/ws-manager.js";

const TASK_ROOT = path.resolve(__dirname, "../../../tmp/task-9-notification-delivery");
const roots: string[] = [];

function tempDataDir(): string {
  fs.mkdirSync(TASK_ROOT, { recursive: true });
  const root = fs.mkdtempSync(path.join(TASK_ROOT, "case-"));
  roots.push(root);
  return root;
}

function record(userId: string, overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    userId,
    appOwner: "owner",
    appName: "app",
    title: `notification-${userId}`,
    priority: "normal",
    ...overrides,
  };
}

function rows(sql: string, params: Array<string | number | null> = []): Array<Record<string, unknown>> {
  const stmt = getDb().prepare(sql);
  if (params.length > 0) stmt.bind(params);
  const result: Array<Record<string, unknown>> = [];
  while (stmt.step()) result.push(stmt.getAsObject());
  stmt.free();
  return result;
}

async function writeLegacyDatabase(
  dataDir: string,
  extraColumns = "",
  insertSql?: string,
): Promise<void> {
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(`
    CREATE TABLE notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      url TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT,
      deleted_at TEXT
      ${extraColumns}
    )
  `);
  if (insertSql) legacy.run(insertSql);
  fs.writeFileSync(path.join(dataDir, "meta.sqlite"), Buffer.from(legacy.export()));
  legacy.close();
}

afterEach(() => {
  closeMetaDb();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(TASK_ROOT, { recursive: true, force: true });
});

describe.sequential("durable ordered notification delivery", () => {
  it("migrates a fresh database with nullable constrained delivery columns and a singleton high-water", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);

    const columns = rows("PRAGMA table_info(notifications)").map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining(["delivery_seq", "delivery_eligible"]));
    expect(rows("SELECT singleton, high_water FROM notification_delivery_state")).toEqual([
      { singleton: 1, high_water: 0 },
    ]);
    const indexes = rows("PRAGMA index_list(notifications)");
    expect(indexes.some((index) => index.name === "idx_notifications_delivery_seq" && index.unique === 1)).toBe(true);
  });

  it("keeps every legacy notification nullable and forever ineligible", async () => {
    const dataDir = tempDataDir();
    await writeLegacyDatabase(dataDir, "", `
      INSERT INTO notifications
        (id, user_id, app_owner, app_name, title, priority, created_at)
      VALUES ('legacy-1', 'alice', 'owner', 'app', 'legacy', 'high', '2026-08-12T00:00:00.000Z')
    `);

    await initMetaDb(dataDir);
    expect(rows("SELECT delivery_seq, delivery_eligible FROM notifications WHERE id = 'legacy-1'")).toEqual([
      { delivery_seq: null, delivery_eligible: null },
    ]);
    upsertSubscription("alice", "owner", "app", "all");
    expect(rows("SELECT delivery_seq, delivery_eligible FROM notifications WHERE id = 'legacy-1'")).toEqual([
      { delivery_seq: null, delivery_eligible: null },
    ]);
    expect(rows("SELECT high_water FROM notification_delivery_state")).toEqual([{ high_water: 0 }]);
  });

  it.each([
    [", delivery_seq INTEGER", "delivery_seq", "delivery_eligible"],
    [", delivery_eligible INTEGER", "delivery_eligible", "delivery_seq"],
  ])("completes an idempotent partial migration that already has %s", async (extraColumn, present, added) => {
    const dataDir = tempDataDir();
    await writeLegacyDatabase(dataDir, extraColumn);

    await initMetaDb(dataDir);
    closeMetaDb();
    await initMetaDb(dataDir);

    const columns = rows("PRAGMA table_info(notifications)").map((row) => row.name);
    expect(columns).toEqual(expect.arrayContaining([present, added]));
    expect(rows("SELECT singleton, high_water FROM notification_delivery_state")).toEqual([
      { singleton: 1, high_water: 0 },
    ]);
  });

  it("fails startup rather than deriving a missing counter from partially assigned rows", async () => {
    const dataDir = tempDataDir();
    await writeLegacyDatabase(dataDir, ", delivery_seq INTEGER", `
      INSERT INTO notifications
        (id, user_id, app_owner, app_name, title, priority, created_at, delivery_seq)
      VALUES ('partial-1', 'alice', 'owner', 'app', 'partial', 'normal', '2026-08-12T00:00:00.000Z', 9)
    `);

    await expect(initMetaDb(dataDir)).rejects.toThrow(/delivery state|partial migration|high.water/i);
  });

  it("persists high-water across deletion and restart without consulting remaining rows", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);
    persistNotifications([record("alice", { title: "first" })]);
    expect(rows("SELECT delivery_seq FROM notifications WHERE title = 'first'")).toEqual([{ delivery_seq: 1 }]);

    getDb().run("DELETE FROM notifications");
    flushMetaDb();
    closeMetaDb();
    await initMetaDb(dataDir);

    persistNotifications([record("alice", { title: "second" })]);
    expect(rows("SELECT delivery_seq FROM notifications WHERE title = 'second'")).toEqual([{ delivery_seq: 2 }]);
    expect(rows("SELECT high_water FROM notification_delivery_state")).toEqual([{ high_water: 2 }]);
  });

  it("rejects JS-unsafe sequence overflow without inserting a row or advancing the counter", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);
    getDb().run("UPDATE notification_delivery_state SET high_water = ? WHERE singleton = 1", [Number.MAX_SAFE_INTEGER]);
    flushMetaDb();

    expect(() => persistNotifications([record("alice")])).toThrow(/sequence|safe integer|exhausted/i);
    expect(rows("SELECT COUNT(*) AS count FROM notifications")).toEqual([{ count: 0 }]);
    expect(rows("SELECT high_water FROM notification_delivery_state")).toEqual([
      { high_water: Number.MAX_SAFE_INTEGER },
    ]);
  });

  it("rolls back every row and the high-water when a later recipient insertion fails", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);
    getDb().run(`
      CREATE TRIGGER reject_failed_recipient
      BEFORE INSERT ON notifications
      WHEN NEW.user_id = 'fail'
      BEGIN SELECT RAISE(ABORT, 'injected recipient failure'); END
    `);

    expect(() => persistNotifications([record("alpha"), record("fail")])).toThrow(/injected recipient failure/i);
    expect(rows("SELECT id FROM notifications")).toEqual([]);
    expect(rows("SELECT high_water FROM notification_delivery_state")).toEqual([{ high_water: 0 }]);
  });

  it("serializes concurrent event-loop producers into unique ascending sequences", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);

    await Promise.all([
      Promise.resolve().then(() => persistNotifications([record("alice", { title: "producer-a" })])),
      Promise.resolve().then(() => persistNotifications([record("bob", { title: "producer-b" })])),
    ]);

    expect(rows("SELECT delivery_seq FROM notifications ORDER BY delivery_seq").map((row) => row.delivery_seq)).toEqual([1, 2]);
    expect(rows("SELECT high_water FROM notification_delivery_state")).toEqual([{ high_water: 2 }]);
  });

  it("assigns a deterministic sequence order to multi-recipient batches", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);

    persistNotifications([record("zeta"), record("alpha"), record("middle")]);

    expect(rows("SELECT user_id, delivery_seq FROM notifications ORDER BY delivery_seq")).toEqual([
      { user_id: "alpha", delivery_seq: 1 },
      { user_id: "middle", delivery_seq: 2 },
      { user_id: "zeta", delivery_seq: 3 },
    ]);
  });

  it("freezes all/important/muted eligibility at creation while retaining every inbox row", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);
    upsertSubscription("all-user", "owner", "app", "all");
    upsertSubscription("important-user", "owner", "app", "important");
    upsertSubscription("muted-user", "owner", "app", "muted");

    persistNotifications([
      record("all-user", { title: "normal" }),
      record("important-user", { title: "normal" }),
      record("muted-user", { title: "normal" }),
    ]);
    persistNotifications([
      record("all-user", { title: "high", priority: "high" }),
      record("important-user", { title: "high", priority: "high" }),
      record("muted-user", { title: "high", priority: "high" }),
    ]);

    expect(rows("SELECT user_id, title, delivery_eligible FROM notifications ORDER BY delivery_seq")).toEqual([
      { user_id: "all-user", title: "normal", delivery_eligible: 1 },
      { user_id: "important-user", title: "normal", delivery_eligible: 0 },
      { user_id: "muted-user", title: "normal", delivery_eligible: 0 },
      { user_id: "all-user", title: "high", delivery_eligible: 1 },
      { user_id: "important-user", title: "high", delivery_eligible: 1 },
      { user_id: "muted-user", title: "high", delivery_eligible: 0 },
    ]);
  });

  it("does not retroactively change old eligibility after subscription changes", async () => {
    const dataDir = tempDataDir();
    await initMetaDb(dataDir);
    upsertSubscription("alice", "owner", "app", "muted");
    persistNotifications([record("alice", { title: "while-muted", priority: "high" })]);

    upsertSubscription("alice", "owner", "app", "all");
    persistNotifications([record("alice", { title: "after-unmute", priority: "normal" })]);

    expect(rows("SELECT title, delivery_eligible FROM notifications ORDER BY delivery_seq")).toEqual([
      { title: "while-muted", delivery_eligible: 0 },
      { title: "after-unmute", delivery_eligible: 1 },
    ]);
  });

  it("publishes to WebSocket only after atomic file publication and uses the committed read-back row", async () => {
    const dataDir = tempDataDir();
    const socket = new FakeSocket();
    let armed = false;
    let sentAtRename = -1;
    const operations = operationsWith({
      renameSync(source, target) {
        if (armed) sentAtRename = socket.sent.length;
        fs.renameSync(source, target);
      },
    });
    await initMetaDb(dataDir, { atomicFileOperations: operations });
    upsertSubscription("alice", "owner", "app", "all");
    wsManager.add("alice", socket as never);
    armed = true;

    const persisted = persistNotifications([record("alice", { title: "committed", url: "/owner/app/item/1" })]);

    expect(sentAtRename).toBe(0);
    expect(socket.sent).toHaveLength(1);
    const live = JSON.parse(socket.sent[0]);
    const row = rows("SELECT id, delivery_seq, title, url FROM notifications WHERE id = ?", [persisted[0].id])[0];
    expect(live).toMatchObject({
      type: "notify:notification",
      data: { id: row.id, sequence: row.delivery_seq, title: row.title, url: row.url },
    });
    wsManager.remove("alice", socket as never);
  });

  it("emits no WebSocket event when atomic publication fails", async () => {
    const dataDir = tempDataDir();
    const socket = new FakeSocket();
    let rejectRename = false;
    const operations = operationsWith({
      renameSync(source, target) {
        if (rejectRename) throw Object.assign(new Error("injected delivery publication failure"), { code: "EIO" });
        fs.renameSync(source, target);
      },
    });
    await initMetaDb(dataDir, { atomicFileOperations: operations });
    upsertSubscription("alice", "owner", "app", "all");
    wsManager.add("alice", socket as never);
    rejectRename = true;

    try {
      expect(() => persistNotifications([record("alice")])).toThrow("injected delivery publication failure");
    } finally {
      rejectRename = false;
    }
    expect(socket.sent).toEqual([]);
    expect(rows("SELECT id FROM notifications")).toEqual([]);
    expect(rows("SELECT high_water FROM notification_delivery_state")).toEqual([{ high_water: 0 }]);
    wsManager.remove("alice", socket as never);
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

function operationsWith(overrides: Partial<MetaAtomicFileOperations>): MetaAtomicFileOperations {
  return {
    mkdirSync: fs.mkdirSync.bind(fs),
    openSync: fs.openSync.bind(fs),
    writeFileSync: fs.writeFileSync.bind(fs),
    fsyncSync: fs.fsyncSync.bind(fs),
    closeSync: fs.closeSync.bind(fs),
    renameSync: fs.renameSync.bind(fs),
    rmSync: fs.rmSync.bind(fs),
    ...overrides,
  };
}
