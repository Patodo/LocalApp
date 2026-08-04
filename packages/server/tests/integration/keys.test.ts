import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { createTestUser } from "../helpers/createUser.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

describe("API Key management", () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    stop = server.stop;

    // Register a test user
    await createTestUser(baseUrl, "keyuser1", "password123");
  });

  afterAll(async () => {
    await stop();
  });

  describe("POST /api/keys", () => {
    it("should create an API key for a user", async () => {
      const res = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "keyuser1" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.key).toBeDefined();
      expect(data.data.key).toHaveLength(48);
      expect(data.data.userId).toBe("keyuser1");
    });

    it("should create key for current user when userId omitted", async () => {
      const res = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.key).toBeDefined();
      expect(data.data.userId).toBe(BOOTSTRAP_USER_ID);
    });

    it("should require authentication", async () => {
      const res = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "keyuser1" }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/keys", () => {
    it("should list masked keys without returning the one-time secret", async () => {
      // Create a key first
      const createRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: BOOTSTRAP_USER_ID }),
      });
      const { data: created } = await createRes.json();
      const fullKey = created.key;

      const res = await fetch(`${baseUrl}/api/keys`, {
        headers: { "X-API-Key": apiKey },
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
      const keys = data.data.map((k: any) => k.key);
      expect(keys).not.toContain(fullKey);
      expect(keys).toContain(`••••${fullKey.slice(-8)}`);
    });

    it("should require authentication", async () => {
      const res = await fetch(`${baseUrl}/api/keys`);
      expect(res.status).toBe(401);
    });
  });

  describe("Key authentication round-trip", () => {
    it("created key can authenticate as the target user", async () => {
      // Create a key for keyuser1
      const createRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: "keyuser1" }),
      });
      const { data: keyData } = await createRes.json();
      const newKey = keyData.key;

      // Use the new key to call /api/me
      const meRes = await fetch(`${baseUrl}/api/me`, {
        headers: { "X-API-Key": newKey },
      });
      expect(meRes.status).toBe(200);
      const meBody = await meRes.json();
      expect(meBody.success).toBe(true);
      expect(meBody.data.id).toBe("keyuser1");
      expect(meBody.data.name).toBe("keyuser1");
    });

    it("new key appears in key list", async () => {
      // Create key for admin (the bootstrap key user)
      const createRes = await fetch(`${baseUrl}/api/keys`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ userId: BOOTSTRAP_USER_ID }),
      });
      const { data: keyData } = await createRes.json();

      // List keys for admin
      const listRes = await fetch(`${baseUrl}/api/keys`, {
        headers: { "X-API-Key": apiKey },
      });
      const listBody = await listRes.json();
      expect(listBody.success).toBe(true);

      const keys = listBody.data.map((k: any) => k.key);
      expect(keys).not.toContain(keyData.key);
      expect(keys).toContain(`••••${keyData.key.slice(-8)}`);
    });
  });
});
