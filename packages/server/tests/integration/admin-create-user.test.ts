import { describe, it, expect, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { findUserById, getDb, provisionUserWithApiKey } from "../../src/lib/meta-sqlite.js";

describe("Admin Create User", () => {
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

  describe("POST /api/admin/users", () => {
    it("atomically provisions a user with one-time random credentials", async () => {
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "newuser1" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        id: "newuser1",
        name: "newuser1",
        role: "user",
        mustChangePassword: true,
        credentials: {
          temporaryPassword: expect.any(String),
          apiKey: expect.any(String),
        },
      });
      expect(data.data.credentials.temporaryPassword.length).toBeGreaterThanOrEqual(22);
      expect(data.data.credentials.apiKey.length).toBeGreaterThanOrEqual(32);
      expect(data.data.credentials.temporaryPassword).not.toBe("localapp");

      const storedKey = getDb().exec(
        `SELECT key FROM api_keys WHERE user_id = 'newuser1'`,
      )[0].values[0][0] as string;
      expect(storedKey).not.toBe(data.data.credentials.apiKey);
      expect(storedKey).toMatch(/^sha256:/);

      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "newuser1",
          password: data.data.credentials.temporaryPassword,
        }),
      });
      expect(loginRes.status).toBe(403);
      const loginData = await loginRes.json();
      expect(loginData.code).toBe("MUST_CHANGE_PASSWORD");

      const meRes = await fetch(`${baseUrl}/api/me`, {
        headers: { "X-API-Key": data.data.credentials.apiKey },
      });
      expect(meRes.status).toBe(200);
      expect((await meRes.json()).data.name).toBe("newuser1");
    });

    it("never returns one-time credentials from later user queries", async () => {
      const createRes = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "onetimeuser" }),
      });
      const created = await createRes.json();
      const secrets = [
        created.data.credentials.temporaryPassword,
        created.data.credentials.apiKey,
      ];

      for (const path of ["/api/admin/users?page=1&limit=100", "/api/admin/users/onetimeuser"]) {
        const queryRes = await fetch(`${baseUrl}${path}`, {
          headers: { "X-API-Key": apiKey },
        });
        const responseText = await queryRes.text();
        expect(queryRes.status).toBe(200);
        for (const secret of secrets) {
          expect(responseText).not.toContain(secret);
        }
      }
    });

    it("rolls back the user when initial API key insertion fails", async () => {
      const passwordHash = await bcrypt.hash("not-returned", 4);
      expect(() =>
        provisionUserWithApiKey("rollbackuser", "rollbackuser", passwordHash, apiKey),
      ).toThrow();
      expect(findUserById("rollbackuser")).toBeNull();
    });

    it("returns 409 when username already exists", async () => {
      // First create
      await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "dupuser" }),
      });

      // Second create should fail
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "dupuser" }),
      });
      expect(res.status).toBe(409);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Username already exists");
    });

    it("returns 400 when username format is invalid", async () => {
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "INVALID!@#" }),
      });
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Invalid username format");
    });

    it("rejects non-admin with 403", async () => {
      // Create a non-admin user first via admin
      await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "nonadmin2" }),
      });
      // Create API key for non-admin
      const keyRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "nonadmin2" }),
      });
      const { data: keyData } = await keyRes.json();
      const otherKey = keyData.key;

      const res = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "X-API-Key": otherKey, "Content-Type": "application/json" },
        body: JSON.stringify({ username: "shouldnotcreate" }),
      });
      expect(res.status).toBe(403);
    });

    it("rejects unauthenticated with 401", async () => {
      const res = await fetch(`${baseUrl}/api/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "shouldnotcreate" }),
      });
      expect(res.status).toBe(401);
    });
  });
});
