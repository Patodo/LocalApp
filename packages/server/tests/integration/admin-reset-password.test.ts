import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestServer,
  getAppUrl,
  getTestApiKey,
} from "./helpers.js";
import { createTestUser } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

function extractTokenCookie(response: Response): string {
  return (response.headers.getSetCookie().find((cookie) => cookie.startsWith("token=")) || "").split(";")[0];
}

describe("Admin Reset Password", () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  describe("POST /api/admin/reset-password", () => {
    it("returns a random one-time password and keeps existing API keys valid", async () => {
      const { apiKey: userApiKey } = await createTestUser(baseUrl, "resetuser", "password123");

      const res = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "resetuser" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toEqual({
        temporaryPassword: expect.any(String),
        mustChangePassword: true,
      });
      expect(data.data.temporaryPassword.length).toBeGreaterThanOrEqual(22);
      expect(data.data.temporaryPassword).not.toBe("localapp");

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "resetuser",
          password: data.data.temporaryPassword,
        }),
      });
      expect(loginRes.status).toBe(403);
      const loginData = await loginRes.json();
      expect(loginData.code).toBe("MUST_CHANGE_PASSWORD");

      const meRes = await fetch(`${baseUrl}/api/me`, {
        headers: { "X-API-Key": userApiKey },
      });
      expect(meRes.status).toBe(200);
      expect((await meRes.json()).data.name).toBe("resetuser");
    });

    it("revokes every existing session for the reset user", async () => {
      const { cookie: firstCookie } = await createTestUser(baseUrl, "resetsessions", "password123");
      const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "resetsessions", password: "password123" }),
      });
      const secondCookie = extractTokenCookie(secondLogin);

      const reset = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "resetsessions" }),
      });
      expect(reset.status).toBe(200);
      expect(reset.headers.get("set-cookie")).toBeNull();

      for (const cookie of [firstCookie, secondCookie]) {
        const meRes = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
        expect((await meRes.json()).data).toBeNull();
      }
    });

    it("rejects non-admin with 403", async () => {
      // Register a non-admin user
      await createTestUser(baseUrl, "nonadmin1", "password123");

      // Create API key for non-admin
      const keyRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "nonadmin1" }),
      });
      const { data: keyData } = await keyRes.json();
      const otherKey = keyData.key;

      const res = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": otherKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "someone" }),
      });
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated with 401", async () => {
      const res = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "someone" }),
      });
      expect(res.status).toBe(401);
    });

    it("returns 404 for non-existent user", async () => {
      const res = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "nonexistent_user_xyz" }),
      });
      expect(res.status).toBe(404);
    });

    // Spec: Admin 管理操作不再限制 provider — admin 可重置任意用户密码
    it("resets admin user password (no provider rejection)", async () => {
      const res = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: BOOTSTRAP_USER_ID }),
      });
      expect(res.status).toBe(200);
    });
  });

  describe("Login with must_change_password", () => {
    it("rejects login and returns MUST_CHANGE_PASSWORD code", async () => {
      // Register and reset
      await createTestUser(baseUrl, "mustchange1", "password123");
      const resetRes = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "mustchange1" }),
      });
      const resetPassword = (await resetRes.json()).data.temporaryPassword;

      // Old password no longer works
      const oldLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "mustchange1", password: "password123" }),
      });
      expect(oldLogin.status).toBe(401);

      // The one-time reset password triggers MUST_CHANGE_PASSWORD.
      const newLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "mustchange1", password: resetPassword }),
      });
      expect(newLogin.status).toBe(403);
      const data = await newLogin.json();
      expect(data.code).toBe("MUST_CHANGE_PASSWORD");
    });
  });

  describe("POST /api/auth/force-change-password", () => {
    it("revokes old sessions and returns a replacement session", async () => {
      const { cookie: firstCookie } = await createTestUser(baseUrl, "forcesessionuser", "password123");
      const secondLogin = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "forcesessionuser", password: "password123" }),
      });
      const secondCookie = extractTokenCookie(secondLogin);

      const change = await fetch(`${baseUrl}/api/auth/force-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "forcesessionuser",
          oldPassword: "password123",
          newPassword: "replacement123",
        }),
      });
      expect(change.status).toBe(200);
      const replacementCookie = extractTokenCookie(change);

      for (const cookie of [firstCookie, secondCookie]) {
        const meRes = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } });
        expect((await meRes.json()).data).toBeNull();
      }
      const replacementMe = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: replacementCookie } });
      expect((await replacementMe.json()).data.id).toBe("forcesessionuser");
    });

    it("successfully changes password and clears flag", async () => {
      // Register and reset
      await createTestUser(baseUrl, "forcechange1", "password123");
      const resetRes = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "forcechange1" }),
      });
      const resetPassword = (await resetRes.json()).data.temporaryPassword;

      // Force change password
      const res = await fetch(`${baseUrl}/api/auth/force-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "forcechange1",
          oldPassword: resetPassword,
          newPassword: "brandnew789",
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe("forcechange1");

      // Should get a session cookie
      const setCookie = res.headers.get("set-cookie");
      expect(setCookie).toContain("token=");

      // Can now login normally with new password
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "forcechange1", password: "brandnew789" }),
      });
      expect(loginRes.status).toBe(200);
    });

    it("rejects wrong old password", async () => {
      await createTestUser(baseUrl, "forcechange2", "password123");
      await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "forcechange2" }),
      });

      const res = await fetch(`${baseUrl}/api/auth/force-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "forcechange2",
          oldPassword: "wrongpassword",
          newPassword: "newpass456",
        }),
      });
      expect(res.status).toBe(401);
    });

    it("rejects short new password", async () => {
      await createTestUser(baseUrl, "forcechange3", "password123");
      const resetRes = await fetch(`${baseUrl}/api/admin/reset-password`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "forcechange3" }),
      });
      const resetPassword = (await resetRes.json()).data.temporaryPassword;

      const res = await fetch(`${baseUrl}/api/auth/force-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "forcechange3",
          oldPassword: resetPassword,
          newPassword: "12345",
        }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toContain("Password too short");
    });

    it("returns 404 for non-existent user", async () => {
      const res = await fetch(`${baseUrl}/api/auth/force-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: "nonexistent_user_xyz",
          oldPassword: "whatever",
          newPassword: "newpass456",
        }),
      });
      expect(res.status).toBe(404);
    });
  });
});
