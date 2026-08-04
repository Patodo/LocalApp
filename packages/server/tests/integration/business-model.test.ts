import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, getAppUrl, getTestApiKey, createTestPage } from "./helpers.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";

describe("schema-management: business metadata", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const pageOwner = BOOTSTRAP_USER_ID;
  const pageName = "biz-schema-page";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    await createTestPage(app, pageOwner, pageName);
  });

  afterAll(async () => {
    await stop();
  });

  // Scenario: 创建带业务元数据的 schema
  it("should save and return business metadata", async () => {
    const business = {
      kind: "request",
      ownerField: "created_by",
      statusField: "status",
      statuses: ["draft", "submitted", "approved", "rejected"],
      recordAccess: {
        read: { mode: "ownerField", field: "created_by" },
        update: { mode: "ownerField", field: "created_by", when: { status: ["draft"] } },
      },
    };

    const createRes = await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        pageName,
        name: "leave_requests",
        fields: {
          title: { type: "string", constraints: { required: true } },
          created_by: { type: "string", constraints: { defaultFrom: "currentUser.id" } },
          status: { type: "string", constraints: { enum: ["draft", "submitted", "approved", "rejected"], defaultValue: "draft" } },
        },
        business,
      }),
    });

    expect(createRes.status).toBe(200);
    const createBody = await createRes.json();
    expect(createBody.success).toBe(true);

    const listRes = await fetch(`${baseUrl}/api/schemas?pageName=${pageName}`, {
      headers: { "X-API-Key": apiKey },
    });
    const listBody = await listRes.json();
    const found = listBody.data.find((s: any) => s.name === "leave_requests");
    expect(found).toBeDefined();
    expect(found.business).toMatchObject(business);
  });

  // Scenario: 创建不带业务元数据的 schema — 保持现有行为
  it("should accept schema without business metadata", async () => {
    const res = await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        pageName,
        name: "plain_items",
        fields: { title: { type: "string" } },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.business).toBeUndefined();
  });
});

describe("schema-management: defaultFrom constraint", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const pageName = "biz-defaultfrom-page";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
    await createTestPage(app, BOOTSTRAP_USER_ID, pageName);
  });

  afterAll(async () => {
    await stop();
  });

  // Scenario: defaultFrom currentUser.id 被接受
  it("should accept defaultFrom currentUser.id", async () => {
    const res = await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        pageName,
        name: "requests_a",
        fields: {
          title: { type: "string" },
          created_by: { type: "string", constraints: { defaultFrom: "currentUser.id" } },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.fields.created_by.constraints.defaultFrom).toBe("currentUser.id");
  });

  // Scenario: defaultFrom currentUser.name 被接受
  it("should accept defaultFrom currentUser.name", async () => {
    const res = await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        pageName,
        name: "requests_b",
        fields: {
          title: { type: "string" },
          created_by_name: { type: "string", constraints: { defaultFrom: "currentUser.name" } },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.fields.created_by_name.constraints.defaultFrom).toBe("currentUser.name");
  });
});
