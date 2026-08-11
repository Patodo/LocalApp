import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildServer } from "../../src/server.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";
import { installAppPackage } from "../../src/lib/app-installer.js";
import { inspectAppPackage, writeAppPackage } from "../../src/lib/app-package.js";
import { createAppDataExport } from "../../src/lib/app-data-service.js";
import { AppSyncTarget } from "../../src/lib/app-sync-target.js";
import { SyncSessionStore } from "../../src/lib/sync-session-store.js";
import { getObject, putObject } from "../../src/lib/s3-client.js";
import { readPageMeta } from "../../src/plugins/storage.js";
import { SetupTokenStore } from "../../src/lib/setup-token-store.js";
import { getTestApiKey } from "./helpers.js";

const PROJECT_TMP = path.resolve(import.meta.dirname, "../../../..", "tmp");

describe("application-plus-data peer synchronization", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let adminCookie: string;
  let targetCookie: string;
  let stop: () => Promise<void>;

  beforeAll(async () => {
    fs.mkdirSync(PROJECT_TMP, { recursive: true });
    dataDir = fs.mkdtempSync(path.join(PROJECT_TMP, "localapp-data-sync-"));
    const setupTokens = new SetupTokenStore();
    app = await buildServer({
      env: {
        DATA_DIR: dataDir,
        BOOTSTRAP_API_KEY: getTestApiKey(),
        JWT_SECRET: `data-sync-${crypto.randomUUID()}`,
        TEMPLATE_REPO_URL: "https://github.com/example/template.git",
        ADMIN_STATIC_DIR: path.resolve(import.meta.dirname, "../../static/admin"),
      },
      setupTokens,
    });
    const issued = setupTokens.issue();
    const initialized = await app.inject({
      method: "POST",
      url: "/api/setup/initialize",
      payload: { token: issued.token, username: "localadmin", password: "localadmin" },
    });
    expect(initialized.statusCode).toBe(201);
    await app.listen({ port: 0, host: "127.0.0.1" });
    stop = async () => { await app.close(); };
    const address = app.addresses()[0];
    if (!address || typeof address === "string") throw new Error("test server did not listen");
    baseUrl = `http://127.0.0.1:${address.port}`;
    adminCookie = await login("localadmin", "localadmin");
    await provisionUser("target-owner", "target-password");
    targetCookie = await login("target-owner", "target-password");
  });

  afterAll(async () => {
    await stop?.();
    closeMetaDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("replaces target application data and files after an automatic backup", async () => {
    const v1 = await packageFixture("notes", "1.0.0", [
      ["001_init.sql", "CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records VALUES ('target', 'target-data');"],
    ]);
    const v2 = await packageFixture("notes", "2.0.0", [
      ["001_init.sql", "CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records VALUES ('target', 'target-data');"],
      ["002_upgrade.sql", "DELETE FROM records; INSERT INTO records VALUES ('source', 'source-data'); ALTER TABLE records ADD COLUMN upgraded INTEGER NOT NULL DEFAULT 1;"],
    ]);
    await install(v1, "target-owner");
    await install(v2, "localadmin");
    await putObject("target-owner/notes/target.txt", Buffer.from("target-file"), "text/plain");
    await putObject("localadmin/notes/source.txt", Buffer.from("source-file"), "text/plain");

    const apiKey = await createApiKey(targetCookie);
    const peer = await request("/api/peers", {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "data-target", baseUrl, apiKey, acceptInsecureHttp: true }),
    });
    expect(peer.response.status).toBe(201);
    const checked = await request(`/api/peers/${peer.body.data.id}/check`, { method: "POST", headers: { Cookie: adminCookie } });
    expect(checked.response.status).toBe(200);

    const started = await request("/api/me/apps/notes/sync", {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ peerId: peer.body.data.id, withData: true, confirmation: "notes" }),
    });
    expect(started.response.status).toBe(202);
    const job = await waitForJob(String(started.body.data.id));
    expect(job.status).toBe("completed");
    expect(job.withData).toBe(true);

    const targetMeta = readPageMeta(dataDir, "target-owner", "notes");
    expect(targetMeta).toMatchObject({ currentAppVersion: "2.0.0", userId: "target-owner" });
    expect(await sqlRows(path.join(dataDir, "target-owner", "notes", "app.db"), "SELECT id, value, upgraded FROM records"))
      .toEqual([{ id: "source", value: "source-data", upgraded: 1 }]);
    expect((await getObject("target-owner/notes/source.txt"))?.body.toString()).toBe("source-file");
    expect(await getObject("target-owner/notes/target.txt")).toBeNull();
    expect(fs.readdirSync(path.join(dataDir, "target-owner", "notes", "backups")).some((file) => file.endsWith(".zip"))).toBe(true);
    expect((await request("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "target-owner", password: "target-password" }) })).response.status).toBe(200);
  });

  it("requires the exact app-name confirmation and keeps target state after a failed replacement", async () => {
    const response = await request("/api/me/apps/notes/sync", {
      method: "POST",
      headers: { Cookie: adminCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ peerId: "missing-peer", withData: true, confirmation: "wrong" }),
    });
    expect(response.response.status).toBe(400);
    expect(response.body.code).toBe("APP_CONFIRMATION_MISMATCH");
  });

  it("rolls the application and data back when the replacement phase fails", async () => {
    const v3 = await packageFixture("notes", "3.0.0", [
      ["001_init.sql", "CREATE TABLE records (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO records VALUES ('target', 'target-data');"],
      ["002_upgrade.sql", "DELETE FROM records; INSERT INTO records VALUES ('source', 'source-data'); ALTER TABLE records ADD COLUMN upgraded INTEGER NOT NULL DEFAULT 1;"],
      ["003_latest.sql", "ALTER TABLE records ADD COLUMN latest INTEGER NOT NULL DEFAULT 1;"],
    ]);
    await install(v3, "localadmin");
    const sourceMeta = readPageMeta(dataDir, "localadmin", "notes")!;
    const exported = await createAppDataExport({
      pageDir: path.join(dataDir, "localadmin", "notes"),
      application: { owner: "localadmin", name: "notes", version: sourceMeta.currentVersion },
      archiveApplication: { owner: "target-owner", name: "notes", version: sourceMeta.currentVersion },
    });
    const packageMeta = await inspectAppPackage(v3);
    const dataDigest = await sha256File(exported.archivePath);
    const dataSize = fs.statSync(exported.archivePath).size;
    const sessions = new SyncSessionStore({ dataDir, rootDir: path.join(dataDir, ".staging", `sync-failure-${crypto.randomUUID()}`) });
    const target = new AppSyncTarget(dataDir, sessions, {
      importData: async () => { throw new Error("injected data replacement failure"); },
    });
    const session = target.create({
      id: crypto.randomUUID(), ownerId: "target-owner", mode: "app-and-data", appName: "notes",
      appVersion: packageMeta.version, packageDigest: packageMeta.digest, packageSize: fs.statSync(v3).size,
      dataDigest, dataSize,
    });
    try {
      await sessions.receivePackage({ id: session.id, ownerId: "target-owner", stream: fs.createReadStream(v3), contentLength: fs.statSync(v3).size });
      await sessions.receiveData({ id: session.id, ownerId: "target-owner", stream: fs.createReadStream(exported.archivePath), contentLength: dataSize });
      await expect(target.commit(session.id, "target-owner")).rejects.toThrow("injected data replacement failure");
    } finally {
      exported.cleanup();
    }
    expect(sessions.getOwned(session.id, "target-owner")?.status).toBe("failed");
    expect(readPageMeta(dataDir, "target-owner", "notes")).toMatchObject({ currentAppVersion: "2.0.0" });
    expect(await sqlRows(path.join(dataDir, "target-owner", "notes", "app.db"), "SELECT id, value, upgraded FROM records"))
      .toEqual([{ id: "source", value: "source-data", upgraded: 1 }]);
    expect((await getObject("target-owner/notes/source.txt"))?.body.toString()).toBe("source-file");
    expect(fs.readdirSync(path.join(dataDir, "target-owner", "notes", "backups")).filter((file) => file.endsWith(".zip")).length).toBeGreaterThan(0);
  });

  async function packageFixture(name: string, version: string, migrations: Array<[string, string]>): Promise<string> {
    const outputPath = path.join(dataDir, ".staging", `${name}-${version}-${crypto.randomUUID()}.localapp`);
    await writeAppPackage({
      outputPath,
      metadata: { schemaVersion: 1, appId: name, version, platformVersion: "^1.0" },
      files: [
        { path: "manifest.json", content: Buffer.from(JSON.stringify({ name, platformVersion: "^1.0", pageAccess: { level: "owner" } })) },
        { path: "dist/index.html", content: Buffer.from(`<h1>${version}</h1>`) },
        ...migrations.map(([filename, sql]) => ({ path: `migrations/${filename}`, content: Buffer.from(sql) })),
      ],
    });
    return outputPath;
  }

  async function install(packagePath: string, ownerId: string): Promise<void> {
    await installAppPackage({ dataDir, ownerId, packagePath });
  }

  async function provisionUser(username: string, password: string): Promise<void> {
    const created = await request("/api/admin/users", {
      method: "POST",
      headers: { "X-API-Key": getTestApiKey(), "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    const credentials = created.body.data.credentials;
    const changed = await request("/api/auth/force-change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: username, oldPassword: credentials.temporaryPassword, newPassword: password }),
    });
    expect(changed.response.status).toBe(200);
  }

  async function login(username: string, password: string): Promise<string> {
    const result = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    expect(result.response.status).toBe(200);
    return result.response.headers.get("set-cookie")!.split(";")[0];
  }

  async function createApiKey(cookie: string): Promise<string> {
    const result = await request("/api/keys", { method: "POST", headers: { Cookie: cookie } });
    expect(result.response.status).toBe(200);
    return String(result.body.data.key);
  }

  async function waitForJob(id: string): Promise<any> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const result = await request(`/api/sync-jobs/${id}`, { headers: { Cookie: adminCookie } });
      const job = result.body.data;
      if (["completed", "rolled-back", "failed", "recovery-required"].includes(job.status)) return job;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for synchronization job ${id}`);
  }

  async function request(route: string, init: RequestInit = {}): Promise<{ response: Response; body: any }> {
    const response = await fetch(`${baseUrl}${route}`, init);
    return { response, body: response.status === 204 ? null : await response.json().catch(() => null) };
  }
});

async function sqlRows(dbPath: string, sql: string): Promise<Record<string, unknown>[]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const result = db.exec(sql);
  const columns = result[0]?.columns ?? [];
  const rows = (result[0]?.values ?? []).map((values) => Object.fromEntries(columns.map((column, index) => [column, values[index]])));
  db.close();
  return rows;
}

async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}
