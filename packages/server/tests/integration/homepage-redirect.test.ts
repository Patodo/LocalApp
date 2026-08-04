import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";
import type { FastifyInstance } from "fastify";

describe("GET / homepage", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  // unify-auth-modals 后首页不再服务端重定向到 /login，登录改为客户端模态框
  it("serves homepage HTML to unauthenticated visitors (login is client-side modal)", async () => {
    const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("serves homepage HTML when logged in", async () => {
    const cookie = await registerAndLogin(baseUrl, "homeuser", "pass123456");

    const res = await fetch(`${baseUrl}/`, {
      redirect: "manual",
      headers: { cookie },
    });
    // Logged-in users get the homepage HTML (not a redirect)
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});
