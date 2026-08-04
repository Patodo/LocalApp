import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import { createTestPage, createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { registerAndLogin } from "../helpers/createUser.js";

describe("presence events API", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  const owner = BOOTSTRAP_USER_ID;
  const apiKey = getTestApiKey();

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    stop = server.stop;
  });

  afterAll(async () => { await stop(); });

  it("counts online users per app, dedupes same visitor, and updates after disconnect", async () => {
    const pageName = "presence-count";
    await createTestPage(app, owner, pageName);

    const first = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/presence/events`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(first.status).toBe(200);
    const firstReader = first.body!.getReader();
    await expect(readPresenceSnapshot(firstReader)).resolves.toMatchObject({
      count: 1,
      anonymousCount: 0,
      authenticatedUsers: [{ id: owner, name: "localadmin" }],
    });

    const second = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/presence/events`, {
      headers: { "X-API-Key": apiKey },
    });
    expect(second.status).toBe(200);
    const secondReader = second.body!.getReader();
    await expect(readPresenceSnapshot(secondReader)).resolves.toMatchObject({ count: 1, anonymousCount: 0 });

    await firstReader.cancel();
    await expect(readPresenceSnapshot(secondReader)).resolves.toMatchObject({ count: 1 });

    await secondReader.cancel();
  });

  it("aggregates anonymous visitors without exposing authenticated identities to them", async () => {
    const pageName = "presence-privacy";
    await createTestPage(app, owner, pageName);
    const authenticated = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/presence/events`, {
      headers: { "X-API-Key": apiKey },
    });
    const authenticatedReader = authenticated.body!.getReader();
    await readPresenceSnapshot(authenticatedReader);

    const anonymous = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/presence/events`);
    const anonymousReader = anonymous.body!.getReader();
    await expect(readPresenceSnapshot(anonymousReader)).resolves.toMatchObject({
      count: 2,
      anonymousCount: 1,
      authenticatedUsers: [],
    });
    await expect(readPresenceSnapshot(authenticatedReader)).resolves.toMatchObject({
      count: 2,
      anonymousCount: 1,
      authenticatedUsers: [{ id: owner }],
    });

    await anonymousReader.cancel();
    await authenticatedReader.cancel();
  });

  it("keeps distinct session users online while their background SSE connections are released", async () => {
    const pageName = "presence-lease";
    await createTestPage(app, owner, pageName);
    const aliceCookie = await registerAndLogin(baseUrl, "presencealice");
    const bobCookie = await registerAndLogin(baseUrl, "presencebob");

    for (const [cookie, clientId] of [[aliceCookie, "alice-window"], [bobCookie, "bob-window"]]) {
      const heartbeat = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/presence/heartbeat`, {
        method: "POST",
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId }),
      });
      expect(heartbeat.status).toBe(200);
    }

    const bobEvents = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/presence/events?clientId=bob-window`, {
      headers: { Cookie: bobCookie },
    });
    const bobReader = bobEvents.body!.getReader();
    await expect(readPresenceSnapshot(bobReader)).resolves.toMatchObject({
      count: 2,
      authenticatedUsers: expect.arrayContaining([
        expect.objectContaining({ id: "presencealice" }),
        expect.objectContaining({ id: "presencebob" }),
      ]),
    });

    const leave = await fetch(`${baseUrl}/serve/${owner}/${pageName}/api/presence/leave`, {
      method: "POST",
      headers: { Cookie: aliceCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "alice-window" }),
    });
    expect(leave.status).toBe(200);
    await expect(readPresenceSnapshot(bobReader)).resolves.toMatchObject({
      count: 1,
      authenticatedUsers: [expect.objectContaining({ id: "presencebob" })],
    });
    await bobReader.cancel();
  });
});

async function readPresenceSnapshot(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{
  count: number;
  anonymousCount: number;
  authenticatedUsers: Array<{ id: string; name: string }>;
}> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const { value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/event: presence:snapshot\ndata: (.+)\n\n/);
    if (match) return JSON.parse(match[1]).data;
  }
  throw new Error(`No presence count event received. Buffer: ${buffer}`);
}
