import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import type { FastifyInstance } from "fastify";
import { getDb } from "../../src/lib/meta-sqlite.js";
import { insertRequestLogs, insertPageViews, cleanOldLogs } from "../../src/lib/meta-sqlite.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

async function loginAdminUser(baseUrl: string): Promise<string> {
  await registerAndLogin(baseUrl, "analyticsadmin", "admin123");
  const db = getDb();
  db.run("UPDATE users SET role = 'admin' WHERE id = 'analyticsadmin'");
  return registerAndLogin(baseUrl, "analyticsadmin", "admin123");
}

describe("admin analytics", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
  });

  afterAll(async () => { await stop(); });

  it("request_logs 有记录", async () => {
    // Make a request that goes through onResponse hook
    await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { "X-API-Key": getTestApiKey() },
    });

    // Flush: the buffer writes on interval, force it by inserting directly
    insertRequestLogs([{
      path: "/api/admin/stats",
      method: "GET",
      status: 200,
      durationMs: 50,
      userId: BOOTSTRAP_USER_ID,
      visitorId: null,
    }]);

    const db = getDb();
    const stmt = db.prepare("SELECT COUNT(*) as c FROM request_logs");
    stmt.step();
    const count = (stmt.getAsObject() as { c: number }).c;
    stmt.free();
    expect(count).toBeGreaterThan(0);
  });

  it("page_views 记录 Shell 页面访问", async () => {
    createTestPage(app, BOOTSTRAP_USER_ID, "analytics-test-page");
    insertPageViews([{
      pagePath: "/admin/analytics-test-page",
      visitorId: "test-visitor",
    }]);

    const db = getDb();
    const stmt = db.prepare("SELECT page_path, visitor_id FROM page_views WHERE page_path = '/admin/analytics-test-page'");
    stmt.step();
    const row = stmt.getAsObject() as { page_path: string; visitor_id: string };
    stmt.free();
    expect(row.page_path).toBe("/admin/analytics-test-page");
    expect(row.visitor_id).toBe("test-visitor");
  });

  it("analytics overview API 返回正确的聚合数据", async () => {
    const res = await fetch(`${baseUrl}/api/admin/analytics/overview?period=7d`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.period).toBe("7d");
    expect(typeof json.data.totalRequests).toBe("number");
    expect(typeof json.data.uniqueVisitors).toBe("number");
    expect(typeof json.data.pageViews).toBe("number");
    expect(typeof json.data.avgResponseMs).toBe("number");
    expect(typeof json.data.errorRate).toBe("number");
  });

  it("analytics trends API 返回趋势数据", async () => {
    const res = await fetch(`${baseUrl}/api/admin/analytics/trends?range=7d`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
  });

  it("analytics pages API 返回页面排行", async () => {
    const res = await fetch(`${baseUrl}/api/admin/analytics/pages?period=7d&limit=10`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    if (json.data.length > 0) {
      expect(json.data[0].pagePath).toBeDefined();
      expect(json.data[0].views).toBeDefined();
      expect(json.data[0].uniqueVisitors).toBeDefined();
    }
  });

  it("过期数据清理", async () => {
    // Insert an old record
    const db = getDb();
    db.run("INSERT INTO request_logs (path, method, status, duration_ms, user_id, visitor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now', '-60 days'))",
      ["/test/old", "GET", 200, 10, null, null]);
    db.run("INSERT INTO page_views (page_path, visitor_id, created_at) VALUES (?, ?, datetime('now', '-60 days'))",
      ["/test/old-page", null]);

    // Count before
    const beforeStmt = db.prepare("SELECT COUNT(*) as c FROM request_logs WHERE path = '/test/old'");
    beforeStmt.step();
    const beforeLogs = (beforeStmt.getAsObject() as { c: number }).c;
    beforeStmt.free();
    expect(beforeLogs).toBe(1);

    cleanOldLogs(30);

    // Count after
    const afterStmt = db.prepare("SELECT COUNT(*) as c FROM request_logs WHERE path = '/test/old'");
    afterStmt.step();
    const afterLogs = (afterStmt.getAsObject() as { c: number }).c;
    afterStmt.free();
    expect(afterLogs).toBe(0);

    const afterViewStmt = db.prepare("SELECT COUNT(*) as c FROM page_views WHERE page_path = '/test/old-page'");
    afterViewStmt.step();
    const afterViews = (afterViewStmt.getAsObject() as { c: number }).c;
    afterViewStmt.free();
    expect(afterViews).toBe(0);
  });

  it("非 admin 不能访问 analytics API", async () => {
    const cookie = await registerAndLogin(baseUrl, "analyticsviewer", "password123");
    const res = await fetch(`${baseUrl}/api/admin/analytics/overview`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(403);
  });
});
