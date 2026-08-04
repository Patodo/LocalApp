import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage, registerUser } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";

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

describe("publish → subscribe 端到端集成测试", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-e2e-flow";
  let adminCookie: string;
  let bobCookie: string;

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
    await registerUser(baseUrl, "bob");
    bobCookie = await loginAndGetCookie(baseUrl, "bob", "test123456");
  });

  afterAll(async () => { await stop(); });

  it("完整流程：notify → subscriptions 路由 → notifications 入库 → inbox 可见", async () => {
    // 1. bob 订阅 app
    const subRes = await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": bobCookie },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "all" }),
    });
    expect(subRes.status).toBe(201);

    // 2. admin 调 notify 广播
    const notifyRes = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers: {
        "Cookie": adminCookie,
        "Content-Type": "application/json",
        "Referer": `http://${baseUrlHost}/${owner}/${pageName}/page`,
      },
      body: JSON.stringify({ title: "E2E flow", body: "Hello", url: `/${owner}/${pageName}/item/1` }),
    });
    expect(notifyRes.status).toBe(200);
    const notifyJson = await notifyRes.json();
    expect(notifyJson.delivered).toBe(1);
    const notificationId = notifyJson.ids[0];
    expect(notificationId).toBeTruthy();

    // 3. bob 查收件箱应见到这条
    const inboxRes = await fetch(`${baseUrl}/api/inbox?limit=20`, { headers: { "Cookie": bobCookie } });
    const inboxJson = await inboxRes.json();
    const found = inboxJson.data.items.find((i: any) => i.id === notificationId);
    expect(found).toBeTruthy();
    expect(found.title).toBe("E2E flow");
    expect(found.url).toBe(`/${owner}/${pageName}/item/1`);
    expect(found.read_at).toBeNull();

    // 4. 未读计数 = 1
    const unreadRes = await fetch(`${baseUrl}/api/inbox/unread-count`, { headers: { "Cookie": bobCookie } });
    const unreadJson = await unreadRes.json();
    expect(unreadJson.data.count).toBeGreaterThanOrEqual(1);

    // 5. 标记已读
    const markRes = await fetch(`${baseUrl}/api/inbox/${notificationId}`, {
      method: "PATCH",
      headers: { "Cookie": bobCookie },
    });
    expect(markRes.status).toBe(200);
    const markJson = await markRes.json();
    expect(markJson.data.read_at).toBeTruthy();

    // 6. 已读后未读计数 -1
    const unread2 = await fetch(`${baseUrl}/api/inbox/unread-count`, { headers: { "Cookie": bobCookie } });
    const unread2Json = await unread2.json();
    expect(unread2Json.data.count).toBe(unreadJson.data.count - 1);

    // 7. bob 退订
    const unsubRes = await fetch(`${baseUrl}/api/subscriptions/${owner}/${pageName}`, {
      method: "DELETE",
      headers: { "Cookie": bobCookie },
    });
    expect(unsubRes.status).toBe(200);

    // 8. admin 再发通知，bob 不应收到（delivered=0）
    const notify2 = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers: {
        "Cookie": adminCookie,
        "Content-Type": "application/json",
        "Referer": `http://${baseUrlHost}/${owner}/${pageName}/page`,
      },
      body: JSON.stringify({ title: "After unsubscribe" }),
    });
    const notify2Json = await notify2.json();
    expect(notify2Json.delivered).toBe(0);
  });
});
