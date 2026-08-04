import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage, registerUser } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import { getConnection, getDbPath } from "../../src/lib/app-db.js";
import { validateNotifyPermissionConfig, buildPermissionSql } from "../../src/lib/notify-permission-sql.js";

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

describe("notify 权限 Level 3（自定义 SQL）— 单元：validateNotifyPermissionConfig", () => {
  it("合法配置通过校验", () => {
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id", where: "role = 'supervisor'" })).toBe(true);
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id" })).toBe(true);
  });

  it("table 非安全标识符（含空格/分号）拒绝", () => {
    expect(validateNotifyPermissionConfig({ table: "users; DROP", userColumn: "id" })).toBe(false);
    expect(validateNotifyPermissionConfig({ table: "user name", userColumn: "id" })).toBe(false);
    expect(validateNotifyPermissionConfig({ table: "users--", userColumn: "id" })).toBe(false);
  });

  it("userColumn 非安全标识符拒绝", () => {
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id; --" })).toBe(false);
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id or 1=1" })).toBe(false);
  });

  it("where 含分号拒绝", () => {
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id", where: "1=1; DROP TABLE x" })).toBe(false);
  });

  it("where 含 SQL 注释拒绝", () => {
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id", where: "1=1 -- comment" })).toBe(false);
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id", where: "1=1 /* block */" })).toBe(false);
  });

  it("where 含 DML/DDL 关键字拒绝", () => {
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id", where: "role = 'x' UNION SELECT 1" })).toBe(false);
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id", where: "1=1; INSERT INTO x VALUES(1)" })).toBe(false);
    expect(validateNotifyPermissionConfig({ table: "users", userColumn: "id", where: "1=1; DELETE FROM users" })).toBe(false);
  });

  it("buildPermissionSql 构造合法 SQL（无 where）", () => {
    const sql = buildPermissionSql({ table: "users", userColumn: "id" });
    expect(sql).toBe("SELECT 1 FROM users WHERE id = ? LIMIT 1");
  });

  it("buildPermissionSql 构造合法 SQL（有 where）", () => {
    const sql = buildPermissionSql({ table: "users", userColumn: "id", where: "role = 'supervisor'" });
    expect(sql).toBe("SELECT 1 FROM users WHERE id = ? AND (role = 'supervisor') LIMIT 1");
  });
});

describe("notify 权限 Level 3（自定义 SQL）— 端点", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const pageName = "notify-perm-l3-app";
  let adminCookie: string;
  let bobCookie: string;
  let charlieCookie: string;

  async function setupPage(notifyPermission: { table: string; userColumn?: string; where?: string } | undefined) {
    await createTestPage(app, owner, pageName);
    const meta: Record<string, unknown> = {
      name: pageName,
      userId: owner,
      description: "",
      currentVersion: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      versions: [],
      metadata: {},
      notify: { enabled: true },
    };
    if (notifyPermission) {
      meta.notify = { enabled: true, permission: notifyPermission };
    }
    fs.writeFileSync(path.join(dataDir, owner, pageName, "meta.json"), JSON.stringify(meta));

    const pageDir = path.join(dataDir, owner, pageName);
    const dbPath = getDbPath(pageDir);
    const db = await getConnection(dbPath);
    db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT)`);
    db.run(`INSERT INTO users (id, role) VALUES (?, ?)`, ["bob", "supervisor"]);
    db.run(`INSERT INTO users (id, role) VALUES (?, ?)`, ["charlie", "member"]);
  }

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    baseUrlHost = new URL(baseUrl).host;
    dataDir = server.dataDir;
    stop = server.stop;

    await setupPage({ table: "users", userColumn: "id", where: "role = 'supervisor'" });

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

  it("manifest.permission 命中（bob role=supervisor）通过", async () => {
    const res = await postNotify(bobCookie);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("manifest.permission 不命中（charlie role=member）返回 403", async () => {
    const res = await postNotify(charlieCookie);
    expect(res.status).toBe(403);
  });

  it("owner 始终通过（Level 3 配置存在）", async () => {
    const res = await postNotify(adminCookie);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
