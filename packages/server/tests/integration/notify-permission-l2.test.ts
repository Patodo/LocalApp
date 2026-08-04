import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage, registerUser } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import { getConnection, getDbPath } from "../../src/lib/app-db.js";

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

describe("notify 权限 Level 2（系统约定表 _localapp_notifiers）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-perm-l2-app";
  let adminCookie: string;
  let bobCookie: string;
  let charlieCookie: string;

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

    // 在 app SQLite 中创建 _localapp_notifiers 表，并加入 bob（不含 charlie）
    const pageDir = path.join(dataDir, owner, pageName);
    const dbPath = getDbPath(pageDir);
    const db = await getConnection(dbPath);
    db.run(`CREATE TABLE _localapp_notifiers (user_id TEXT PRIMARY KEY)`);
    db.run(`INSERT INTO _localapp_notifiers (user_id) VALUES (?)`, ["bob"]);

    await forceChangePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");
    adminCookie = await loginAndGetCookie(baseUrl, BOOTSTRAP_USER_ID, "test123456");

    await registerUser(baseUrl, "bob");
    bobCookie = await loginAndGetCookie(baseUrl, "bob", "test123456");

    await registerUser(baseUrl, "charlie");
    charlieCookie = await loginAndGetCookie(baseUrl, "charlie", "test123456");
  });

  afterAll(async () => { await stop(); });

  async function postNotify(cookie: string) {
    return fetch(`${baseUrl}/serve/${owner}/${pageName}/api/notify`, {
      method: "POST",
      headers: {
        "Cookie": cookie,
        "Content-Type": "application/json",
        "Referer": `http://${baseUrlHost}/${owner}/${pageName}/page`,
      },
      body: JSON.stringify({ title: "x" }),
    });
  }

  it("在 _localapp_notifiers 表中的用户（bob）调 notify 通过（不返回 401/403）", async () => {
    const res = await postNotify(bobCookie);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("不在 _localapp_notifiers 表中的用户（charlie）调 notify 返回 403", async () => {
    const res = await postNotify(charlieCookie);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/permission|forbidden|notifier|only/i);
  });

  it("owner 始终通过（即使表存在）", async () => {
    const res = await postNotify(adminCookie);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
