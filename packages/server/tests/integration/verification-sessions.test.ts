import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { execRawSql, getConnection } from "../../src/lib/app-db.js";
import { BOOTSTRAP_USER_ID, createApiKey } from "../../src/lib/meta-sqlite.js";
import { createAuthSession } from "../../src/lib/auth-sessions.js";
import { createTestPage, createTestServer, getAppUrl, getTestApiKey, registerUser } from "./helpers.js";
import { readPageMeta, writePageMeta } from "../../src/plugins/storage.js";

const owner = BOOTSTRAP_USER_ID;
const appName = "verification-target";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function prepareApplication(app: FastifyInstance, dataDir: string): Promise<string> {
  await createTestPage(app, owner, appName, { pageAccess: { level: "owner" } });
  const pageDir = path.join(dataDir, owner, appName);
  const versionDir = path.join(pageDir, "versions", "v1");
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, "index.html"), "<main id=\"app\">verification</main>");

  const resourceDir = path.join(versionDir, "backend", "resources", "notes");
  writeJson(path.join(resourceDir, "schema.json"), {
    $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
    name: "notes",
    fields: { body: { type: "string" }, created_by: { type: "string" } },
  });
  writeJson(path.join(resourceDir, "queries.json"), {
    $schema: "https://localapp.dev/schemas/backend/queries.schema.json",
    queries: {
      "identity.current": {
        kind: "query",
        sql: "SELECT :currentUserId AS actor_id, :ownerId AS owner_id",
        params: {},
        access: "authenticated",
      },
      "notes.list": {
        kind: "query",
        sql: "SELECT body, created_by FROM notes ORDER BY id",
        params: {},
        access: "authenticated",
      },
    },
  });
  writeJson(path.join(resourceDir, "mutations.json"), {
    $schema: "https://localapp.dev/schemas/backend/mutations.schema.json",
    mutations: {
      "notes.create": {
        kind: "mutation",
        sql: "INSERT INTO notes (body, created_by) VALUES (:body, :currentUserId)",
        params: { body: { type: "string", required: true } },
        access: "authenticated",
      },
    },
  });

  const dbPath = path.join(pageDir, "app.db");
  await getConnection(dbPath);
  execRawSql(dbPath, "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT, created_by TEXT)");
  return dbPath;
}

function sessionCookies(response: Response): string {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") ?? ""];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

describe("production verification sessions", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  let realDbPath: string;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
    realDbPath = await prepareApplication(app, dataDir);
  });

  afterAll(async () => {
    await stop();
  });

  async function createSession(identity: "owner" | "member", ttlSeconds = 60) {
    const response = await fetch(`${baseUrl}/api/verification/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": getTestApiKey() },
      body: JSON.stringify({ owner, app: appName, version: 1, identity, ttlSeconds }),
    });
    return { response, body: await response.json() as any };
  }

  it("allows only the app owner to create a bounded audited session", async () => {
    await registerUser(baseUrl, "verification_other");
    const otherKey = createApiKey("verification_other").key;
    const denied = await fetch(`${baseUrl}/api/verification/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": otherKey },
      body: JSON.stringify({ owner, app: appName, version: 1, identity: "member" }),
    });
    expect(denied.status).toBe(403);

    const { response, body } = await createSession("member");
    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      success: true,
      data: {
        identity: "member",
        expiresAt: expect.any(String),
        openUrl: expect.stringContaining("/api/verification/open/"),
      },
    });

    const status = await fetch(`${baseUrl}/api/verification/sessions/${body.data.id}`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(await status.json()).toMatchObject({
      success: true,
      data: { audit: [{ event: "created" }] },
    });
  });

  it("returns an HTTPS open URL behind a trusted reverse proxy", async () => {
    const response = await fetch(`${baseUrl}/api/verification/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": getTestApiKey(),
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "work.example.com:60004",
      },
      body: JSON.stringify({ owner, app: appName, version: 1, identity: "member", ttlSeconds: 60 }),
    });
    expect(response.status).toBe(201);
    const openUrl = (await response.json() as any).data.openUrl as string;
    expect(openUrl).toMatch(
      /^https:\/\/work\.example\.com:60004\/api\/verification\/open\//,
    );
    const opened = await fetch(`${baseUrl}${new URL(openUrl).pathname}`, {
      redirect: "manual",
      headers: {
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "work.example.com:60004",
      },
    });
    expect(opened.status).toBe(302);
    expect(opened.headers.get("set-cookie")).toContain("Secure");
  });

  it("exchanges the open token once and scopes the synthetic member identity to one app", async () => {
    const { body } = await createSession("member");
    const open = await fetch(body.data.openUrl, { redirect: "manual" });
    expect(open.status).toBe(302);
    expect(open.headers.get("location")).toBe(`/${owner}/${appName}/`);
    const cookies = sessionCookies(open);
    expect(open.headers.get("set-cookie")).toContain("HttpOnly");

    const reused = await fetch(body.data.openUrl, { redirect: "manual" });
    expect(reused.status).toBe(410);

    const identity = await fetch(`${baseUrl}/serve/${owner}/${appName}/api/queries/identity.current`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ params: {} }),
    });
    expect(identity.status).toBe(200);
    const identityBody = await identity.json() as any;
    expect(identityBody.data.rows[0].owner_id).toBe(owner);
    expect(identityBody.data.rows[0].actor_id).toMatch(/^verification:member:/);

    const me = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: cookies, Referer: `${baseUrl}/${owner}/${appName}/` },
    });
    expect(await me.json()).toMatchObject({
      success: true,
      data: {
        id: expect.stringMatching(/^verification:member:/),
        role: "user",
        verificationIdentity: "member",
      },
    });

    const normalToken = createAuthSession(owner).token;
    const verificationWins = await fetch(`${baseUrl}/api/me`, {
      headers: {
        Cookie: `${cookies}; token=${normalToken}`,
        Referer: `${baseUrl}/${owner}/${appName}/`,
      },
    });
    expect(await verificationWins.json()).toMatchObject({
      success: true,
      data: {
        id: expect.stringMatching(/^verification:member:/),
        role: "user",
        verificationIdentity: "member",
      },
    });

    const crossAppMe = await fetch(`${baseUrl}/api/me`, {
      headers: { Cookie: cookies, Referer: `${baseUrl}/${owner}/verification-other-app/` },
    });
    expect(await crossAppMe.json()).toEqual({ success: true, data: null });

    await createTestPage(app, owner, "verification-other-app", { pageAccess: { level: "owner" } });
    const otherApp = await fetch(`${baseUrl}/serve/${owner}/verification-other-app/`, { headers: { Cookie: cookies } });
    expect(otherApp.status).toBe(401);
    const admin = await fetch(`${baseUrl}/api/admin/stats`, { headers: { Cookie: cookies } });
    expect(admin.status).toBe(401);
  });

  it.each(["owner", "member"] as const)("uses a private app.db copy for the %s identity", async (identity) => {
    const before = fs.readFileSync(realDbPath);
    const beforeHash = crypto.createHash("sha256").update(before).digest("hex");
    const { body } = await createSession(identity);
    const open = await fetch(body.data.openUrl, { redirect: "manual" });
    const cookies = sessionCookies(open);

    const created = await fetch(`${baseUrl}/serve/${owner}/${appName}/api/mutations/notes.create`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ params: { body: `from-${identity}` } }),
    });
    expect(created.status).toBe(200);

    const isolated = await fetch(`${baseUrl}/serve/${owner}/${appName}/api/queries/notes.list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ params: {} }),
    });
    const isolatedBody = await isolated.json() as any;
    expect(isolatedBody.data.rows).toEqual([
      expect.objectContaining({ body: `from-${identity}` }),
    ]);

    const afterHash = crypto.createHash("sha256").update(fs.readFileSync(realDbPath)).digest("hex");
    expect(afterHash).toBe(beforeHash);

    const report = await fetch(`${baseUrl}/serve/${owner}/${appName}/api/_verification/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({
        status: "passed",
        checks: [{ phase: "dom", status: "passed", summary: "application rendered" }],
      }),
    });
    expect(report.status).toBe(200);
    const databasePath = path.join(dataDir, ".verification", "sessions", body.data.id, "app.db");
    expect(fs.existsSync(databasePath)).toBe(false);

    const status = await fetch(`${baseUrl}/api/verification/sessions/${body.data.id}`, {
      headers: { "X-API-Key": getTestApiKey() },
    });
    expect(await status.json()).toMatchObject({
      success: true,
      data: {
        status: "passed",
        report: { checks: [{ phase: "dom", status: "passed" }] },
      },
    });
  });

  it("shows the shell but does not let an active verification session bypass offline app content", async () => {
    const { body } = await createSession("owner");
    const open = await fetch(body.data.openUrl, { redirect: "manual" });
    const cookies = sessionCookies(open);
    const meta = readPageMeta(dataDir, owner, appName)!;
    meta.lifecycle = { status: "offline" };
    writePageMeta(dataDir, owner, appName, meta);

    try {
      const shell = await fetch(`${baseUrl}/${owner}/${appName}/`, { headers: { Cookie: cookies } });
      expect(shell.status).toBe(200);
      expect(await shell.text()).toContain("data-localapp-native-shell");

      const query = await fetch(`${baseUrl}/serve/${owner}/${appName}/api/queries/identity.current`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookies },
        body: JSON.stringify({ params: {} }),
      });
      expect(query.status).toBe(503);
      await expect(query.json()).resolves.toMatchObject({ code: "APP_OFFLINE" });
    } finally {
      delete meta.lifecycle;
      writePageMeta(dataDir, owner, appName, meta);
    }
  });

  it("expires short sessions and removes their database copies", async () => {
    const { body } = await createSession("owner", 1);
    const open = await fetch(body.data.openUrl, { redirect: "manual" });
    const cookies = sessionCookies(open);
    await new Promise((resolve) => setTimeout(resolve, 1_100));

    const expired = await fetch(`${baseUrl}/serve/${owner}/${appName}/api/queries/identity.current`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookies },
      body: JSON.stringify({ params: {} }),
    });
    expect(expired.status).toBe(401);
    expect(fs.existsSync(path.join(dataDir, ".verification", "sessions", body.data.id))).toBe(false);
  });

  it("accepts an owner-submitted browser report without exposing the session cookie", async () => {
    const { body } = await createSession("owner");
    await fetch(body.data.openUrl, { redirect: "manual" });

    const submitted = await fetch(`${baseUrl}/api/verification/sessions/${body.data.id}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": getTestApiKey() },
      body: JSON.stringify({
        status: "passed",
        checks: [
          { phase: "dom", status: "passed", summary: "application rendered" },
          { phase: "console", status: "passed", summary: "no unhandled errors" },
        ],
      }),
    });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ success: true, data: { status: "passed" } });
    expect(fs.existsSync(path.join(dataDir, ".verification", "sessions", body.data.id))).toBe(false);
  });
});
