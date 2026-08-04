import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { getDb, insertRequestLogs, insertPageViews, BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

describe("Request logging", () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  it("request_logs and page_views tables exist", () => {
    const db = getDb();
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('request_logs','page_views')");
    const names = tables[0]?.values?.map((r) => r[0]) ?? [];
    expect(names).toContain("request_logs");
    expect(names).toContain("page_views");
  });

  it("can insert and read request logs", () => {
    insertRequestLogs([
      { path: "/api/test", method: "GET", status: 200, durationMs: 50, userId: null, visitorId: null },
    ]);

    const db = getDb();
    const stmt = db.prepare("SELECT * FROM request_logs WHERE path = '/api/test'");
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    expect(rows.length).toBe(1);
    expect(rows[0].method).toBe("GET");
    expect(rows[0].status).toBe(200);
  });

  it("can insert and read page views", () => {
    insertPageViews([
      { pagePath: "/admin/my-page", visitorId: BOOTSTRAP_USER_ID },
    ]);

    const db = getDb();
    const stmt = db.prepare("SELECT * FROM page_views WHERE page_path = '/admin/my-page'");
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();

    expect(rows.length).toBe(1);
    expect(rows[0].visitor_id).toBe(BOOTSTRAP_USER_ID);
  });

  it("analytics API returns data after direct log insertion", async () => {
    for (let i = 0; i < 5; i++) {
      insertRequestLogs([
        { path: "/api/analytics-test", method: "GET", status: 200, durationMs: 30 + i, userId: null, visitorId: null },
      ]);
    }

    const res = await fetch(`${baseUrl}/api/admin/analytics/overview`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.totalRequests).toBeGreaterThanOrEqual(5);
  });
});
