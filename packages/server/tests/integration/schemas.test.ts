import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestPage, createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";

describe("schema-management deprecation", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const pageName = "schema-deprecated-page";

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

  it("returns 410 Gone for POST /api/schemas", async () => {
    const res = await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey, "X-LocalApp-Deprecated-Probe": "1" },
      body: JSON.stringify({
        pageName,
        name: "todos",
        fields: { title: { type: "string" } },
      }),
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Write SQL migrations");
  });
});
