import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalRuntime } from "../index.js";
import { createFixtureApp } from "./fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("local runtime security boundary", () => {
  it("rejects invalid hosts, control credentials and ticket/session replay", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-local-security-"));
    roots.push(root);
    const alpha = createFixtureApp(root, "alpha-app");
    const beta = createFixtureApp(root, "beta-app");
    const runtime = await createLocalRuntime({
      apps: [alpha, beta],
      controlToken: "control-secret",
    });

    expect(
      (
        await runtime.inject({
          method: "GET",
          url: "/",
          headers: { host: "evil.example" },
        })
      ).statusCode,
    ).toBe(421);
    expect(
      (
        await runtime.inject({
          method: "POST",
          url: "/control/tickets",
          headers: {
            host: "control.localhost",
            authorization: "Bearer wrong",
          },
          payload: { appId: alpha.id },
        })
      ).statusCode,
    ).toBe(401);

    const ticketResponse = await runtime.inject({
      method: "POST",
      url: "/control/tickets",
      headers: {
        host: "control.localhost:43127",
        authorization: "Bearer control-secret",
      },
      payload: { appId: alpha.id },
    });
    expect(ticketResponse.json().data.url).toMatch(
      /^http:\/\/alpha-app\.localhost:43127\/\?ticket=/,
    );
    const ticket = ticketResponse.json().data.ticket as string;
    const exchange = await runtime.inject({
      method: "GET",
      url: `/?ticket=${ticket}`,
      headers: { host: `${alpha.id}.localhost` },
    });
    const cookie = exchange.headers["set-cookie"] as string;

    expect(
      (
        await runtime.inject({
          method: "GET",
          url: `/?ticket=${ticket}`,
          headers: { host: `${alpha.id}.localhost` },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await runtime.inject({
          method: "GET",
          url: "/",
          headers: { host: `${beta.id}.localhost`, cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await runtime.inject({
          method: "POST",
          url: "/api/mutations/items.create",
          headers: {
            host: `${alpha.id}.localhost`,
            origin: `http://${beta.id}.localhost`,
            cookie,
          },
          payload: { params: { id: "1", title: "blocked" } },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await runtime.inject({
          method: "POST",
          url: "/api/mutations/items.create",
          headers: {
            host: `${alpha.id}.localhost:43127`,
            origin: `http://${alpha.id}.localhost:43128`,
            cookie,
          },
          payload: { params: { id: "2", title: "wrong port" } },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await runtime.inject({
          method: "GET",
          url: "/%2e%2e/manifest.json",
          headers: { host: `${alpha.id}.localhost`, cookie },
        })
      ).statusCode,
    ).not.toBe(200);
    expect(
      (
        await runtime.inject({
          method: "POST",
          url: "/api/mutations/items.create",
          headers: {
            host: `${alpha.id}.localhost`,
            origin: `http://${alpha.id}.localhost`,
            cookie,
            "content-type": "application/json",
          },
          payload: JSON.stringify({ padding: "x".repeat(3 * 1024 * 1024) }),
        })
      ).statusCode,
    ).toBe(413);
    await runtime.close();
  });
});
