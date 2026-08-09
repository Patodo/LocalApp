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

  it("redirects unauthenticated dashboard requests and restricts system settings to administrators", async () => {
    const unauthenticated = await fetch(`${baseUrl}/my/studio`, { redirect: "manual" });
    expect(unauthenticated.status).toBe(302);
    expect(unauthenticated.headers.get("location")).toBe("/");

    const userCookie = await registerAndLogin(baseUrl, "control-user", "pass123456");
    const userSystem = await fetch(`${baseUrl}/my/system`, { redirect: "manual", headers: { cookie: userCookie } });
    expect(userSystem.status).toBe(302);
    expect(userSystem.headers.get("location")).toBe("/");
    expect((await fetch(`${baseUrl}/my/system.txt?_rsc=1`, { redirect: "manual", headers: { cookie: userCookie } })).status).toBe(302);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "localadmin", password: "localadmin" }),
    });
    const adminCookie = login.headers.getSetCookie().find((value) => value.startsWith("token="))?.split(";")[0];
    expect(adminCookie).toBeTruthy();
    const adminSystem = await fetch(`${baseUrl}/my/system`, { redirect: "manual", headers: { cookie: adminCookie } });
    expect(adminSystem.status).toBe(200);
    expect(adminSystem.headers.get("content-type")).toContain("text/html");
    expect((await fetch(`${baseUrl}/my/system.txt?_rsc=1`, { headers: { cookie: adminCookie } })).headers.get("content-type")).toContain("text/plain");
  });
});

describe("GET /setup", () => {
  it("serves setup only before the first administrator exists", async () => {
    const clean = await createTestServer({ cleanSetup: true });
    try {
      const beforeSetup = await fetch(`${clean.baseUrl}/setup`, { redirect: "manual" });
      expect(beforeSetup.status).toBe(200);
      expect(beforeSetup.headers.get("content-type")).toContain("text/html");
      expect((await fetch(`${clean.baseUrl}/setup.txt?_rsc=1`)).headers.get("content-type")).toContain("text/plain");

      const issued = clean.setupTokens.issue();
      const initialized = await fetch(`${clean.baseUrl}/api/setup/initialize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: issued.token, username: "owner", password: "correct-horse-battery" }),
      });
      expect(initialized.status).toBe(201);
      expect((await fetch(`${clean.baseUrl}/setup`, { redirect: "manual" })).status).toBe(404);
      expect((await fetch(`${clean.baseUrl}/setup.txt?_rsc=1`, { redirect: "manual" })).status).toBe(404);
    } finally {
      await clean.stop();
    }
  });
});
