import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl } from "../integration/helpers.js";
import { createTestUser, registerAndLogin } from "./createUser.js";
import type { FastifyInstance } from "fastify";

describe("createTestUser helper", () => {
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

  it("createTestUser creates a user and returns a valid apiKey + cookie", async () => {
    const { apiKey, cookie } = await createTestUser(baseUrl, "helpertestuser");
    expect(typeof apiKey).toBe("string");
    expect(apiKey.length).toBeGreaterThan(0);
    expect(cookie).toMatch(/^token=/);

    // API key works for /api/me
    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.name).toBe("helpertestuser");

    // Cookie works for /api/me
    const meRes2 = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: cookie },
    });
    expect(meRes2.status).toBe(200);
    const meBody2 = await meRes2.json();
    expect(meBody2.data.name).toBe("helpertestuser");
  });

  it("registerAndLogin returns a working session cookie", async () => {
    const cookie = await registerAndLogin(baseUrl, "helpertestuser2");
    expect(cookie).toMatch(/^token=/);

    const meRes = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: cookie },
    });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.data.name).toBe("helpertestuser2");
  });
});
