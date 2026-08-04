import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage, registerUser } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

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

describe("订阅 API（spec: 订阅 API）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "subscribe-target-app";
  let adminCookie: string;
  let bobCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;

    await createTestPage(app, owner, pageName);
    await forceChangePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");
    adminCookie = await loginAndGetCookie(baseUrl, BOOTSTRAP_USER_ID, "test123456");
    await registerUser(baseUrl, "bob");
    bobCookie = await loginAndGetCookie(baseUrl, "bob", "test123456");
  });

  afterAll(async () => { await stop(); });

  it("POST /api/subscriptions 未登录返回 401", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "all" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/subscriptions 创建订阅（201）", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": bobCookie },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "all" }),
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ app_owner: owner, app_name: pageName, level: "all" });
  });

  it("POST 同 app 不同 level 更新订阅（200）", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": bobCookie },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "muted" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.level).toBe("muted");
  });

  it("POST 非法 level 返回 400", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": bobCookie },
      body: JSON.stringify({ app_owner: owner, app_name: pageName, level: "noisy" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST 缺字段返回 400", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": bobCookie },
      body: JSON.stringify({ app_owner: owner }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/subscriptions 列出当前用户订阅", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions`, { headers: { "Cookie": bobCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    const mine = json.data.filter((s: any) => s.app_owner === owner && s.app_name === pageName);
    expect(mine.length).toBe(1);
    expect(mine[0].level).toBe("muted");
  });

  it("GET /api/subscriptions/:owner/:name/status 已订阅返回 level", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions/${owner}/${pageName}/status`, { headers: { "Cookie": bobCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toEqual({ level: "muted" });
  });

  it("GET /api/subscriptions/:owner/:name/status 未订阅返回 null", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions/${owner}/no-such-app/status`, { headers: { "Cookie": bobCookie } });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toBeNull();
  });

  it("DELETE /api/subscriptions/:owner/:name 退订（200）", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions/${owner}/${pageName}`, {
      method: "DELETE",
      headers: { "Cookie": bobCookie },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const status = await fetch(`${baseUrl}/api/subscriptions/${owner}/${pageName}/status`, { headers: { "Cookie": bobCookie } });
    const statusJson = await status.json();
    expect(statusJson.data).toBeNull();
  });

  it("DELETE 未订阅的 app 也返回 200（幂等）", async () => {
    const res = await fetch(`${baseUrl}/api/subscriptions/${owner}/never-subscribed`, {
      method: "DELETE",
      headers: { "Cookie": bobCookie },
    });
    expect(res.status).toBe(200);
  });
});
