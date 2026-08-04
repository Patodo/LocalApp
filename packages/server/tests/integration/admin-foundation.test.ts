import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { registerAndLogin, createTestUser } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

describe("admin foundation", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => { await stop(); });

  it("非 admin 用户访问 /api/admin/* 返回 403", async () => {
    // Register a normal user and get API key
    const userCookie = await registerAndLogin(baseUrl, "normaluser", "password123");

    // Try to access admin stats
    const res = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { Cookie: userCookie },
    });
    expect(res.status).toBe(403);
  });

  it("未认证访问 /api/admin/* 返回 401", async () => {
    const res = await fetch(`${baseUrl}/api/admin/stats`);
    expect(res.status).toBe(401);
  });

  it("admin (API key) 可以访问 /api/admin/stats", async () => {
    const res = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.users).toBeDefined();
    expect(json.data.pages).toBeDefined();
    expect(json.data.schemas).toBeDefined();
  });

  it("GET /api/admin/users 返回用户列表", async () => {
    // Register a user to ensure there's at least one
    await registerAndLogin(baseUrl, "testuser1", "password123");

    const res = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.pagination).toBeDefined();
    expect(json.pagination.total).toBeGreaterThanOrEqual(1);
    // Each user should have role field
    for (const user of json.data) {
      expect(user.role).toBeDefined();
      expect(["admin", "user"]).toContain(user.role);
      expect(user.pages).toBeDefined();
      expect(user.storageUsed).toBeDefined();
    }
  });

  it("GET /api/admin/users/:id 返回用户详情", async () => {
    const res = await fetch(`${baseUrl}/api/admin/users/testuser1`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.id).toBe("testuser1");
    expect(json.data.role).toBe("user");
    expect(Array.isArray(json.data.pages)).toBe(true);
  });

  it("DELETE /api/admin/users/:id 删除用户", async () => {
    // Register a user to delete
    await registerAndLogin(baseUrl, "todelete", "password123");

    const res = await fetch(`${baseUrl}/api/admin/users/todelete`, {
      method: "DELETE",
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.deleted).toBe(true);
    expect(json.data.id).toBe("todelete");

    // Verify user is gone
    const checkRes = await fetch(`${baseUrl}/api/admin/users/todelete`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(checkRes.status).toBe(404);
  });

  it("DELETE /api/admin/users 不能删除自己", async () => {
    // The bootstrap admin has user_id "localadmin"
    // But "localadmin" may not be in the users table, so register one
    // Actually, let's test with a normal user trying to delete via admin API
    // The check is req.userId === id, where req.userId comes from the API key
    // Bootstrap key maps to "localadmin", so we can't delete "localadmin"
    const res = await fetch(`${baseUrl}/api/admin/users/${BOOTSTRAP_USER_ID}`, {
      method: "DELETE",
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(400);
  });

  it("GET /api/admin/pages 返回全局页面列表", async () => {
    // Create some pages
    createTestPage(app, BOOTSTRAP_USER_ID, "test-page-1");
    createTestPage(app, BOOTSTRAP_USER_ID, "test-page-2");

    const res = await fetch(`${baseUrl}/api/admin/pages`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.pagination).toBeDefined();
    expect(json.data.length).toBeGreaterThanOrEqual(2);
  });

  it("GET /api/admin/pages 支持 userId 过滤", async () => {
    const res = await fetch(`${baseUrl}/api/admin/pages?userId=${BOOTSTRAP_USER_ID}`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    for (const page of json.data) {
      expect(page.userId).toBe(BOOTSTRAP_USER_ID);
    }
  });

  it("GET /api/admin/pages/:userId/:name 返回页面详情", async () => {
    const res = await fetch(`${baseUrl}/api/admin/pages/${BOOTSTRAP_USER_ID}/test-page-1`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.name).toBe("test-page-1");
    expect(json.data.userId).toBe(BOOTSTRAP_USER_ID);
    expect(json.data.versions).toBeDefined();
  });

  it("DELETE /api/admin/pages/:userId/:name 删除页面", async () => {
    const res = await fetch(`${baseUrl}/api/admin/pages/${BOOTSTRAP_USER_ID}/test-page-2`, {
      method: "DELETE",
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.deleted).toBe(true);

    // Verify page is gone
    const checkRes = await fetch(`${baseUrl}/api/admin/pages/${BOOTSTRAP_USER_ID}/test-page-2`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(checkRes.status).toBe(404);
  });

  it("GET /api/admin/stats 返回正确的聚合数据", async () => {
    const res = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.users.total).toBeGreaterThanOrEqual(1);
    expect(json.data.pages.total).toBeGreaterThanOrEqual(1);
    expect(json.data.pages.totalSize).toBeDefined();
    expect(json.data.pages.totalBytes).toBeDefined();
    expect(json.data.schemas.total).toBeDefined();
    expect(Array.isArray(json.data.recentDeploys)).toBe(true);
  });

  it("注册返回 role 字段", async () => {
    const { apiKey } = await createTestUser(baseUrl, "roletest", "password123");
    expect(apiKey).toBeDefined();

    // Administrator provisioning creates users with role=user.
    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: { "X-API-Key": apiKey },
    });
    const meJson = await meRes.json();
    expect(meJson.data.role).toBe("user");
  });

  it("登录返回 role 字段", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "roletest", password: "password123" }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.role).toBe("user");
  });

  it("/api/me 返回 role 字段", async () => {
    const cookie = await registerAndLogin(baseUrl, "metest", "password123");
    const res = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.role).toBe("user");
  });
});
