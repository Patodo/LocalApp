import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage, registerUser } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { getDb, BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

async function loginAndGetCookie(baseUrl: string, username: string, password: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`login ${username} failed: ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) throw new Error(`no set-cookie for ${username}`);
  const tokenMatch = setCookie.match(/token=([^;]+)/);
  if (!tokenMatch) throw new Error(`no token in set-cookie: ${setCookie}`);
  return `token=${tokenMatch[1]}`;
}

async function forceChangePassword(baseUrl: string, userId: string, oldPassword: string, newPassword: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/auth/force-change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, oldPassword, newPassword }),
  });
  if (!res.ok) throw new Error(`force-change-password ${userId} failed: ${await res.text()}`);
}

function insertNotification(row: Record<string, unknown>) {
  const db = getDb();
  const cols = Object.keys(row);
  const placeholders = cols.map(() => "?").join(", ");
  db.run(
    `INSERT INTO notifications (${cols.join(", ")}) VALUES (${placeholders})`,
    cols.map((c) => row[c]),
  );
}

describe("收件箱 API（spec: 收件箱 API）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "inbox-source-app";
  let bobCookie: string;
  let bobId = "bob";
  let aliceCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;

    await createTestPage(app, owner, pageName);
    await forceChangePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");

    await registerUser(baseUrl, "bob");
    bobCookie = await loginAndGetCookie(baseUrl, "bob", "test123456");
    await registerUser(baseUrl, "alice");
    aliceCookie = await loginAndGetCookie(baseUrl, "alice", "test123456");

    // 给 bob 灌入测试数据
    const now = Date.now();
    for (let i = 0; i < 25; i++) {
      insertNotification({
        id: `bob-${i}`,
        user_id: bobId,
        app_owner: owner,
        app_name: pageName,
        title: `Inbox ${i}`,
        body: null,
        url: null,
        priority: i % 5 === 0 ? "high" : "normal",
        data: null,
        created_at: new Date(now - i * 1000).toISOString(),
        read_at: i < 20 ? new Date(now - i * 1000).toISOString() : null,
        deleted_at: null,
      });
    }
    // 一条已软删除
    insertNotification({
      id: "bob-deleted",
      user_id: bobId,
      app_owner: owner,
      app_name: pageName,
      title: "Deleted",
      body: null, url: null, priority: "normal", data: null,
      created_at: new Date(now - 30000).toISOString(),
      read_at: null, deleted_at: new Date().toISOString(),
    });
  });

  afterAll(async () => { await stop(); });

  it("GET /api/inbox?limit=20 游标分页查询第一页", async () => {
    const res = await fetch(`${baseUrl}/api/inbox?limit=20`, { headers: { "Cookie": bobCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data.items)).toBe(true);
    expect(json.data.items.length).toBe(20);
    expect(json.data.cursor).toBeTruthy();
    // 按 created_at DESC，第一条应是最新（Inbox 0）
    expect(json.data.items[0].title).toBe("Inbox 0");
  });

  it("GET /api/inbox?cursor=xxx 查询下一页", async () => {
    const first = await fetch(`${baseUrl}/api/inbox?limit=20`, { headers: { "Cookie": bobCookie } });
    const firstJson = await first.json();
    const cursor = firstJson.data.cursor;
    expect(cursor).toBeTruthy();

    const second = await fetch(`${baseUrl}/api/inbox?limit=20&cursor=${encodeURIComponent(cursor)}`, { headers: { "Cookie": bobCookie } });
    const secondJson = await second.json();
    expect(secondJson.data.items.length).toBe(5); // 25 - 20 = 5
    // 不应与第一页重复
    const firstIds = new Set(firstJson.data.items.map((i: any) => i.id));
    for (const item of secondJson.data.items) {
      expect(firstIds.has(item.id)).toBe(false);
    }
  });

  it("GET /api/inbox/unread-count 返回未读计数", async () => {
    const res = await fetch(`${baseUrl}/api/inbox/unread-count`, { headers: { "Cookie": bobCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    // 25 条中 20 条已读，1 条软删除不入计数 → 未读 5
    expect(json.data.count).toBe(5);
  });

  it("GET /api/inbox?unreadOnly=true only pages through unread notifications", async () => {
    const firstAll = await fetch(`${baseUrl}/api/inbox?limit=20`, { headers: { "Cookie": bobCookie } });
    const firstAllJson = await firstAll.json();
    expect(firstAllJson.data.items.every((item: any) => item.read_at)).toBe(true);

    const firstUnread = await fetch(`${baseUrl}/api/inbox?limit=3&unreadOnly=true`, {
      headers: { "Cookie": bobCookie },
    });
    const firstUnreadJson = await firstUnread.json();
    expect(firstUnreadJson.data.items.map((item: any) => item.id)).toEqual(["bob-20", "bob-21", "bob-22"]);
    expect(firstUnreadJson.data.items.every((item: any) => item.read_at === null)).toBe(true);
    expect(firstUnreadJson.data.cursor).toBeTruthy();

    const secondUnread = await fetch(
      `${baseUrl}/api/inbox?limit=3&unreadOnly=true&cursor=${encodeURIComponent(firstUnreadJson.data.cursor)}`,
      { headers: { "Cookie": bobCookie } },
    );
    const secondUnreadJson = await secondUnread.json();
    expect(secondUnreadJson.data.items.map((item: any) => item.id)).toEqual(["bob-23", "bob-24"]);
    expect(secondUnreadJson.data.cursor).toBeNull();
  });

  it("GET /api/inbox 未登录返回 401", async () => {
    const res = await fetch(`${baseUrl}/api/inbox`);
    expect(res.status).toBe(401);
  });

  it("GET /api/inbox 不返回软删除的通知", async () => {
    const res = await fetch(`${baseUrl}/api/inbox?limit=50`, { headers: { "Cookie": bobCookie } });
    const json = await res.json();
    const titles = json.data.items.map((i: any) => i.title);
    expect(titles).not.toContain("Deleted");
  });

  it("GET /api/inbox 不返回他人的通知", async () => {
    const res = await fetch(`${baseUrl}/api/inbox?limit=50`, { headers: { "Cookie": aliceCookie } });
    const json = await res.json();
    const titles = json.data.items.map((i: any) => i.title);
    expect(titles.some((t: string) => t.startsWith("Inbox "))).toBe(false);
  });

  it("GET /api/inbox/:id returns only the authenticated user's exact row", async () => {
    const own = await fetch(`${baseUrl}/api/inbox/bob-11`, { headers: { "Cookie": bobCookie } });
    expect(own.status).toBe(200);
    expect((await own.json()).data).toMatchObject({ id: "bob-11", user_id: "bob", app_name: pageName });
    expect((await fetch(`${baseUrl}/api/inbox/bob-11`, { headers: { "Cookie": aliceCookie } })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/inbox/bob-deleted`, { headers: { "Cookie": bobCookie } })).status).toBe(404);
  });

  it("PATCH /api/inbox/:id 标记已读", async () => {
    const res = await fetch(`${baseUrl}/api/inbox/bob-10`, {
      method: "PATCH",
      headers: { "Cookie": bobCookie },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.read_at).toBeTruthy();
  });

  it("PATCH 操作他人通知返回 404", async () => {
    const res = await fetch(`${baseUrl}/api/inbox/bob-11`, {
      method: "PATCH",
      headers: { "Cookie": aliceCookie },
    });
    expect(res.status).toBe(404);
  });

  it("DELETE /api/inbox/:id 软删除（deleted_at 置位）", async () => {
    const res = await fetch(`${baseUrl}/api/inbox/bob-12`, {
      method: "DELETE",
      headers: { "Cookie": bobCookie },
    });
    expect(res.status).toBe(200);
    // 再次查询应不见
    const list = await fetch(`${baseUrl}/api/inbox?limit=50`, { headers: { "Cookie": bobCookie } });
    const listJson = await list.json();
    const ids = listJson.data.items.map((i: any) => i.id);
    expect(ids).not.toContain("bob-12");
  });

  it("POST /api/inbox/read-all 批量已读", async () => {
    const before = await fetch(`${baseUrl}/api/inbox/unread-count`, { headers: { "Cookie": bobCookie } });
    const beforeJson = await before.json();
    expect(beforeJson.data.count).toBeGreaterThan(0);

    const res = await fetch(`${baseUrl}/api/inbox/read-all`, {
      method: "POST",
      headers: { "Cookie": bobCookie },
    });
    expect(res.status).toBe(200);

    const after = await fetch(`${baseUrl}/api/inbox/unread-count`, { headers: { "Cookie": bobCookie } });
    const afterJson = await after.json();
    expect(afterJson.data.count).toBe(0);
  });
});
