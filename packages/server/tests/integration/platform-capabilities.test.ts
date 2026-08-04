import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PLATFORM_CAPABILITIES } from "@localapp/server-core";

import { createTestServer, getAppUrl } from "./helpers.js";

function collectKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...collectKeys(child)]);
}

describe("platform capabilities API", () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    const testServer = await createTestServer();
    baseUrl = getAppUrl(testServer.app);
    stop = testServer.stop;
  });

  afterAll(async () => {
    await stop();
  });

  it("is public, versioned, and contains no secret-bearing fields", async () => {
    const response = await fetch(`${baseUrl}/api/platform/capabilities`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: PLATFORM_CAPABILITIES });
    expect(body.data.schemaVersion).toBe(1);
    expect(collectKeys(body.data)).not.toEqual(
      expect.arrayContaining(["secret", "token", "apiKey", "internalPath"]),
    );
  });
});
