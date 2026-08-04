import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage, registerUser, getTestApiKey } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import { getConnection, getDbPath } from "../../src/lib/app-db.js";

function buildUpload(parts: { name: string; value: string }[]): { body: string; contentType: string } {
  const boundary = "----NotifyIntegrationBoundary";
  let body = "";
  for (const p of parts) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${p.name}"\r\n\r\n${p.value}\r\n`;
  }
  body += `--${boundary}\r\nContent-Disposition: form-data; name="filepath_0"\r\n\r\nindex.html\r\n`;
  body += `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="index.html"\r\nContent-Type: application/octet-stream\r\n\r\n<h1>hi</h1>\r\n`;
  body += `--${boundary}--\r\n`;
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

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

describe("notify publish 集成测试（Level 0/1/2/3 对比 + 完整流程）", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let baseUrlHost: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
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

  async function setupLevelPage(
    pageName: string,
    notifyConfig: Record<string, unknown> | undefined,
    opts: { notifiers?: string[]; customTable?: { ddl: string; rows: Array<{ sql: string; params: any[] }> } } = {},
  ) {
    await createTestPage(app, owner, pageName);
    // 通过 multipart upload 模拟 CLI 上传 manifest（验证 manifest → meta 贯通）
    const { body, contentType } = buildUpload([
      { name: "name", value: pageName },
      ...(notifyConfig ? [{ name: "notifyConfig", value: JSON.stringify(notifyConfig) }] : []),
    ]);
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": contentType },
      body,
    });
    if (!res.ok) throw new Error(`upload ${pageName} failed: ${await res.text()}`);

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

  it("Level 0：notify.enabled=false 时端点不存在（404）", async () => {
    await setupLevelPage("integration-l0", { enabled: false });
    const adminRes = await postNotify("integration-l0", adminCookie);
    expect(adminRes.status).toBe(404);
  });

  it("Level 1：notify.enabled=true 无 permission 时仅 owner 通过，bob 拒绝", async () => {
    await setupLevelPage("integration-l1", { enabled: true });
    const adminRes = await postNotify("integration-l1", adminCookie);
    expect(adminRes.status).not.toBe(401);
    expect(adminRes.status).not.toBe(403);
    const bobRes = await postNotify("integration-l1", bobCookie);
    expect(bobRes.status).toBe(403);
  });

  it("Level 2：bob 在 _localapp_notifiers 表中通过，charlie 不在则拒绝", async () => {
    await registerUser(baseUrl, "charlie");
    const charlieCookie = await loginAndGetCookie(baseUrl, "charlie", "test123456");
    await setupLevelPage("integration-l2", { enabled: true }, { notifiers: ["bob"] });
    const bobRes = await postNotify("integration-l2", bobCookie);
    expect(bobRes.status).not.toBe(403);
    const charlieRes = await postNotify("integration-l2", charlieCookie);
    expect(charlieRes.status).toBe(403);
  });

  it("Level 3：manifest.permission 配置 role='supervisor'，仅命中用户通过", async () => {
    await registerUser(baseUrl, "supervisor-user");
    const supervisorCookie = await loginAndGetCookie(baseUrl, "supervisor-user", "test123456");
    await setupLevelPage(
      "integration-l3",
      { enabled: true, permission: { table: "app_users", userColumn: "id", where: "role = 'supervisor'" } },
      {
        customTable: {
          ddl: `CREATE TABLE app_users (id TEXT PRIMARY KEY, role TEXT)`,
          rows: [
            { sql: `INSERT INTO app_users (id, role) VALUES (?, ?)`, params: ["supervisor-user", "supervisor"] },
            { sql: `INSERT INTO app_users (id, role) VALUES (?, ?)`, params: ["bob", "member"] },
          ],
        },
      },
    );
    const supervisorRes = await postNotify("integration-l3", supervisorCookie);
    expect(supervisorRes.status).not.toBe(403);
    const bobRes = await postNotify("integration-l3", bobCookie);
    expect(bobRes.status).toBe(403);
  });

  it("完整流程：manifest 配置 → 上传 → JS 模拟 notify → 通知入库", async () => {
    const fullPage = "integration-full-flow";
    await setupLevelPage(fullPage, { enabled: true });

    // bob 订阅该 app
    const db = (await import("../../src/lib/meta-sqlite.js")).getDb();
    db.run(
      `INSERT OR IGNORE INTO subscriptions (user_id, app_owner, app_name, level, created_at) VALUES (?, ?, ?, ?, ?)`,
      ["bob", owner, fullPage, "all", new Date().toISOString()],
    );

    // JS 模拟调用 notify（owner 发起）
    const res = await postNotify(fullPage, adminCookie);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.delivered).toBe(1);
    expect(json.ids.length).toBe(1);

    // 校验入库
    const stmt = db.prepare(`SELECT * FROM notifications WHERE app_owner = ? AND app_name = ?`);
    stmt.bind([owner, fullPage]);
    const rows: any[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    expect(rows.length).toBe(1);
    expect(rows[0].user_id).toBe("bob");
    expect(rows[0].title).toBe("x");
  });
});
