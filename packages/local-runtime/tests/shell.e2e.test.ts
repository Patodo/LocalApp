import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  chromium,
  expect as expectPage,
  type Browser,
} from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import {
  createLocalRuntime,
  type LocalRuntime,
} from "../src/index.js";
import { startLocalRuntime } from "../src/process.js";
import { createFixtureApp } from "../src/__tests__/fixtures.js";

const CONTROL_TOKEN = "test-e2e-control-secret";
const roots: string[] = [];
const runtimes: LocalRuntime[] = [];
const browsers: Browser[] = [];

afterEach(async () => {
  await Promise.all(browsers.splice(0).map((browser) => browser.close()));
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.close()));
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Local Runtime formal entry E2E", () => {
  it("renders the Local Platform Shell and native loader contract on the application origin", async () => {
    const root = createRoot();
    const app = createFixtureApp(root, "shell-app");
    const runtime = await startRuntime([app]);
    const cookie = await createSession(runtime, app.id);

    const shell = await runtime.inject({
      method: "GET",
      url: "/",
      headers: {
        host: `${app.id}.localhost`,
        cookie,
      },
    });

    expect(shell.statusCode, shell.body).toBe(200);
    expect(shell.headers["content-type"]).toContain("text/html");
    expect(shell.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(shell.body).toContain('data-localapp-local-shell="true"');
    expect(shell.body).toContain('data-localapp-app-container="true"');
    expect(shell.body).toContain('data-localapp-native-shell="true"');
    expect(shell.body).toContain('data-localapp-app-root="root"');
    expect(shell.body).toContain('data-localapp-app-resource-base="/"');
    expect(shell.body).toContain(
      '<script type="module" src="/assets/app.js"></script>',
    );
    expect(shell.body).toContain(
      '<link rel="stylesheet" href="/.localapp/local-shell.css">',
    );
    expect(shell.body).toContain(
      '<script src="/.localapp/local-shell.js"></script>',
    );
    expect(shell.body).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/i);
    expect(shell.body).not.toMatch(/<iframe\b/i);

    const identity = await runtime.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        host: `${app.id}.localhost`,
        cookie,
      },
    });
    expect(identity.statusCode, identity.body).toBe(200);
    expect(identity.json()).toEqual({
      success: true,
      data: {
        id: "local-user",
        name: "Local User",
        displayName: "Local User",
        role: "owner",
      },
    });
  });

  it("keeps fixed shell resources behind the current application session", async () => {
    const root = createRoot();
    const alpha = createFixtureApp(root, "alpha-app");
    const beta = createFixtureApp(root, "beta-app");
    const runtime = await startRuntime([alpha, beta]);
    const alphaCookie = await createSession(runtime, alpha.id);

    const javascript = await runtime.inject({
      method: "GET",
      url: "/.localapp/local-shell.js",
      headers: { host: `${alpha.id}.localhost`, cookie: alphaCookie },
    });
    expect(javascript.statusCode, javascript.body).toBe(200);
    expect(javascript.headers["content-type"]).toContain("text/javascript");

    const stylesheet = await runtime.inject({
      method: "GET",
      url: "/.localapp/local-shell.css",
      headers: { host: `${alpha.id}.localhost`, cookie: alphaCookie },
    });
    expect(stylesheet.statusCode, stylesheet.body).toBe(200);
    expect(stylesheet.headers["content-type"]).toContain("text/css");

    for (const response of [
      await runtime.inject({
        method: "GET",
        url: "/.localapp/local-shell.js",
        headers: { host: `${alpha.id}.localhost` },
      }),
      await runtime.inject({
        method: "GET",
        url: "/.localapp/local-shell.js",
        headers: { host: `${beta.id}.localhost`, cookie: alphaCookie },
      }),
    ]) {
      expect(response.statusCode).toBe(401);
      expect(response.body).not.toContain("localapp:platform_request");
    }
  });

  it("handles SDK platform requests in the same page with accessible shell UI", async () => {
    const root = createRoot();
    const app = createFixtureApp(root, "capability-app");
    const process = await startLocalRuntime({
      apps: [app],
      controlToken: CONTROL_TOKEN,
      port: 0,
    });
    runtimes.push(process.runtime);

    const browser = await chromium.launch({ headless: true });
    browsers.push(browser);
    const context = await browser.newContext({ acceptDownloads: true });
    const origin = `http://${app.id}.localhost:${process.port}`;
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    const page = await context.newPage();
    const ticket = await issueTicket(process.runtime, app.id);
    await page.goto(`${origin}/?ticket=${encodeURIComponent(ticket)}`);

    expect(await page.locator("iframe").count()).toBe(0);
    expect(await platformRequest(page, "getCurrentUser")).toEqual({
      type: "localapp:platform_response",
      id: expect.any(String),
      ok: true,
      result: { id: "local-user", name: "Local User", role: "owner" },
    });
    expect(await platformRequest(page, "getServerTime")).toMatchObject({
      ok: true,
      result: { now: expect.any(String) },
    });

    expect(
      await platformRequest(page, "copyText", { text: "local clipboard" }),
    ).toMatchObject({ ok: true, result: { success: true } });
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "local clipboard",
    );

    const download = page.waitForEvent("download");
    const downloadResponse = platformRequest(page, "downloadFile", {
      filename: "local.txt",
      mimeType: "text/plain",
      data: "local download",
    });
    expect((await download).suggestedFilename()).toBe("local.txt");
    expect(await downloadResponse).toMatchObject({
      ok: true,
      result: { success: true },
    });

    const confirmation = platformRequest(page, "confirm", {
      title: "Delete local record?",
      message: "This cannot be undone.",
      confirmText: "Delete",
      cancelText: "Keep",
      tone: "danger",
    });
    const dialog = page.getByRole("dialog", { name: "Delete local record?" });
    await expectPage(dialog).toBeVisible();
    await expectPage(dialog.getByText("This cannot be undone.")).toBeVisible();
    await expectPage(dialog.getByRole("button", { name: "Keep" })).toBeFocused();
    await dialog.getByRole("button", { name: "Delete" }).click();
    expect(await confirmation).toMatchObject({ ok: true, result: true });
    await expectPage(dialog).toHaveCount(0);

    expect(
      await platformRequest(page, "openRoute", {
        href: "/local-route?from=sdk#details",
      }),
    ).toMatchObject({ ok: true, result: { success: true } });
    expect(page.url()).toBe(`${origin}/local-route?from=sdk#details`);

    expect(await platformRequest(page, "auth.login")).toMatchObject({
      ok: true,
      result: {
        success: true,
        authenticated: true,
        user: { id: "local-user" },
      },
    });

    expect(await platformRequest(page, "ai.open")).toMatchObject({
      ok: true,
      result: { success: true },
    });
    const aiOverlay = page.getByRole("complementary", {
      name: "LocalApp local AI",
    });
    await expectPage(aiOverlay).toBeVisible();
    expect(await platformRequest(page, "ai.toggle")).toMatchObject({
      ok: true,
      result: { success: true },
    });
    await expectPage(aiOverlay).toBeHidden();
    expect(await platformRequest(page, "ai.open")).toMatchObject({
      ok: true,
      result: { success: true },
    });
    expect(await platformRequest(page, "ai.close")).toMatchObject({
      ok: true,
      result: { success: true },
    });
    await expectPage(aiOverlay).toBeHidden();

    expect(await platformRequest(page, "not-a-capability")).toMatchObject({
      ok: false,
      error: "Unknown platform capability: not-a-capability",
    });
  }, 30_000);

  it("keeps a healthy application available when another application migration fails", async () => {
    const root = createRoot();
    const healthy = createFixtureApp(root, "healthy-app");
    const broken = createFixtureApp(root, "broken-app", {
      invalidMigration: true,
    });
    const runtime = await startRuntime([healthy, broken]);
    const [healthyCookie, brokenCookie] = await Promise.all([
      createSession(runtime, healthy.id),
      createSession(runtime, broken.id),
    ]);

    const brokenShell = await runtime.inject({
      method: "GET",
      url: "/",
      headers: {
        host: `${broken.id}.localhost`,
        cookie: brokenCookie,
      },
    });
    expect(brokenShell.statusCode).toBe(503);
    expect(brokenShell.json()).toMatchObject({
      success: false,
      code: "app_unavailable",
    });
    expect(brokenShell.json().error).toBeTruthy();

    const healthyShell = await runtime.inject({
      method: "GET",
      url: "/",
      headers: {
        host: `${healthy.id}.localhost`,
        cookie: healthyCookie,
      },
    });
    expect(healthyShell.statusCode, healthyShell.body).toBe(200);
    expect(healthyShell.body).toContain('data-localapp-local-shell="true"');

    const healthyIdentity = await runtime.inject({
      method: "GET",
      url: "/api/me",
      headers: {
        host: `${healthy.id}.localhost`,
        cookie: healthyCookie,
      },
    });
    expect(healthyIdentity.statusCode, healthyIdentity.body).toBe(200);
    expect(healthyIdentity.json().data.id).toBe("local-user");
    expect(runtime.runtimeStats()).toEqual({
      registeredApps: 2,
      initializedApps: 1,
      failedApps: 1,
    });
  });
});

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-shell-e2e-"));
  roots.push(root);
  return root;
}

async function startRuntime(
  apps: Parameters<typeof createLocalRuntime>[0]["apps"],
): Promise<LocalRuntime> {
  const runtime = await createLocalRuntime({
    apps,
    controlToken: CONTROL_TOKEN,
  });
  runtimes.push(runtime);
  return runtime;
}

async function createSession(runtime: LocalRuntime, appId: string): Promise<string> {
  const ticket = await issueTicket(runtime, appId);
  const exchange = await runtime.inject({
    method: "GET",
    url: `/?ticket=${ticket}`,
    headers: { host: `${appId}.localhost` },
  });
  expect(exchange.statusCode).toBe(302);
  return exchange.headers["set-cookie"] as string;
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

async function platformRequest(
  page: import("@playwright/test").Page,
  capability: string,
  payload?: unknown,
): Promise<Record<string, unknown>> {
  return page.evaluate(
    ({ capability, payload }) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const id = crypto.randomUUID();
        const onMessage = (event: MessageEvent) => {
          if (
            event.data?.type === "localapp:platform_response" &&
            event.data.id === id
          ) {
            window.removeEventListener("message", onMessage);
            resolve(event.data);
          }
        };
        window.addEventListener("message", onMessage);
        window.dispatchEvent(
          new CustomEvent("localapp:platform_request", {
            detail: {
              type: "localapp:platform_request",
              id,
              capability,
              ...(payload === undefined ? {} : { payload }),
            },
          }),
        );
      }),
    { capability, payload },
  );
}
