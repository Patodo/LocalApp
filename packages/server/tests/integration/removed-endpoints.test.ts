import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";

/**
 * 验证已移除的应用层端点统一返回 404。
 * 这些端点属于"REST CRUD + transitions + raw SQL + legacy upload"旧表面，
 * 由 restrict-app-api-to-named-sql 变更整体移除。
 * 应用层数据通道现由 named SQL（/queries/* 和 /mutations/*）唯一承担。
 */
describe("removed app endpoints return 404", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const userId = BOOTSTRAP_USER_ID;
  const pageName = "removed-endpoints-page";
  const resource = "todos";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    await createTestPage(app, userId, pageName);
  });

  afterAll(async () => {
    await stop();
  });

  function url(path: string): string {
    return `${baseUrl}/serve/${userId}/${pageName}/api/${path}`;
  }

  it("rejects REST CRUD list/create endpoints", async () => {
    const [getList, postCreate] = await Promise.all([
      fetch(url(resource)),
      fetch(url(resource), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "x" }),
      }),
    ]);
    expect(getList.status).toBe(404);
    expect(postCreate.status).toBe(404);
  });

  it("rejects REST CRUD count endpoint", async () => {
    const res = await fetch(url(`${resource}/count`));
    expect(res.status).toBe(404);
  });

  it("rejects REST CRUD get/update/delete endpoints", async () => {
    const [getOne, putOne, deleteOne] = await Promise.all([
      fetch(url(`${resource}/42`)),
      fetch(url(`${resource}/42`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "y" }),
      }),
      fetch(url(`${resource}/42`), { method: "DELETE" }),
    ]);
    expect(getOne.status).toBe(404);
    expect(putOne.status).toBe(404);
    expect(deleteOne.status).toBe(404);
  });

  it("rejects transition list/execute endpoints", async () => {
    const [listTrans, execTrans] = await Promise.all([
      fetch(url(`${resource}/42/transitions`)),
      fetch(url(`${resource}/42/transitions/approve`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
    ]);
    expect(listTrans.status).toBe(404);
    expect(execTrans.status).toBe(404);
  });

  it("rejects raw SQL endpoint", async () => {
    const res = await fetch(url("db/exec"), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ sql: "SELECT 1" }),
    });
    expect(res.status).toBe(404);
  });

  it("rejects legacy upload endpoint", async () => {
    const formData = new FormData();
    formData.append("file", new Blob(["x"]), "x.txt");
    const res = await fetch(url("upload"), {
      method: "POST",
      body: formData,
    });
    expect(res.status).toBe(404);
  });

  it("keeps app-scoped helper endpoints working", async () => {
    // /time 和 /_schemas 是 app 范围内的平台辅助端点
    // /me 和 /users 走平台级路由 /api/me 和 /api/users，不在 /serve/.../api/ 下
    const [time, schemas] = await Promise.all([
      fetch(url("time")),
      fetch(url("_schemas")),
    ]);
    expect(time.status).toBe(200);
    expect(schemas.status).toBe(200);
  });

  it("keeps named SQL endpoints reachable", async () => {
    // named SQL 端点保留；未声明的 name 返回 404 是正常的
    const res = await fetch(url("queries/$nonexistent.name"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: {} }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    // 错误信息应表明是 named SQL 未找到，而非"路由不匹配"
    expect(body.error).toMatch(/not found|backend/i);
  });
});
