import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { createTestUser, registerAndLogin } from "../helpers/createUser.js";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";

describe("auth routes", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    // Create a test user for login/logout tests
    await registerAndLogin(baseUrl, "alice", "pass123456");
  });

  afterAll(async () => {
    await stop();
  });

  describe("POST /api/auth/login", () => {
    it("登录成功设置 cookie 并返回用户信息", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "pass123456" }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ id: "alice", name: "alice", role: "user" });

      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("token=");
      expect(setCookie).toContain("HttpOnly");
      expect(setCookie).toContain("SameSite=Lax");
      expect(setCookie).toContain("Path=/");
      expect(setCookie).toContain("Max-Age=2592000");
      expect(setCookie).toContain("Expires=");

      const token = setCookie?.match(/^token=([^;]+)/)?.[1];
      expect(token).toBeTruthy();
      expect(token?.split(".")).toHaveLength(1);
    });

    it("用户名不存在返回 401", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nonexistent", password: "pass123456" }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Invalid credentials");
    });

    it("密码错误返回 401", async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "wrongpass" }),
      });
      expect(res.status).toBe(401);
    });

    it("生产环境设置 Secure cookie", async () => {
      const previousNodeEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        const res = await fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "alice", password: "pass123456" }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get("set-cookie")).toContain("Secure");
      } finally {
        process.env.NODE_ENV = previousNodeEnv;
      }
    });

    it("密码重置发生在校验期间时不签发旧密码会话", async () => {
      await createTestUser(baseUrl, "concurrentlogin", "oldpassword123");

      let releaseCompare!: () => void;
      let markCompareStarted!: () => void;
      const compareStarted = new Promise<void>((resolve) => {
        markCompareStarted = resolve;
      });
      const compareReleased = new Promise<void>((resolve) => {
        releaseCompare = resolve;
      });
      const originalCompare = bcrypt.compare.bind(bcrypt);
      let intercepted = false;
      const compareSpy = vi.spyOn(bcrypt, "compare").mockImplementation(async (password, hash) => {
        const valid = await originalCompare(password, hash);
        if (password === "oldpassword123" && !intercepted) {
          intercepted = true;
          markCompareStarted();
          await compareReleased;
        }
        return valid;
      });

      try {
        const loginPromise = fetch(`${baseUrl}/api/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "concurrentlogin", password: "oldpassword123" }),
        });
        await compareStarted;

        const reset = await fetch(`${baseUrl}/api/admin/reset-password`, {
          method: "POST",
          headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "concurrentlogin" }),
        });
        expect(reset.status).toBe(200);

        releaseCompare();
        const login = await loginPromise;
        expect(login.status).toBe(401);
        expect(login.headers.get("set-cookie")).toBeNull();
      } finally {
        releaseCompare();
        compareSpy.mockRestore();
      }
    });
  });

  describe("POST /api/auth/logout", () => {
    it("登出成功清除 cookie", async () => {
      // First login
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "alice", password: "pass123456" }),
      });
      const cookies = loginRes.headers.getSetCookie();

      // Then logout
      const res = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Cookie: cookies.find((c) => c.startsWith("token=")) || "" },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const staleCookie = (cookies.find((c) => c.startsWith("token=")) || "").split(";")[0];
      const meRes = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: staleCookie },
      });
      expect((await meRes.json()).data).toBeNull();
    });
  });
});
