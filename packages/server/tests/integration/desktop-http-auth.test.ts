import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createApiKey, getDb } from "../../src/lib/meta-sqlite.js";
import { createTestServer, getAppUrl, registerUser } from "./helpers.js";

describe("desktop HTTP API-key authentication", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let apiKey: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;

    await registerUser(baseUrl, "desktop-user");
    apiKey = createApiKey("desktop-user").key;
    getDb().run(
      `INSERT INTO notifications (
        id, user_id, app_owner, app_name, title, body, url, priority,
        data, created_at, read_at, deleted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "desktop-notification",
        "desktop-user",
        "localadmin",
        "desktop-source",
        "Desktop notification",
        null,
        "/localadmin/desktop-source?from=inbox#detail",
        "normal",
        null,
        new Date().toISOString(),
        null,
        null,
      ],
    );
  });

  afterAll(async () => {
    await stop();
  });

  it("lists Inbox data with a real stored API key", async () => {
    const response = await fetch(`${baseUrl}/api/inbox`, {
      headers: { "X-API-Key": apiKey },
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.items).toEqual([
      expect.objectContaining({
        id: "desktop-notification",
        url: "/localadmin/desktop-source?from=inbox#detail",
      }),
    ]);
  });

  it("mutates and lists Favorites with a real stored API key", async () => {
    const addResponse = await fetch(`${baseUrl}/api/favorites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ pagePath: "localadmin/desktop-source" }),
    });
    expect(addResponse.status).toBe(200);

    const listResponse = await fetch(`${baseUrl}/api/me/favorites`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(listResponse.status).toBe(200);
    expect(await listResponse.json()).toMatchObject({
      success: true,
      data: [{ pagePath: "localadmin/desktop-source" }],
    });
  });

  it.each([undefined, "invalid-desktop-key"])(
    "rejects missing or invalid Inbox credentials (%s)",
    async (key) => {
      const response = await fetch(`${baseUrl}/api/inbox`, {
        headers: key ? { "X-API-Key": key } : undefined,
      });
      expect(response.status).toBe(401);
    },
  );

  it.each([undefined, "invalid-desktop-key"])(
    "rejects missing or invalid Favorites credentials (%s)",
    async (key) => {
      const response = await fetch(`${baseUrl}/api/me/favorites`, {
        headers: key ? { "X-API-Key": key } : undefined,
      });
      expect(response.status).toBe(401);
    },
  );
});
