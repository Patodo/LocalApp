import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";

function updateMeta(dataDir: string, userId: string, pageName: string, updater: (meta: any) => void) {
  const metaPath = path.join(dataDir, userId, pageName, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
  updater(meta);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
}

describe("serve routes: access control integration", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  // API Key maps to "localadmin", so page must be under "localadmin"
  const pageOwner = BOOTSTRAP_USER_ID;
  const pageName = "protected-app";
  const resource = "items";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;

    await createTestPage(app, pageOwner, pageName);

    // Create schema via API (uses API Key → admin)
    await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        pageName,
        name: resource,
        fields: { title: { type: "string", constraints: { required: true } } },
      }),
    });

    // Register test users
    await registerAndLogin(baseUrl, "bob", "password123");
    await registerAndLogin(baseUrl, "carol", "password123");
  });

  afterAll(async () => {
    await stop();
  });

  describe("page-level access control", () => {
    afterEach(() => {
      // Reset to public after each test
      updateMeta(dataDir, pageOwner, pageName, (meta) => { delete meta.pageAccess; });
    });

    it("public: 未登录用户可访问", async () => {
      const res = await fetch(`${baseUrl}/${pageOwner}/${pageName}`);
      expect(res.status).toBe(200);
    });

    it("authenticated: 未登录返回 401", async () => {
      updateMeta(dataDir, pageOwner, pageName, (meta) => { meta.pageAccess = { level: "authenticated" }; });
      const res = await fetch(`${baseUrl}/${pageOwner}/${pageName}`);
      expect(res.status).toBe(401);
    });

    it("authenticated: 已登录用户可访问", async () => {
      updateMeta(dataDir, pageOwner, pageName, (meta) => { meta.pageAccess = { level: "authenticated" }; });
      const cookie = await registerAndLogin(baseUrl, "dave", "password123");
      const res = await fetch(`${baseUrl}/${pageOwner}/${pageName}`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(200);
    });

    it("owner: 已登录非所有者返回 403", async () => {
      updateMeta(dataDir, pageOwner, pageName, (meta) => { meta.pageAccess = { level: "owner" }; });
      const cookie = await registerAndLogin(baseUrl, "eve", "password123");
      const res = await fetch(`${baseUrl}/${pageOwner}/${pageName}`, {
        headers: { Cookie: cookie },
      });
      expect(res.status).toBe(403);
    });

    it("受保护页面的静态文件也被拦截", async () => {
      updateMeta(dataDir, pageOwner, pageName, (meta) => { meta.pageAccess = { level: "authenticated" }; });
      const res = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/`);
      expect(res.status).toBe(401);
    });
  });

  // route-level access control（schema.routeAccess）相关测试已随 REST CRUD 端点
  // 整体移除（restrict-app-api-to-named-sql 变更）。routeAccess 字段在 schema
  // 层仍可声明，但服务端不再据此执行任何 HTTP 路由级访问控制——named SQL 的
  // access 字段是新的访问控制入口。
});
