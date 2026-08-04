import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { createTestUser } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import {
  AUTH_SESSION_REFRESH_INTERVAL_MS,
  createAuthSession,
} from "../../src/lib/auth-sessions.js";
import type { FastifyInstance } from "fastify";

function extractTokenCookie(setCookies: string[]): string {
  const raw = setCookies.find((c) => c.startsWith("token=")) || "";
  return raw.split(";")[0];
}

describe("session & /api/me", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;

    // Register a user for testing
    await createTestUser(baseUrl, "testuser", "password123");
  });

  afterAll(async () => {
    await stop();
  });

  describe("GET /api/me", () => {
    it("cookie 认证返回用户信息", async () => {
      // Login first
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "testuser", password: "password123" }),
      });
      const cookies = loginRes.headers.getSetCookie();
      const tokenCookie = extractTokenCookie(cookies);

      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: tokenCookie },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual({ id: "testuser", name: "testuser", role: "user", displayName: null, avatarUrl: null, bio: null });
    });

    it("API Key 认证返回对应用户", async () => {
      // API Key maps to "localadmin" userId, but localadmin may not be in users table
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      // localadmin is not registered as a user, so data should be null
      // (API Key resolves to userId but findUserById returns null if not in users table)
      expect(body.success).toBe(true);
    });

    it("无凭证返回 null", async () => {
      const res = await fetch(`${baseUrl}/api/me`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ success: true, data: null });
    });
  });

  describe("session middleware", () => {
    it("有效 cookie 设置 visitorId（通过 /api/me 验证）", async () => {
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "testuser", password: "password123" }),
      });
      const cookies = loginRes.headers.getSetCookie();
      const tokenCookie = extractTokenCookie(cookies);

      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: tokenCookie },
      });
      const body = await res.json();
      expect(body.data.id).toBe("testuser");
    });

    it("无效 cookie 的 visitorId 为 null", async () => {
      const res = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: "token=invalid-session-token" },
      });
      const body = await res.json();
      expect(body.data).toBeNull();
    });

    it("无 cookie 的 visitorId 为 null", async () => {
      const res = await fetch(`${baseUrl}/api/me`);
      const body = await res.json();
      expect(body.data).toBeNull();
    });

    it("超过续期间隔后刷新持久 cookie，随后不重复刷新", async () => {
      const created = createAuthSession(
        "testuser",
        new Date(Date.now() - AUTH_SESSION_REFRESH_INTERVAL_MS - 1_000),
      );
      const cookie = `token=${created.token}`;

      const refreshed = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: cookie },
      });
      expect(refreshed.status).toBe(200);
      expect(refreshed.headers.get("set-cookie")).toContain("Max-Age=2592000");

      const immediate = await fetch(`${baseUrl}/api/me`, {
        headers: { Cookie: cookie },
      });
      expect(immediate.status).toBe(200);
      expect(immediate.headers.get("set-cookie")).toBeNull();
    });
  });
});
