import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { createTestUser } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";

describe("provider cleanup regression", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let adminCookie: string;
  let resetPassword: string;

  beforeAll(async () => {
    const server = await createTestServer({
      env: { ALLOW_REGISTER: "true" },
    });
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;

    // Login as admin to get cookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: BOOTSTRAP_USER_ID, password: "localadmin" }),
    });
    expect(loginRes.status).toBe(200);
    const setCookie = loginRes.headers.get("set-cookie");
    adminCookie = setCookie?.split(";")[0] || "";
  });

  afterAll(async () => {
    await stop();
  });

  it("admin can log in with the setup password", async () => {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: BOOTSTRAP_USER_ID, password: "localadmin" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.role).toBe("admin");
  });

  it("admin can reset any user's password", async () => {
    // Create a user first
    await createTestUser(baseUrl, "testuser", "password123");

    // Admin resets password via admin API
    const resetRes = await fetch(`${baseUrl}/api/admin/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: adminCookie },
      body: JSON.stringify({ userId: "testuser" }),
    });
    expect(resetRes.status).toBe(200);
    resetPassword = (await resetRes.json()).data.temporaryPassword;
  });

  it("user can change their own password", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "testuser", password: resetPassword }),
    });
    // may get 403 because must_change_password
    if (loginRes.status === 403) {
      const forceRes = await fetch(`${baseUrl}/api/auth/force-change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "testuser", oldPassword: resetPassword, newPassword: "example-new-password-123" }),
      });
      expect(forceRes.status).toBe(200);
      const setCookie = forceRes.headers.get("set-cookie");
      const userCookie = setCookie?.split(";")[0] || "";

      // Now change password via profile API
      const changeRes = await fetch(`${baseUrl}/api/me/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: userCookie },
        body: JSON.stringify({ oldPassword: "example-new-password-123", newPassword: "example-another-password" }),
      });
      expect(changeRes.status).toBe(200);
    }
  });
});
