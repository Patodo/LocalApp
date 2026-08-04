import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage, registerUser } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { shouldPushToSubscriber } from "../../src/lib/notify-routing.js";
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

describe("notify 路由矩阵（单元：shouldPushToSubscriber）", () => {
  it("all + normal → 推送", () => {
    expect(shouldPushToSubscriber("all", "normal")).toBe(true);
  });
  it("all + high → 推送", () => {
    expect(shouldPushToSubscriber("all", "high")).toBe(true);
  });
  it("important + normal → 不推送", () => {
    expect(shouldPushToSubscriber("important", "normal")).toBe(false);
  });
  it("important + high → 推送", () => {
    expect(shouldPushToSubscriber("important", "high")).toBe(true);
  });
  it("muted + normal → 不推送", () => {
    expect(shouldPushToSubscriber("muted", "normal")).toBe(false);
  });
  it("muted + high → 不推送（用户主权优先）", () => {
    expect(shouldPushToSubscriber("muted", "high")).toBe(false);
  });
});

describe("notify 路由分发（端点：所有等级均入库）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-routing-app";
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

    // 三个订阅者：all / important / muted
    await registerUser(baseUrl, "alice");
    await registerUser(baseUrl, "bob");
    await registerUser(baseUrl, "carol");
    const aCookie = await loginAndGetCookie(baseUrl, "alice", "test123456");
    const bCookie = await loginAndGetCookie(baseUrl, "bob", "test123456");
    const cCookie = await loginAndGetCookie(baseUrl, "carol", "test123456");
    await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": aCookie },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "all" }),
    });
    await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": bCookie },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "important" }),
    });
    await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cCookie },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "muted" }),
    });
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

  function fetchInboxFor(userId: string): any[] {
    const db = getDb();
    const stmt = db.prepare(`SELECT * FROM notifications WHERE user_id = ?`);
    stmt.bind([userId]);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  }

  it("广播 normal：3 个订阅者全部入库（all/important/muted）", async () => {
    const res = await postNotify({ title: "Broadcast normal", priority: "normal" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivered).toBe(3);

    expect(fetchInboxFor("alice").some((r) => r.title === "Broadcast normal")).toBe(true);
    expect(fetchInboxFor("bob").some((r) => r.title === "Broadcast normal")).toBe(true);
    expect(fetchInboxFor("carol").some((r) => r.title === "Broadcast normal")).toBe(true);
  });

  it("广播 high：3 个订阅者全部入库（等级矩阵仅影响 WS 推送，不影响入库）", async () => {
    const res = await postNotify({ title: "Broadcast high", priority: "high" });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivered).toBe(3);

    expect(fetchInboxFor("alice").some((r) => r.title === "Broadcast high")).toBe(true);
    expect(fetchInboxFor("bob").some((r) => r.title === "Broadcast high")).toBe(true);
    expect(fetchInboxFor("carol").some((r) => r.title === "Broadcast high")).toBe(true);
  });

  it("to 字段过滤后仅命中订阅者入库", async () => {
    const res = await postNotify({ title: "Directed", to: ["alice", "nobody"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.delivered).toBe(1);
    expect(fetchInboxFor("alice").some((r) => r.title === "Directed")).toBe(true);
    expect(fetchInboxFor("bob").some((r) => r.title === "Directed")).toBe(false);
  });
});
