import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalRuntime,
  type LocalRuntime,
} from "../src/index.js";
import { createFixtureApp } from "../src/__tests__/fixtures.js";

const CONTROL_TOKEN = "test-e2e-control-secret";
const roots: string[] = [];
const runtimes: LocalRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Local Runtime security E2E", () => {
  it("rejects illegal, unknown, and non-loopback hosts without disclosing installed applications", async () => {
    const runtime = await startRuntime();
    const invalidHosts = [
      "missing-app.localhost",
      "alpha_app.localhost",
      "alpha-app.localhost.example",
      "evil.example",
    ];

    const responses = await Promise.all(
      invalidHosts.map((host) =>
        runtime.inject({
          method: "GET",
          url: "/",
          headers: { host },
        }),
      ),
    );

    for (const response of responses) {
      expect(response.statusCode).toBe(421);
      expect(response.json()).toEqual({
        success: false,
        error: "Invalid local application host",
      });
      expect(response.body).not.toContain("alpha-app");
      expect(response.headers["set-cookie"]).toBeUndefined();
    }

    const cookie = await createSession(runtime, "alpha-app");
    const wrongOrigin = await runtime.inject({
      method: "POST",
      url: "/api/mutations/items.create",
      headers: {
        host: "alpha-app.localhost",
        origin: "http://beta-app.localhost",
        cookie,
      },
      payload: { params: { id: "blocked", title: "Must not be stored" } },
    });
    expect(wrongOrigin.statusCode).toBe(403);

    const rows = await runtime.inject({
      method: "POST",
      url: "/api/queries/items.list",
      headers: {
        host: "alpha-app.localhost",
        origin: "http://alpha-app.localhost",
        cookie,
      },
      payload: { params: {} },
    });
    expect(rows.statusCode, rows.body).toBe(200);
    expect(rows.json().data.rows).toEqual([]);
  });

  it("consumes tickets once and never upgrades replay or cross-app sessions", async () => {
    const runtime = await startRuntime();
    const ticket = await issueTicket(runtime, "alpha-app");
    const firstExchange = await exchangeTicket(runtime, "alpha-app", ticket);

    expect(firstExchange.statusCode).toBe(302);
    expect(firstExchange.headers.location).toBe("/");
    expect(firstExchange.headers["set-cookie"]).toMatch(
      /^localapp_local_session=[^;]+; Path=\/; HttpOnly; SameSite=Strict$/,
    );
    const alphaCookie = firstExchange.headers["set-cookie"] as string;

    const replay = await exchangeTicket(runtime, "alpha-app", ticket);
    expect(replay.statusCode).toBe(401);
    expect(replay.headers["set-cookie"]).toBeUndefined();

    const crossApp = await runtime.inject({
      method: "GET",
      url: "/",
      headers: {
        host: "beta-app.localhost",
        cookie: alphaCookie,
      },
    });
    expect(crossApp.statusCode).toBe(401);
    expect(crossApp.headers["set-cookie"]).toBeUndefined();

    const alphaStillAuthorized = await runtime.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        host: "alpha-app.localhost",
        cookie: alphaCookie,
      },
    });
    expect(alphaStillAuthorized.statusCode, alphaStillAuthorized.body).toBe(200);
    expect(alphaStillAuthorized.json().data.id).toBe("local-user");

    const crossAppTicket = await issueTicket(runtime, "alpha-app");
    const wrongAppExchange = await exchangeTicket(
      runtime,
      "beta-app",
      crossAppTicket,
    );
    expect(wrongAppExchange.statusCode).toBe(401);
    expect(wrongAppExchange.headers["set-cookie"]).toBeUndefined();
    const consumedOnWrongApp = await exchangeTicket(
      runtime,
      "alpha-app",
      crossAppTicket,
    );
    expect(consumedOnWrongApp.statusCode).toBe(401);
    expect(consumedOnWrongApp.headers["set-cookie"]).toBeUndefined();
  });
});

async function startRuntime(): Promise<LocalRuntime> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-security-e2e-"));
  roots.push(root);
  const runtime = await createLocalRuntime({
    apps: [
      createFixtureApp(root, "alpha-app"),
      createFixtureApp(root, "beta-app"),
    ],
    controlToken: CONTROL_TOKEN,
  });
  runtimes.push(runtime);
  return runtime;
}

async function issueTicket(runtime: LocalRuntime, appId: string): Promise<string> {
  const response = await runtime.inject({
    method: "POST",
    url: "/control/tickets",
    headers: {
      host: "control.localhost",
      authorization: `Bearer ${CONTROL_TOKEN}`,
    },
    payload: { appId },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json().data.ticket as string;
}

async function exchangeTicket(
  runtime: LocalRuntime,
  appId: string,
  ticket: string,
) {
  return runtime.inject({
    method: "GET",
    url: `/?ticket=${ticket}`,
    headers: { host: `${appId}.localhost` },
  });
}

async function createSession(runtime: LocalRuntime, appId: string): Promise<string> {
  const response = await exchangeTicket(runtime, appId, await issueTicket(runtime, appId));
  expect(response.statusCode).toBe(302);
  return response.headers["set-cookie"] as string;
}
