import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { createTestUser } from "../helpers/createUser.js";
import { createTestPage, createTestServer } from "./helpers.js";
import { getTestApiKey } from "./helpers.js";

describe("local Server device action activation", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let stop: () => Promise<void>;
  let user: Awaited<ReturnType<typeof createTestUser>>;
  const controlToken = "local-device-control-test-token";
  const fixtureDirectory = path.resolve(process.cwd(), "../../tmp/two-server-device-action");

  beforeAll(async () => {
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
    await fs.mkdir(fixtureDirectory, { recursive: true });
    const server = await createTestServer({ env: { LOCALAPP_DEVICE_CONTROL_TOKEN: controlToken } });
    app = server.app;
    baseUrl = server.baseUrl;
    stop = server.stop;
    user = await createTestUser(baseUrl, "localdeviceowner");
    await createTestPage(app, "localdeviceowner", "skill-market");
  });

  afterAll(async () => {
    await stop();
    await fs.rm(fixtureDirectory, { recursive: true, force: true });
  });

  it("directly claims a daemon-managed loopback action before returning its local confirmation URL", async () => {
    const output = path.join(fixtureDirectory, "installed.txt");
    const create = await fetch(`${baseUrl}/serve/localdeviceowner/skill-market/api/device-actions`, {
      method: "POST",
      headers: { cookie: user.cookie, referer: `${baseUrl}/localdeviceowner/skill-market/`, "content-type": "application/json" },
      body: JSON.stringify({
        title: "Install local skill fixture",
        script: "await import('node:fs/promises').then(({writeFile}) => writeFile(input.path, input.content)); return { installed: true };",
        input: { path: output, content: "skill fixture" },
        permissions: { filesystemWrite: [fixtureDirectory] },
        timeoutSeconds: 20,
      }),
    });
    expect(create.status).toBe(201);
    const created = (await create.json()).data as { requestId: string; activationUrl: string; status: string };
    expect(created).toMatchObject({
      status: "awaiting_trust",
      activationUrl: `${baseUrl}/my/device-actions/?requestId=${created.requestId}`,
    });

    const pending = await fetch(`${baseUrl}/api/device-actions/local`, { headers: { "x-api-key": getTestApiKey() } });
    expect(pending.status).toBe(200);
    expect((await pending.json()).data.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ requestId: created.requestId, status: "awaiting_trust" }),
    ]));

    const trusted = await fetch(`${baseUrl}/api/device-actions/local/${created.requestId}/trust`, {
      method: "POST",
      headers: { "x-api-key": getTestApiKey() },
    });
    expect(trusted.status).toBe(200);

    const deadline = Date.now() + 10_000;
    let finalStatus = "";
    while (Date.now() < deadline) {
      const local = await fetch(`${baseUrl}/api/device-actions/local`, { headers: { "x-api-key": getTestApiKey() } });
      const actions = (await local.json()).data.actions as Array<{ requestId: string; status: string }>;
      finalStatus = actions.find((action) => action.requestId === created.requestId)?.status ?? "";
      if (["succeeded", "failed"].includes(finalStatus)) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(finalStatus).toBe("succeeded");
    expect(await fs.readFile(output, "utf8")).toBe("skill fixture");
  });
});
