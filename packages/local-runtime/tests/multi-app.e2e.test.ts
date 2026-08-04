import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalRuntime,
  type LocalRuntime,
} from "../src/index.js";
import {
  createFixtureApp,
  type FixtureApp,
} from "../src/__tests__/fixtures.js";

const CONTROL_TOKEN = "test-e2e-control-secret";
const roots: string[] = [];
const runtimes: LocalRuntime[] = [];

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Local Runtime multi-app E2E", () => {
  it("isolates concurrent database and file operations across applications and targeted maintenance", async () => {
    const { runtime, alpha, beta } = await startTwoAppRuntime();
    const [alphaCookie, betaCookie] = await Promise.all([
      createSession(runtime, alpha.id),
      createSession(runtime, beta.id),
    ]);

    await Promise.all([
      createItem(runtime, alpha, alphaCookie, "Alpha record"),
      createItem(runtime, beta, betaCookie, "Beta record"),
    ]);

    await expectItems(runtime, alpha, alphaCookie, [
      { id: "shared-id", title: "Alpha record" },
    ]);
    await expectItems(runtime, beta, betaCookie, [
      { id: "shared-id", title: "Beta record" },
    ]);

    const [alphaFile, betaFile] = await Promise.all([
      uploadFile(runtime, alpha, alphaCookie, "alpha contents"),
      uploadFile(runtime, beta, betaCookie, "beta contents"),
    ]);

    expect(alphaFile).not.toBe(betaFile);
    await expectFile(runtime, alpha, alphaCookie, alphaFile, 200, "alpha contents");
    await expectFile(runtime, beta, betaCookie, betaFile, 200, "beta contents");
    await expectFile(runtime, beta, betaCookie, alphaFile, 404);
    await expectFile(runtime, alpha, alphaCookie, betaFile, 404);

    expect(runtime.runtimeStats().initializedApps).toBe(2);
    const maintenance = await runtime.inject({
      method: "POST",
      url: `/control/apps/${alpha.id}/evict`,
      headers: controlHeaders(),
    });
    expect(maintenance.statusCode, maintenance.body).toBe(200);
    expect(runtime.runtimeStats().initializedApps).toBe(1);

    await expectItems(runtime, beta, betaCookie, [
      { id: "shared-id", title: "Beta record" },
    ]);
    await expectFile(runtime, beta, betaCookie, betaFile, 200, "beta contents");
    await expectItems(runtime, alpha, alphaCookie, [
      { id: "shared-id", title: "Alpha record" },
    ]);
  });
});

async function startTwoAppRuntime(): Promise<{
  runtime: LocalRuntime;
  alpha: FixtureApp;
  beta: FixtureApp;
}> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-multi-app-e2e-"));
  roots.push(root);
  const alpha = createFixtureApp(root, "alpha-app");
  const beta = createFixtureApp(root, "beta-app");
  const runtime = await createLocalRuntime({
    apps: [alpha, beta],
    controlToken: CONTROL_TOKEN,
  });
  runtimes.push(runtime);
  return { runtime, alpha, beta };
}

async function createSession(runtime: LocalRuntime, appId: string): Promise<string> {
  const ticketResponse = await runtime.inject({
    method: "POST",
    url: "/control/tickets",
    headers: controlHeaders(),
    payload: { appId },
  });
  expect(ticketResponse.statusCode, ticketResponse.body).toBe(200);
  const ticket = ticketResponse.json().data.ticket as string;
  const exchange = await runtime.inject({
    method: "GET",
    url: `/?ticket=${ticket}`,
    headers: { host: `${appId}.localhost` },
  });
  expect(exchange.statusCode).toBe(302);
  return exchange.headers["set-cookie"] as string;
}

async function createItem(
  runtime: LocalRuntime,
  app: FixtureApp,
  cookie: string,
  title: string,
): Promise<void> {
  const response = await runtime.inject({
    method: "POST",
    url: "/api/mutations/items.create",
    headers: appHeaders(app, cookie),
    payload: { params: { id: "shared-id", title } },
  });
  expect(response.statusCode, response.body).toBe(200);
}

async function expectItems(
  runtime: LocalRuntime,
  app: FixtureApp,
  cookie: string,
  expected: Array<{ id: string; title: string }>,
): Promise<void> {
  const response = await runtime.inject({
    method: "POST",
    url: "/api/queries/items.list",
    headers: appHeaders(app, cookie),
    payload: { params: {} },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data.rows).toEqual(expected);
}

async function uploadFile(
  runtime: LocalRuntime,
  app: FixtureApp,
  cookie: string,
  contents: string,
): Promise<string> {
  const form = new FormData();
  form.append(
    "file",
    new File(
      [`<svg xmlns="http://www.w3.org/2000/svg"><text>${contents}</text></svg>`],
      "shared.svg",
      { type: "image/svg+xml" },
    ),
  );
  const encoded = new Request("http://localhost", { method: "POST", body: form });
  const response = await runtime.inject({
    method: "POST",
    url: "/api/content/upload",
    headers: {
      ...appHeaders(app, cookie),
      "content-type": encoded.headers.get("content-type")!,
    },
    payload: Buffer.from(await encoded.arrayBuffer()),
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json().data.key as string;
}

async function expectFile(
  runtime: LocalRuntime,
  app: FixtureApp,
  cookie: string,
  key: string,
  statusCode: number,
  contents?: string,
): Promise<void> {
  const response = await runtime.inject({
    method: "GET",
    url: `/api/content/${key}`,
    headers: {
      host: `${app.id}.localhost`,
      cookie,
    },
  });
  expect(response.statusCode, response.body).toBe(statusCode);
  if (contents) expect(response.body).toContain(contents);
}

function controlHeaders() {
  return {
    host: "control.localhost",
    authorization: `Bearer ${CONTROL_TOKEN}`,
  };
}

function appHeaders(app: FixtureApp, cookie: string) {
  return {
    host: `${app.id}.localhost`,
    origin: `http://${app.id}.localhost`,
    cookie,
  };
}
