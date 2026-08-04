import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

describe("create-page-api", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  // Scenario: 成功创建
  it("should create an empty page with name", async () => {
    const res = await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ name: "my-cool-app" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.name).toBe("my-cool-app");
    expect(body.data.url).toBe(`/${BOOTSTRAP_USER_ID}/my-cool-app/`);
    expect(body.data.url).not.toContain("/serve/");
    expect(body.data.rawUrl).toBe(`/serve/${BOOTSTRAP_USER_ID}/my-cool-app/`);
    expect(body.data.createdAt).toBeDefined();
  });

  // Scenario: 未认证
  it("should return 401 without API key", async () => {
    const res = await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "another-app" }),
    });

    expect(res.status).toBe(401);
  });

  // Scenario: name 格式不合法
  it("should return 400 for invalid name", async () => {
    const res = await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ name: "My_App" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
  });

  // Scenario: name 重复
  it("should return 409 for duplicate name", async () => {
    const res = await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({ name: "my-cool-app" }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe("Page name already exists");
  });
});
