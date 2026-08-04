import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { createTestUser, registerAndLogin } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";

describe("Group API", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let apiKey: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    apiKey = getTestApiKey();
  });

  afterAll(async () => {
    await stop();
  });

  // ── Private group CRUD ──

  it("创建私有群组返回 201", async () => {
    const res = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ name: "test-group", description: "A test group" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("test-group");
    expect(body.data.system).toBe(false);
    expect(body.data.creatorId).toBe(BOOTSTRAP_USER_ID);
  });

  it("群组名重复返回 409", async () => {
    const res = await fetch(`${baseUrl}/api/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ name: "test-group" }),
    });
    expect(res.status).toBe(409);
  });

  it("查询群组列表包含创建的群组", async () => {
    const res = await fetch(`${baseUrl}/api/groups`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    const names = body.data.map((g: any) => g.name);
    expect(names).toContain("test-group");
    expect(names).toContain("everyone");
    const testGroup = body.data.find((g: any) => g.name === "test-group");
    expect(testGroup.isCreator).toBe(true);
    expect(testGroup.memberCount).toBeGreaterThanOrEqual(1);
  });

  it("查询群组详情包含成员列表", async () => {
    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const testGroup = listBody.data.find((g: any) => g.name === "test-group");

    const res = await fetch(`${baseUrl}/api/groups/${testGroup.id}`, { headers: { "X-API-Key": apiKey } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.members.length).toBeGreaterThanOrEqual(1);
    expect(body.data.isCreator).toBe(true);
    const memberNames = body.data.members.map((m: any) => m.name);
    expect(memberNames).toContain(BOOTSTRAP_USER_ID);
  });

  it("修改群组属性", async () => {
    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const testGroup = listBody.data.find((g: any) => g.name === "test-group");

    const res = await fetch(`${baseUrl}/api/groups/${testGroup.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ description: "Updated description" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.description).toBe("Updated description");
  });

  // ── Member management ──

  it("批量添加成员", async () => {
    // Register a test user first
    await createTestUser(baseUrl, "testuser1", "password123");

    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const testGroup = listBody.data.find((g: any) => g.name === "test-group");

    const res = await fetch(`${baseUrl}/api/groups/${testGroup.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ userIds: ["testuser1"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const memberIds = body.data.map((m: any) => m.id);
    expect(memberIds).toContain("testuser1");
  });

  it("批量移除成员", async () => {
    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const testGroup = listBody.data.find((g: any) => g.name === "test-group");

    const res = await fetch(`${baseUrl}/api/groups/${testGroup.id}/members/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ userIds: ["testuser1"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const memberIds = body.data.map((m: any) => m.id);
    expect(memberIds).not.toContain("testuser1");
  });

  it("创建者不能移除自己", async () => {
    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const testGroup = listBody.data.find((g: any) => g.name === "test-group");

    const res = await fetch(`${baseUrl}/api/groups/${testGroup.id}/members/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ userIds: [BOOTSTRAP_USER_ID] }),
    });
    expect(res.status).toBe(400);
  });

  // ── Delete group ──

  it("解散私有群组", async () => {
    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const testGroup = listBody.data.find((g: any) => g.name === "test-group");

    const res = await fetch(`${baseUrl}/api/groups/${testGroup.id}`, {
      method: "DELETE",
      headers: { "X-API-Key": apiKey },
    });
    expect(res.status).toBe(200);
  });

  // ── Auth checks ──

  it("未登录用户返回 401", async () => {
    const res = await fetch(`${baseUrl}/api/groups`);
    expect(res.status).toBe(401);
  });

  it("系统群组不可删除", async () => {
    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const everyone = listBody.data.find((g: any) => g.name === "everyone");

    const res = await fetch(`${baseUrl}/api/groups/${everyone.id}`, {
      method: "DELETE",
      headers: { "X-API-Key": apiKey },
    });
    expect(res.status).toBe(403);
  });

  // ── System group: everyone auto-join ──

  it("everyone 群组包含所有用户", async () => {
    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const everyone = listBody.data.find((g: any) => g.name === "everyone");
    expect(everyone).toBeDefined();
    expect(everyone.system).toBe(true);
    expect(everyone.memberCount).toBeGreaterThanOrEqual(1);
  });

  it("新注册用户自动加入 everyone", async () => {
    await createTestUser(baseUrl, "newjoiner", "password123");

    const listRes = await fetch(`${baseUrl}/api/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const everyone = listBody.data.find((g: any) => g.name === "everyone");

    const detailRes = await fetch(`${baseUrl}/api/groups/${everyone.id}`, { headers: { "X-API-Key": apiKey } });
    const detail = await detailRes.json();
    const memberIds = detail.data.members.map((m: any) => m.id);
    expect(memberIds).toContain("newjoiner");
  });
});

describe("Admin Group API", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let apiKey: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    apiKey = getTestApiKey();
  });

  afterAll(async () => {
    await stop();
  });

  it("GET /api/admin/groups 返回系统群组", async () => {
    const res = await fetch(`${baseUrl}/api/admin/groups`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    const names = body.data.map((g: any) => g.name);
    expect(names).toContain("everyone");
  });

  it("POST /api/admin/groups 创建系统群组", async () => {
    const res = await fetch(`${baseUrl}/api/admin/groups`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ name: "tech-team", description: "Tech department" }),
    });
    if (res.status !== 201) {
      const body = await res.text();
      console.log("ADMIN CREATE GROUP RESPONSE:", res.status, body);
    }
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.system).toBe(true);
  });

  it("PUT /api/admin/groups/:id 修改系统群组", async () => {
    const listRes = await fetch(`${baseUrl}/api/admin/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const tech = listBody.data.find((g: any) => g.name === "tech-team");

    const res = await fetch(`${baseUrl}/api/admin/groups/${tech.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ description: "Tech dept updated" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.description).toBe("Tech dept updated");
  });

  it("POST /api/admin/groups/:id/members 添加成员", async () => {
    await createTestUser(baseUrl, "adminuser1", "password123");

    const listRes = await fetch(`${baseUrl}/api/admin/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const tech = listBody.data.find((g: any) => g.name === "tech-team");

    const res = await fetch(`${baseUrl}/api/admin/groups/${tech.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ userIds: ["adminuser1"] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.data.map((m: any) => m.id);
    expect(ids).toContain("adminuser1");
  });

  it("POST /api/admin/groups/:id/members/remove 移除成员", async () => {
    const listRes = await fetch(`${baseUrl}/api/admin/groups`, { headers: { "X-API-Key": apiKey } });
    const listBody = await listRes.json();
    const tech = listBody.data.find((g: any) => g.name === "tech-team");

    const res = await fetch(`${baseUrl}/api/admin/groups/${tech.id}/members/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ userIds: ["adminuser1"] }),
    });
    expect(res.status).toBe(200);
  });
});

describe("Group ACL", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let apiKey: string;
  let ownerCookie: string;
  let visitorCookie: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    apiKey = getTestApiKey();

    // Register two users: owner and visitor
    ownerCookie = await registerAndLogin(baseUrl, "aclowner", "password123");
    visitorCookie = await registerAndLogin(baseUrl, "aclvisitor", "password123");
  });

  afterAll(async () => {
    await stop();
  });

  it("ACL 引用群组时群组成员可以通过", async () => {
    const { createTestPage } = await import("./helpers.js");
    const fs = await import("node:fs");
    const path = await import("node:path");

    // Both aclowner and aclvisitor are in "everyone" group

    await createTestPage(app, "aclowner", "acl-group-page");
    const metaPath = path.join(app.config.dataDir, "aclowner", "acl-group-page", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.pageAccess = { level: "acl", acl: ["group:everyone"] };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // visitor is NOT owner but IS in everyone group → should pass
    const res = await fetch(`${baseUrl}/aclowner/acl-group-page`, {
      headers: { cookie: visitorCookie },
    });
    expect(res.status).toBe(200);
  });

  it("ACL 引用不存在的群组时非成员被拒", async () => {
    const { createTestPage } = await import("./helpers.js");
    const fs = await import("node:fs");
    const path = await import("node:path");

    await createTestPage(app, "aclowner", "acl-nogroup-page");
    const metaPath = path.join(app.config.dataDir, "aclowner", "acl-nogroup-page", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.pageAccess = { level: "acl", acl: ["group:nonexistent-group"] };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // visitor is NOT owner and NOT in nonexistent-group → 403
    const res = await fetch(`${baseUrl}/aclowner/acl-nogroup-page`, {
      headers: { cookie: visitorCookie },
    });
    expect(res.status).toBe(403);
  });

  it("纯用户 ID 的 ACL 行为不变", async () => {
    const { createTestPage } = await import("./helpers.js");
    const fs = await import("node:fs");
    const path = await import("node:path");

    await createTestPage(app, "aclowner", "acl-user-page");
    const metaPath = path.join(app.config.dataDir, "aclowner", "acl-user-page", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.pageAccess = { level: "acl", acl: ["aclvisitor"] };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    // visitor is in ACL as user ID → should pass
    const res = await fetch(`${baseUrl}/aclowner/acl-user-page`, {
      headers: { cookie: visitorCookie },
    });
    expect(res.status).toBe(200);
  });

  it("ACL 混用用户 ID 和群组引用", async () => {
    const { createTestPage } = await import("./helpers.js");
    const fs = await import("node:fs");
    const path = await import("node:path");

    await createTestPage(app, "aclowner", "acl-mix-page");
    const metaPath = path.join(app.config.dataDir, "aclowner", "acl-mix-page", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    meta.pageAccess = { level: "acl", acl: ["aclvisitor", "group:everyone"] };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const res = await fetch(`${baseUrl}/aclowner/acl-mix-page`, {
      headers: { cookie: visitorCookie },
    });
    expect(res.status).toBe(200);
  });
});
