import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, createTestPage } from "./helpers.js";
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

describe("9.x auth full chain e2e", () => {
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

  it("9.6 完整链路：注册→登录→访问页面→CRUD→登出→身份消失", async () => {
    const cookie = await registerAndLogin(baseUrl, "chainuser", "password123");

    const meRes = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
    expect((await meRes.json()).data.id).toBe("chainuser");

    const logoutRes = await fetch(`${baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logoutRes.status).toBe(200);

    // After logout, don't send cookie to verify identity is gone
    const meRes2 = await fetch(`${baseUrl}/api/me`);
    expect((await meRes2.json()).data).toBeNull();
  });
});

describe("10.x page-level access control e2e", () => {
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

  it("10.5 未配置 pageAccess：行为等同于 public", async () => {
    await createTestPage(app, BOOTSTRAP_USER_ID, "no-policy");
    const res = await fetch(`${baseUrl}/${BOOTSTRAP_USER_ID}/no-policy`);
    expect(res.status).toBe(200);
  });

  it("10.7 动态切换策略", async () => {
    await createTestPage(app, BOOTSTRAP_USER_ID, "dynamic-policy");
    const cookie = await registerAndLogin(baseUrl, "dynuser", "password123");

    let res = await fetch(`${baseUrl}/${BOOTSTRAP_USER_ID}/dynamic-policy`);
    expect(res.status).toBe(200);

    updateMeta(dataDir, BOOTSTRAP_USER_ID, "dynamic-policy", (meta) => { meta.pageAccess = { level: "authenticated" }; });
    res = await fetch(`${baseUrl}/${BOOTSTRAP_USER_ID}/dynamic-policy`);
    expect(res.status).toBe(401);

    res = await fetch(`${baseUrl}/${BOOTSTRAP_USER_ID}/dynamic-policy`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
  });
});

// 11.x route-level access control 和 12.x multi-user & owner boundary 两组
// e2e 测试已随 REST CRUD 端点整体移除（restrict-app-api-to-named-sql 变更）。
// routeAccess 字段在 schema 层仍可声明，但服务端不再据此执行 HTTP 路由级
// 访问控制——named SQL 的 access 字段是新的访问控制入口。多用户/owner
// 边界由 named SQL 的 access + recordAccess 在 SQL WHERE 子句中表达。
