import { afterEach, describe, expect, it } from "vitest";
import { findUserByName } from "../../src/lib/meta-sqlite.js";
import { createTestServer } from "./helpers.js";

describe("first-run setup", () => {
  let stop: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await stop?.();
  });

  it("starts empty and consumes the setup token after creating the first administrator", async () => {
    const server = await createTestServer({ cleanSetup: true });
    stop = server.stop;
    const issued = server.setupTokens.issue();

    expect((await fetch(`${server.baseUrl}/api/setup/status`).then((response) => response.json())).data)
      .toEqual({ required: true });

    const created = await fetch(`${server.baseUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: issued.token, username: "owner", password: "correct-horse-battery" }),
    });
    expect(created.status).toBe(201);
    expect(findUserByName("owner")?.role).toBe("admin");

    const replay = await fetch(`${server.baseUrl}/api/setup/initialize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: issued.token, username: "second", password: "correct-horse-battery" }),
    });
    expect(replay.status).toBe(410);
  });
});
