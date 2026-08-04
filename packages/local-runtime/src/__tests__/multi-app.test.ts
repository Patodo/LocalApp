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

async function createSession(
  runtime: Awaited<ReturnType<typeof createLocalRuntime>>,
  appId: string,
) {
  const ticketResponse = await runtime.inject({
    method: "POST",
    url: "/control/tickets",
    headers: {
      host: "control.localhost",
      authorization: "Bearer control-secret",
    },
    payload: { appId },
  });
  const ticket = ticketResponse.json().data.ticket as string;
  const exchange = await runtime.inject({
    method: "GET",
    url: `/?ticket=${ticket}`,
    headers: { host: `${appId}.localhost` },
  });
  return exchange.headers["set-cookie"] as string;
}

async function uploadFile(
  runtime: Awaited<ReturnType<typeof createLocalRuntime>>,
  appId: string,
  cookie: string,
  contents: string,
) {
  const form = new FormData();
  form.append(
    "file",
    new File(
      [`<svg xmlns="http://www.w3.org/2000/svg"><text>${contents}</text></svg>`],
      "same.svg",
      { type: "image/svg+xml" },
    ),
  );
  const encoded = new Request("http://localhost", { method: "POST", body: form });
  const upload = await runtime.inject({
    method: "POST",
    url: "/api/content/upload",
    headers: {
      host: `${appId}.localhost`,
      origin: `http://${appId}.localhost`,
      "content-type": encoded.headers.get("content-type")!,
    },
    cookies: {
      localapp_local_session: cookie.match(/localapp_local_session=([^;]+)/)![1],
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
  expect(upload.statusCode, upload.body).toBe(201);
  return upload.json().data.key as string;
}

describe("multi-app local runtime", () => {
  it("serves two apps from one process with isolated named SQL databases", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-local-runtime-"));
    roots.push(root);
    const alpha = createFixtureApp(root, "alpha-app");
    const beta = createFixtureApp(root, "beta-app");
    const runtime = await createLocalRuntime({
      apps: [alpha, beta],
      controlToken: "control-secret",
    });
    const alphaCookie = await createSession(runtime, alpha.id);
    const betaCookie = await createSession(runtime, beta.id);

    for (const [app, cookie, title] of [
      [alpha, alphaCookie, "Alpha title"],
      [beta, betaCookie, "Beta title"],
    ] as const) {
      const mutation = await runtime.inject({
        method: "POST",
        url: "/api/mutations/items.create",
        headers: {
          host: `${app.id}.localhost`,
          origin: `http://${app.id}.localhost`,
          cookie,
        },
        payload: { params: { id: "same-id", title } },
      });
      expect(mutation.statusCode).toBe(200);
    }

    const alphaRows = await runtime.inject({
      method: "POST",
      url: "/api/queries/items.list",
      headers: {
        host: `${alpha.id}.localhost`,
        origin: `http://${alpha.id}.localhost`,
        cookie: alphaCookie,
      },
      payload: { params: {} },
    });
    const betaRows = await runtime.inject({
      method: "POST",
      url: "/api/queries/items.list",
      headers: {
        host: `${beta.id}.localhost`,
        origin: `http://${beta.id}.localhost`,
        cookie: betaCookie,
      },
      payload: { params: {} },
    });

    expect(alphaRows.json().data.rows).toEqual([
      { id: "same-id", title: "Alpha title" },
    ]);
    expect(betaRows.json().data.rows).toEqual([
      { id: "same-id", title: "Beta title" },
    ]);
    const evicted = await runtime.inject({
      method: "POST",
      url: `/control/apps/${alpha.id}/evict`,
      headers: {
        host: "control.localhost",
        authorization: "Bearer control-secret",
      },
    });
    expect(evicted.statusCode, evicted.body).toBe(200);
    expect(runtime.runtimeStats().initializedApps).toBe(1);
    const alphaAfterEviction = await runtime.inject({
      method: "POST",
      url: "/api/queries/items.list",
      headers: {
        host: `${alpha.id}.localhost`,
        origin: `http://${alpha.id}.localhost`,
        cookie: alphaCookie,
      },
      payload: { params: {} },
    });
    expect(alphaAfterEviction.json().data.rows).toEqual([
      { id: "same-id", title: "Alpha title" },
    ]);
    const alphaFile = await uploadFile(runtime, alpha.id, alphaCookie, "alpha file");
    const betaFile = await uploadFile(runtime, beta.id, betaCookie, "beta file");
    const alphaRead = await runtime.inject({
      method: "GET",
      url: `/api/content/${alphaFile}`,
      headers: { host: `${alpha.id}.localhost`, cookie: alphaCookie },
    });
    const crossRead = await runtime.inject({
      method: "GET",
      url: `/api/content/${alphaFile}`,
      headers: { host: `${beta.id}.localhost`, cookie: betaCookie },
    });
    expect(alphaRead.body).toContain("alpha file");
    expect(crossRead.statusCode).toBe(404);
    expect(alphaFile).not.toBe(betaFile);
    expect(runtime.runtimeStats()).toMatchObject({
      registeredApps: 2,
      initializedApps: 2,
    });
    await runtime.close();
  });

  it("isolates a broken app and leaves 100 inactive apps unloaded", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-local-runtime-"));
    roots.push(root);
    const healthy = createFixtureApp(root, "healthy-app");
    const broken = createFixtureApp(root, "broken-app", {
      invalidMigration: true,
    });
    const inactive = Array.from({ length: 100 }, (_, index) =>
      createFixtureApp(root, `idle-${String(index).padStart(3, "0")}`),
    );
    const runtime = await createLocalRuntime({
      apps: [healthy, broken, ...inactive],
      controlToken: "control-secret",
    });

    expect(runtime.runtimeStats()).toMatchObject({
      registeredApps: 102,
      initializedApps: 0,
    });
    const healthyCookie = await createSession(runtime, healthy.id);
    const healthyShell = await runtime.inject({
      method: "GET",
      url: "/",
      headers: { host: `${healthy.id}.localhost`, cookie: healthyCookie },
    });
    expect(healthyShell.statusCode).toBe(200);
    expect(healthyShell.body).toContain('data-localapp-local-shell="true"');
    expect(healthyShell.body).toContain('data-localapp-native-shell="true"');
    const spaFallback = await runtime.inject({
      method: "GET",
      url: "/items/same-id",
      headers: { host: `${healthy.id}.localhost`, cookie: healthyCookie },
    });
    expect(spaFallback.statusCode).toBe(200);
    expect(spaFallback.body).toContain('data-localapp-local-shell="true"');
    const asset = await runtime.inject({
      method: "GET",
      url: "/assets/app.js",
      headers: { host: `${healthy.id}.localhost`, cookie: healthyCookie },
    });
    expect(asset.statusCode).toBe(200);
    expect(asset.body).toContain("healthy-app");
    const brokenTicket = await createSession(runtime, broken.id);
    const brokenShell = await runtime.inject({
      method: "GET",
      url: "/",
      headers: { host: `${broken.id}.localhost`, cookie: brokenTicket },
    });
    expect(brokenShell.statusCode).toBe(503);
    expect(runtime.runtimeStats()).toMatchObject({
      registeredApps: 102,
      initializedApps: 1,
      failedApps: 1,
    });
    await runtime.close();
  });

  it("reports actionable per-app health without initializing or blocking sibling apps", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-local-runtime-"));
    roots.push(root);
    const healthy = createFixtureApp(root, "healthy-app");
    const broken = createFixtureApp(root, "broken-app", {
      invalidMigration: true,
    });
    const runtime = await createLocalRuntime({
      apps: [healthy, broken],
      controlToken: "control-secret",
    });

    const initial = await runtime.inject({
      method: "GET",
      url: "/control/apps",
      headers: {
        host: "control.localhost",
        authorization: "Bearer control-secret",
      },
    });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().data.apps).toEqual([
      { appId: "healthy-app", status: "unavailable" },
      { appId: "broken-app", status: "unavailable" },
    ]);

    const brokenHealth = await runtime.inject({
      method: "POST",
      url: "/control/apps/broken-app/health",
      headers: {
        host: "control.localhost",
        authorization: "Bearer control-secret",
      },
    });
    expect(brokenHealth.statusCode).toBe(503);
    expect(brokenHealth.json().data).toMatchObject({
      appId: "broken-app",
      status: "error",
    });
    expect(brokenHealth.json().data.error).toMatch(/migration/i);

    const healthyHealth = await runtime.inject({
      method: "POST",
      url: "/control/apps/healthy-app/health",
      headers: {
        host: "control.localhost",
        authorization: "Bearer control-secret",
      },
    });
    expect(healthyHealth.statusCode).toBe(200);
    expect(healthyHealth.json().data).toEqual({
      appId: "healthy-app",
      status: "ready",
    });

    const final = await runtime.inject({
      method: "GET",
      url: "/control/apps",
      headers: {
        host: "control.localhost",
        authorization: "Bearer control-secret",
      },
    });
    expect(final.json().data.apps).toEqual([
      { appId: "healthy-app", status: "ready" },
      expect.objectContaining({
        appId: "broken-app",
        status: "error",
        error: expect.stringMatching(/migration/i),
      }),
    ]);
    await runtime.close();
  });

  it("marks missing entry points and malformed backend contracts as independent app errors", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-local-runtime-"));
    roots.push(root);
    const missingEntry = createFixtureApp(root, "missing-entry");
    const badBackend = createFixtureApp(root, "bad-backend");
    const healthy = createFixtureApp(root, "healthy-app");
    fs.rmSync(path.join(missingEntry.versionRoot, "dist", "index.html"));
    fs.writeFileSync(
      path.join(badBackend.versionRoot, "backend", "resources", "items", "schema.json"),
      "{not-json",
    );
    const runtime = await createLocalRuntime({
      apps: [missingEntry, badBackend, healthy],
      controlToken: "control-secret",
    });

    for (const [appId, expected] of [
      ["missing-entry", /index\.html/i],
      ["bad-backend", /json|backend|schema/i],
    ] as const) {
      const response = await runtime.inject({
        method: "POST",
        url: `/control/apps/${appId}/health`,
        headers: {
          host: "control.localhost",
          authorization: "Bearer control-secret",
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().data.status).toBe("error");
      expect(response.json().data.error).toMatch(expected);
    }

    const healthyResponse = await runtime.inject({
      method: "POST",
      url: "/control/apps/healthy-app/health",
      headers: {
        host: "control.localhost",
        authorization: "Bearer control-secret",
      },
    });
    expect(healthyResponse.statusCode).toBe(200);
    expect(healthyResponse.json().data.status).toBe("ready");
    await runtime.close();
  });
});
