import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestServer,
  getAppUrl,
  getTestApiKey,
  registerUser,
} from "./helpers.js";

describe("platform data API", () => {
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    stop = server.stop;
    await registerUser(baseUrl, "platform-user", "test123456");
  });

  afterAll(async () => {
    await stop();
  });

  it("returns all users with API key auth", async () => {
    const res = await fetch(`${baseUrl}/api/platform/users`, {
      headers: { "X-API-Key": apiKey },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "localadmin",
          name: "localadmin",
          role: "admin",
        }),
        expect.objectContaining({
          id: "platform-user",
          name: "platform-user",
          role: "user",
        }),
      ]),
    );
  });

  it("rejects platform writes as read-only", async () => {
    const res = await fetch(`${baseUrl}/api/platform/users`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "bad" }),
    });

    expect(res.status).toBe(405);
    expect(await res.json()).toEqual({
      success: false,
      error: "Platform data is read-only",
    });
  });

  it("rejects requests without API key", async () => {
    const res = await fetch(`${baseUrl}/api/platform/users`);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      success: false,
      error: "Authentication required",
    });
  });

  it("accepts session cookie auth from logged-in user", async () => {
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "platform-user", password: "test123456" }),
    });
    expect(loginRes.ok).toBe(true);
    const cookieHeader = loginRes.headers.get("set-cookie");
    expect(cookieHeader).toBeTruthy();
    const tokenCookie = cookieHeader!.split(";")[0];

    const res = await fetch(`${baseUrl}/api/platform/users`, {
      headers: { Cookie: tokenCookie },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("returns groups, roles, and platform version", async () => {
    const headers = { "X-API-Key": apiKey };
    const [groupsRes, rolesRes, versionRes] = await Promise.all([
      fetch(`${baseUrl}/api/platform/groups`, { headers }),
      fetch(`${baseUrl}/api/platform/roles`, { headers }),
      fetch(`${baseUrl}/api/platform/version`, { headers }),
    ]);

    expect(groupsRes.status).toBe(200);
    expect((await groupsRes.json()).data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "everyone",
          memberCount: expect.any(Number),
        }),
      ]),
    );

    expect(rolesRes.status).toBe(200);
    expect((await rolesRes.json()).data).toEqual([
      expect.objectContaining({ id: "admin", name: "Admin" }),
      expect.objectContaining({ id: "user", name: "User" }),
    ]);

    expect(versionRes.status).toBe(200);
    expect(await versionRes.json()).toEqual({
      success: true,
      data: expect.objectContaining({
        version: expect.any(String),
      }),
    });
  });
});
