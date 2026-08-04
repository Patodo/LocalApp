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

function addSubscriber(userId: string, appOwner: string, appName: string, level = "normal") {
  const db = getDb();
  db.run(
    `INSERT OR IGNORE INTO subscriptions (user_id, app_owner, app_name, level, created_at) VALUES (?, ?, ?, ?, ?)`,
    [userId, appOwner, appName, level, new Date().toISOString()],
  );
}

function fetchNotifications(userId?: string): any[] {
  const db = getDb();
  const sql = userId
    ? "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at"
    : "SELECT * FROM notifications ORDER BY created_at";
  const stmt = db.prepare(sql);
  if (userId) stmt.bind([userId]);
  const rows: any[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

describe("notify 持久化（spec: 通知持久化 + 通知响应格式）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-persist-app";
  let adminCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    baseUrlHost = new URL(baseUrl).host;
    dataDir = server.dataDir;
    stop = server.stop;

    await createTestPage(app, owner, pageName);
    fs.writeFileSync(
      path.join(dataDir, owner, pageName, "meta.json"),
      JSON.stringify({
        name: pageName,
        userId: owner,
        description: "",
        currentVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
        metadata: {},
        notify: { enabled: true },
      }),
    );

    await forceChangePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");
    adminCookie = await loginAndGetCookie(baseUrl, BOOTSTRAP_USER_ID, "test123456");

    // 订阅者 bob/charlie/dave
    await registerUser(baseUrl, "bob");
    await registerUser(baseUrl, "charlie");
    await registerUser(baseUrl, "dave");
    addSubscriber("bob", owner, pageName);
    addSubscriber("charlie", owner, pageName);
    addSubscriber("dave", owner, pageName);
  });

  afterAll(async () => { await stop(); });

  async function postNotify(body: unknown) {
    return fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers: {
        "Cookie": adminCookie,
        "Content-Type": "application/json",
        "Referer": `http://${baseUrlHost}/${owner}/${pageName}/page`,
      },
      body: JSON.stringify(body),
    });
  }

  it("缺省 to 字段时广播给所有订阅者，每个订阅者写一行（user_id 非空）", async () => {
    const res = await postNotify({ title: "Broadcast", body: "Hi all", url: "/x", priority: "normal" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.delivered).toBe(3);
    expect(Array.isArray(json.ids)).toBe(true);
    expect(json.ids.length).toBe(3);

    const rows = fetchNotifications();
    const newRows = rows.filter((r) => r.title === "Broadcast");
    expect(newRows.length).toBe(3);
    for (const row of newRows) {
      expect(row.user_id).toBeTruthy();
      expect(row.app_owner).toBe(owner);
      expect(row.app_name).toBe(pageName);
      expect(row.title).toBe("Broadcast");
      expect(row.body).toBe("Hi all");
      expect(row.url).toBe("/x");
      expect(row.priority).toBe("normal");
      expect(row.read_at).toBeNull();
      expect(row.deleted_at).toBeNull();
      expect(row.created_at).toBeTruthy();
    }
    const userIds = new Set(newRows.map((r) => r.user_id));
    expect(userIds.size).toBe(3);
  });

  it("to 字段过滤订阅者：仅 to 中的已订阅用户入库", async () => {
    const res = await postNotify({ title: "Directed", to: ["bob", "charlie"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivered).toBe(2);
    expect(json.ids.length).toBe(2);

    const newRows = fetchNotifications().filter((r) => r.title === "Directed");
    expect(newRows.length).toBe(2);
    const userIds = new Set(newRows.map((r) => r.user_id));
    expect(userIds).toEqual(new Set(["bob", "charlie"]));
  });

  it("to 中包含未订阅用户时静默丢弃（仅入库已订阅的）", async () => {
    const res = await postNotify({ title: "Partial", to: ["bob", "nobody"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivered).toBe(1);
    expect(json.ids.length).toBe(1);
  });

  it("无可投递接收者时返回 delivered=0, ids=[]", async () => {
    const res = await postNotify({ title: "Nobody", to: ["unknown1", "unknown2"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivered).toBe(0);
    expect(json.ids).toEqual([]);
  });

  it("无任何订阅者时广播返回 delivered=0", async () => {
    // 用一个新页面，无订阅者
    const emptyPage = "notify-persist-empty";
    await createTestPage(app, owner, emptyPage);
    fs.writeFileSync(
      path.join(dataDir, owner, emptyPage, "meta.json"),
      JSON.stringify({
        name: emptyPage,
        userId: owner,
        description: "",
        currentVersion: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        versions: [],
        metadata: {},
        notify: { enabled: true },
      }),
    );
    const res = await fetch(`${baseUrl}/serve/${owner}/${emptyPage}/api/notify`, {
      method: "POST",
      headers: {
        "Cookie": adminCookie,
        "Content-Type": "application/json",
        "Referer": `http://${baseUrlHost}/${owner}/${emptyPage}/page`,
      },
      body: JSON.stringify({ title: "Empty" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivered).toBe(0);
    expect(json.ids).toEqual([]);
  });
});
