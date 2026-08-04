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

describe("notify 权限优先级（Level 3 > 2 > 1）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  let adminCookie: string;
  let bobCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    baseUrlHost = new URL(baseUrl).host;
    dataDir = server.dataDir;
    stop = server.stop;

    await forceChangePassword(baseUrl, BOOTSTRAP_USER_ID, "localadmin", "test123456");
    adminCookie = await loginAndGetCookie(baseUrl, BOOTSTRAP_USER_ID, "test123456");
    await registerUser(baseUrl, "bob");
    bobCookie = await loginAndGetCookie(baseUrl, "bob", "test123456");
  });

  afterAll(async () => { await stop(); });

  async function setupPage(
    pageName: string,
    opts: { permission?: { table: string; userColumn?: string; where?: string }; notifiers?: string[]; customTable?: { name: string; ddl: string; rows: Array<{ sql: string; params: any[] }> } },
  ) {
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
      notify: opts.permission ? { enabled: true, permission: opts.permission } : { enabled: true },
    };
    fs.writeFileSync(path.join(dataDir, owner, pageName, "meta.json"), JSON.stringify(meta));

    if (opts.notifiers || opts.customTable) {
      const pageDir = path.join(dataDir, owner, pageName);
      const dbPath = getDbPath(pageDir);
      const db = await getConnection(dbPath);
      if (opts.notifiers) {
        db.run(`CREATE TABLE _localapp_notifiers (user_id TEXT PRIMARY KEY)`);
        for (const userId of opts.notifiers) {
          db.run(`INSERT INTO _localapp_notifiers (user_id) VALUES (?)`, [userId]);
        }
      }
      if (opts.customTable) {
        db.run(opts.customTable.ddl);
        for (const row of opts.customTable.rows) {
          db.run(row.sql, row.params);
        }
      }
    }
  }

  async function postNotify(pageName: string, cookie: string) {
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

  it("Level 3 优先：同时配置 manifest.permission 和 _localapp_notifiers 表时走 Level 3", async () => {
    // Level 3 配置：仅 role=supervisor 命中；bob 在 notifiers 表中但 role=member
    // 若走 Level 3，bob 应被拒绝（403）；若走 Level 2，bob 应通过
    await setupPage("prio-l3-wins", {
      permission: { table: "users", userColumn: "id", where: "role = 'supervisor'" },
      notifiers: ["bob"],
      customTable: {
        name: "users",
        ddl: `CREATE TABLE users (id TEXT PRIMARY KEY, role TEXT)`,
        rows: [{ sql: `INSERT INTO users (id, role) VALUES (?, ?)`, params: ["bob", "member"] }],
      },
    });
    const res = await postNotify("prio-l3-wins", bobCookie);
    expect(res.status).toBe(403);
  });

  it("Level 2 回退：无 manifest.permission 但有 _localapp_notifiers 表走 Level 2", async () => {
    await setupPage("prio-l2-fallback", { notifiers: ["bob"] });
    const res = await postNotify("prio-l2-fallback", bobCookie);
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  it("Level 1 回退：既无 manifest.permission 也无 _localapp_notifiers 表走 Level 1（仅 owner）", async () => {
    await setupPage("prio-l1-fallback", {});
    const bobRes = await postNotify("prio-l1-fallback", bobCookie);
    expect(bobRes.status).toBe(403);
    const adminRes = await postNotify("prio-l1-fallback", adminCookie);
    expect(adminRes.status).not.toBe(401);
    expect(adminRes.status).not.toBe(403);
  });
});
