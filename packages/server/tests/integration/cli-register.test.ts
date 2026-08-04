import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { findUserById } from "../../src/lib/meta-sqlite.js";
import { createTestServer, getAppUrl } from "./helpers.js";

describe("POST /api/auth/cli-register", () => {
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

  it("returns a stable 410 migration response without creating a user", async () => {
    const res = await fetch(`${baseUrl}/api/auth/cli-register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Registration-Key": "previously-valid-or-extracted-key",
      },
      body: JSON.stringify({ username: "legacycli" }),
    });

    expect(res.status).toBe(410);
    await expect(res.json()).resolves.toEqual({
      success: false,
      code: "CLI_AUTO_REGISTRATION_REMOVED",
      error: expect.stringContaining("API Key"),
    });
    expect(findUserById("legacycli")).toBeNull();
  });

  it("does not inspect registration key or username payload", async () => {
    const requests = [
      { headers: {}, body: {} },
      { headers: { "X-Registration-Key": "wrong" }, body: { username: "x" } },
      { headers: { "X-Registration-Key": "anything" }, body: { username: "INVALID!@#" } },
    ];

    for (const request of requests) {
      const res = await fetch(`${baseUrl}/api/auth/cli-register`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...request.headers },
        body: JSON.stringify(request.body),
      });
      expect(res.status).toBe(410);
      expect((await res.json()).code).toBe("CLI_AUTO_REGISTRATION_REMOVED");
    }
  });

  it("keeps browser public registration unavailable", async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "anyone", password: "whatever" }),
    });
    expect(res.status).toBe(404);
  });
});
