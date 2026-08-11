import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { closeMetaDb, createUser, findUserByName } from "../../src/lib/meta-sqlite.js";
import { pushRequestLog } from "../../src/lib/request-logger.js";
import { SetupTokenStore } from "../../src/lib/setup-token-store.js";
import { createTestPage } from "./helpers.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

describe("canonical Server development routes", () => {
  let dataDir = "";
  let server: Awaited<ReturnType<typeof buildServer>> | undefined;

  afterEach(async () => {
    await server?.close();
    closeMetaDb();
    if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("serves DevShell context and users through the authenticated Server", async () => {
    dataDir = path.join(REPO_ROOT, "tmp", `server-dev-routes-${process.pid}-${Date.now()}`);
    const apiKey = "canonical-dev-routes-api-key";
    const setupTokens = new SetupTokenStore();
    server = await buildServer({
      setupTokens,
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: apiKey,
        JWT_SECRET: "canonical-dev-routes-jwt-secret",
        LOCALAPP_DEV_TOOLS: "1",
      },
    });
    const issued = setupTokens.issue();
    const initialized = await server.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: issued.token, username: "devowner", password: "devowner-password" },
    });
    expect(initialized.statusCode).toBe(201);
    expect(findUserByName("devowner")).not.toBeNull();

    const headers = { "x-api-key": apiKey, "x-localapp-dev-page": "demo" };
    const context = await server.inject({ method: "GET", url: "/api/dev/context", headers });
    expect(context.statusCode).toBe(200);
    expect(context.json()).toMatchObject({
      success: true,
      data: { pageName: "demo", pageOwnerId: "devowner", user: { id: "devowner" } },
    });

    const updated = await server.inject({
      method: "PUT",
      url: "/api/dev/context",
      headers,
      payload: { timeMode: "fixed", now: "2026-08-11T00:00:00.000Z" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data).toMatchObject({ timeMode: "fixed", now: "2026-08-11T00:00:00.000Z" });

    const users = await server.inject({ method: "GET", url: "/api/dev/users", headers });
    expect(users.statusCode).toBe(200);
    expect(users.json().data.users).toEqual(expect.arrayContaining([expect.objectContaining({ id: "devowner" })]));

    createUser("alice", "alice", await bcrypt.hash("alice-password", 10));
    await createTestPage(server, "devowner", "demo");
    const simulated = await server.inject({
      method: "PUT",
      url: "/api/dev/context",
      headers,
      payload: { user: { id: "alice" }, timeMode: "fixed", now: "2026-08-11T00:00:00.000Z" },
    });
    expect(simulated.statusCode).toBe(200);
    const simulatedMe = await server.inject({ method: "GET", url: "/api/me", headers });
    expect(simulatedMe.json().data).toMatchObject({ id: "alice" });
    const simulatedTime = await server.inject({
      method: "GET",
      url: "/serve/devowner/demo/api/time",
      headers,
    });
    expect(simulatedTime.json().data).toEqual({ now: "2026-08-11T00:00:00.000Z", today: "2026-08-11" });

    expect((await server.inject({
      method: "PUT",
      url: "/api/dev/context",
      headers,
      payload: { user: null, timeMode: "real" },
    })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/api/me", headers })).json().data).toBeNull();

    pushRequestLog({ path: "/owned", method: "GET", status: 200, durationMs: 1, userId: "devowner", visitorId: null }, dataDir);
    pushRequestLog({ path: "/other", method: "GET", status: 200, durationMs: 1, userId: "other-user", visitorId: null }, dataDir);
    const diagnostics = await server.inject({ method: "GET", url: "/api/dev/diagnostics/requests", headers });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json().data).toEqual(expect.arrayContaining([expect.objectContaining({ path: "/owned" })]));
    expect(diagnostics.json().data).not.toEqual(expect.arrayContaining([expect.objectContaining({ path: "/other" })]));
  });

  it("keeps Dev Toolkit on loopback and rejects application-name traversal", async () => {
    dataDir = path.join(REPO_ROOT, "tmp", `server-dev-routes-boundary-${process.pid}-${Date.now()}`);
    const apiKey = "canonical-dev-routes-boundary-key";
    const setupTokens = new SetupTokenStore();
    server = await buildServer({
      setupTokens,
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: apiKey,
        JWT_SECRET: "canonical-dev-routes-boundary-jwt-secret",
        LOCALAPP_DEV_TOOLS: "1",
      },
    });
    const issued = setupTokens.issue();
    expect((await server.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: issued.token, username: "devowner", password: "devowner-password" },
    })).statusCode).toBe(201);

    const remote = await server.inject({
      method: "GET",
      url: "/api/dev/context",
      remoteAddress: "192.168.50.25",
      headers: { "x-api-key": apiKey, "x-localapp-dev-page": "demo-app" },
    });
    expect(remote.statusCode).toBe(403);

    await createTestPage(server, "other-owner", "victim-app");
    const victimDir = path.join(dataDir, "other-owner", "victim-app");
    const before = fs.readdirSync(victimDir).sort();
    const traversal = await server.inject({
      method: "POST",
      url: "/api/dev/data/snapshots",
      headers: {
        "x-api-key": apiKey,
        "x-localapp-dev-page": "../other-owner/victim-app",
      },
    });
    expect(traversal.statusCode).toBe(400);
    expect(fs.readdirSync(victimDir).sort()).toEqual(before);

    const invalidContext = await server.inject({
      method: "GET",
      url: "/api/dev/context",
      headers: { "x-api-key": apiKey, "x-localapp-dev-page": "../victim-app" },
    });
    expect(invalidContext.statusCode).toBe(400);
  });

  it("runs reset, snapshot, restore, and business metadata against the installed Server app", async () => {
    dataDir = path.join(REPO_ROOT, "tmp", `server-dev-routes-data-${process.pid}-${Date.now()}`);
    const apiKey = "canonical-dev-routes-data-key";
    const setupTokens = new SetupTokenStore();
    server = await buildServer({
      setupTokens,
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: apiKey,
        JWT_SECRET: "canonical-dev-routes-data-jwt-secret",
        LOCALAPP_DEV_TOOLS: "1",
      },
    });
    const issued = setupTokens.issue();
    expect((await server.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: issued.token, username: "devowner", password: "devowner-password" },
    })).statusCode).toBe(201);
    await createTestPage(server, "devowner", "demo-app");
    const pageDir = path.join(dataDir, "devowner", "demo-app");
    fs.mkdirSync(path.join(pageDir, "migrations"), { recursive: true });
    fs.writeFileSync(path.join(pageDir, "migrations/001_create_items.sql"), "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL);");
    const SQL = await initSqlJs();
    const database = new SQL.Database();
    database.run("CREATE TABLE legacy_items (id INTEGER PRIMARY KEY);");
    fs.writeFileSync(path.join(pageDir, "app.db"), Buffer.from(database.export()));
    database.close();
    const metaPath = path.join(pageDir, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.business = { enums: { status: ["draft", "done"] } };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    const headers = { "x-api-key": apiKey, "x-localapp-dev-page": "demo-app" };

    const reset = await server.inject({ method: "POST", url: "/api/dev/data/reset", headers });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(fs.existsSync(path.join(pageDir, "app.db"))).toBe(true);

    const snapshot = await server.inject({ method: "POST", url: "/api/dev/data/snapshots", headers });
    expect(snapshot.statusCode).toBe(201);
    const snapshotId = snapshot.json().data.id as string;
    expect(snapshotId).toBeTruthy();

    const restore = await server.inject({
      method: "POST",
      url: `/api/dev/data/snapshots/${encodeURIComponent(snapshotId)}/restore`,
      headers,
    });
    expect(restore.statusCode).toBe(200);
    expect(restore.json()).toMatchObject({ success: true, data: { restored: true, id: snapshotId } });

    const business = await server.inject({ method: "GET", url: "/api/dev/business", headers });
    expect(business.statusCode).toBe(200);
    expect(business.json().data).toEqual({ enums: { status: ["draft", "done"] } });

    const unavailableMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    unavailableMeta.versions[0] = {
      ...unavailableMeta.versions[0],
      appVersion: "1.0.0",
      digest: "a".repeat(64),
      packagePath: `.packages/v1-${"a".repeat(64)}.localapp`,
    };
    fs.writeFileSync(metaPath, JSON.stringify(unavailableMeta, null, 2));
    fs.rmSync(path.join(pageDir, "migrations"), { recursive: true, force: true });
    const unavailable = await server.inject({ method: "POST", url: "/api/dev/data/reset", headers });
    expect(unavailable.statusCode).toBe(409);
    expect(unavailable.json()).toMatchObject({ success: false, code: "APP_MIGRATIONS_UNAVAILABLE" });
  });

  it("keeps development routes disabled unless the same Server is started in dev mode", async () => {
    dataDir = path.join(REPO_ROOT, "tmp", `server-dev-routes-disabled-${process.pid}-${Date.now()}`);
    const apiKey = "disabled-dev-routes-api-key";
    const setupTokens = new SetupTokenStore();
    server = await buildServer({
      setupTokens,
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: apiKey,
        JWT_SECRET: "disabled-dev-routes-jwt-secret",
      },
    });
    const issued = setupTokens.issue();
    expect((await server.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: issued.token, username: "devowner", password: "devowner-password" },
    })).statusCode).toBe(201);

    const response = await server.inject({
      method: "GET",
      url: "/api/dev/context",
      headers: { "x-api-key": apiKey, "x-localapp-dev-page": "demo" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("does not reuse simulated context after a local Server data root is closed", async () => {
    const firstDataDir = path.join(REPO_ROOT, "tmp", `server-dev-routes-first-${process.pid}-${Date.now()}`);
    dataDir = firstDataDir;
    const firstTokens = new SetupTokenStore();
    server = await buildServer({
      setupTokens: firstTokens,
      env: {
        DATA_DIR: firstDataDir,
        BOOTSTRAP_API_KEY: "first-dev-routes-api-key",
        JWT_SECRET: "first-dev-routes-jwt-secret",
        LOCALAPP_DEV_TOOLS: "1",
      },
    });
    const firstIssued = firstTokens.issue();
    expect((await server.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: firstIssued.token, username: "devowner", password: "devowner-password" },
    })).statusCode).toBe(201);
    const firstHeaders = { "x-api-key": "first-dev-routes-api-key", "x-localapp-dev-page": "demo" };
    expect((await server.inject({
      method: "PUT",
      url: "/api/dev/context",
      headers: firstHeaders,
      payload: { timeMode: "fixed", now: "2026-08-11T00:00:00.000Z" },
    })).statusCode).toBe(200);
    pushRequestLog({ path: "/first-root-only", method: "GET", status: 200, durationMs: 1, userId: "devowner", visitorId: null }, firstDataDir);
    await server.close();
    server = undefined;
    closeMetaDb();
    fs.rmSync(firstDataDir, { recursive: true, force: true });

    dataDir = path.join(REPO_ROOT, "tmp", `server-dev-routes-second-${process.pid}-${Date.now()}`);
    const secondTokens = new SetupTokenStore();
    server = await buildServer({
      setupTokens: secondTokens,
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: "second-dev-routes-api-key",
        JWT_SECRET: "second-dev-routes-jwt-secret",
        LOCALAPP_DEV_TOOLS: "1",
      },
    });
    const secondIssued = secondTokens.issue();
    expect((await server.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: secondIssued.token, username: "devowner", password: "devowner-password" },
    })).statusCode).toBe(201);
    const context = await server.inject({
      method: "GET",
      url: "/api/dev/context",
      headers: { "x-api-key": "second-dev-routes-api-key", "x-localapp-dev-page": "demo" },
    });
    expect(context.json().data).toMatchObject({ timeMode: "real", now: null });
    const diagnostics = await server.inject({
      method: "GET",
      url: "/api/dev/diagnostics/requests",
      headers: { "x-api-key": "second-dev-routes-api-key", "x-localapp-dev-page": "demo" },
    });
    expect(diagnostics.json().data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "/first-root-only" }),
    ]));
  });
});
