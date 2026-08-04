import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";

describe("platform shell", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const pageOwner = BOOTSTRAP_USER_ID;
  const pageName = "shell-test";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    await createTestPage(app, pageOwner, pageName);
  });

  afterAll(async () => { await stop(); });

  it("未登录访问页面返回 Next.js Shell HTML（登录 UI 由客户端渲染）", async () => {
    const res = await fetch(`${baseUrl}/${pageOwner}/${pageName}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("_next/static/chunks");
    expect(html).toContain(pageName);
    expect(html).toContain(pageOwner);
  });

  it("已登录访问页面同样返回 Next.js Shell HTML（用户信息由客户端从 cookie 读取）", async () => {
    const cookie = await registerAndLogin(baseUrl, "shelluser", "password123");

    const res = await fetch(`${baseUrl}/${pageOwner}/${pageName}`, {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("_next/static/chunks");
    expect(html).toContain(pageName);
  });

  it("/login 页面已移除（返回 404，登录改为全局模态框）", async () => {
    const res = await fetch(`${baseUrl}/login`);
    expect(res.status).toBe(404);
  });

  it("/register 页面已移除（返回 404）", async () => {
    const res = await fetch(`${baseUrl}/register`);
    expect(res.status).toBe(404);
  });
});
