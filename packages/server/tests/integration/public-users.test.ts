import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import type { FastifyInstance } from "fastify";

describe("GET /api/users", () => {
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

  it("已登录用户获取用户列表返回 200", async () => {
    const apiKey = getTestApiKey(app);
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);

    const user = body.data[0];
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("name");
    expect(user).toHaveProperty("displayName");
    expect(user).toHaveProperty("avatarUrl");
  });

  it("返回数据不含敏感字段", async () => {
    const apiKey = getTestApiKey(app);
    const res = await fetch(`${baseUrl}/api/users`, {
      headers: { "X-API-Key": apiKey },
    });
    const body = await res.json();
    const user = body.data[0];

    expect(user).not.toHaveProperty("password");
    expect(user).not.toHaveProperty("provider");
    expect(user).not.toHaveProperty("role");
    expect(user).not.toHaveProperty("storageUsed");
    expect(user).not.toHaveProperty("mustChangePassword");
    expect(user).not.toHaveProperty("bio");
  });

  it("未登录用户返回 401", async () => {
    const res = await fetch(`${baseUrl}/api/users`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
