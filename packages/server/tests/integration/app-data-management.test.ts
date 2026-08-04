import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerAndLogin } from "../helpers/createUser.js";
import { createTestPage, createTestServer, getAppUrl } from "./helpers.js";
import { getObject, putObject } from "../../src/lib/s3-client.js";
import { extractAndValidateDataArchive } from "../../src/lib/app-data-archive.js";
import { readPageMeta, writePageMeta } from "../../src/plugins/storage.js";

async function databaseBytes(value: string): Promise<Buffer> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  db.run("INSERT INTO records VALUES (1, ?)", [value]);
  const bytes = Buffer.from(db.export());
  db.close();
  return bytes;
}

async function readValue(file: string): Promise<string | null> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(file));
  const result = db.exec("SELECT value FROM records WHERE id = 1");
  db.close();
  return result[0] ? String(result[0].values[0][0]) : null;
}

describe("application data management API", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  let cookie: string;
  const owner = "dataowner";
  const name = "data-app";
  let pageDir: string;
  let dbPath: string;
  let exportedArchive: Buffer;
  const contentKey = `${owner}/${name}/0123456789abcdef0123.png`;
  const issueKey = `issues/${owner}/${name}/attachment/content`;

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;
    cookie = await registerAndLogin(baseUrl, owner);
    await createTestPage(app, owner, name);
    pageDir = path.join(dataDir, owner, name);
    dbPath = path.join(pageDir, "app.db");
    fs.writeFileSync(dbPath, await databaseBytes("original"));
    fs.writeFileSync(path.join(pageDir, "manifest.json"), JSON.stringify({ name, description: "source" }));
    fs.writeFileSync(path.join(pageDir, "manifest.platform.json"), JSON.stringify({
      description: "platform",
      lifecycle: { status: "offline" },
    }));
    const meta = readPageMeta(dataDir, owner, name)!;
    meta.lifecycle = { status: "offline" };
    writePageMeta(dataDir, owner, name, meta);
    fs.mkdirSync(path.join(pageDir, "versions", "v1"), { recursive: true });
    fs.writeFileSync(path.join(pageDir, "versions", "v1", "index.html"), "app");
    fs.mkdirSync(path.join(pageDir, "migrations"));
    fs.writeFileSync(path.join(pageDir, "migrations", "001_init.sql"), "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);");
    await putObject(contentKey, Buffer.from("business-file"), "image/png");
    await putObject(issueKey, Buffer.from("issue-file"), "application/octet-stream");
  });

  afterAll(async () => {
    await stop();
  });

  it("exports a ZIP containing the database and both application file namespaces", async () => {
    const response = await fetch(`${baseUrl}/api/me/pages/${name}/data/export`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/zip");
    expect(response.headers.get("content-disposition")).toContain(`${name}-`);
    expect(response.headers.get("content-disposition")).toContain(".zip");
    expect(response.headers.get("cache-control")).toBe("no-store");
    exportedArchive = Buffer.from(await response.arrayBuffer());
    const archivePath = path.join(dataDir, "exported.zip");
    fs.writeFileSync(archivePath, exportedArchive);
    const extracted = await extractAndValidateDataArchive({
      archivePath,
      stagingDir: path.join(dataDir, "exported"),
      expectedApplication: { owner, name, maxVersion: 1 },
      limits: { maxCompressedBytes: 10_000_000, maxExpandedBytes: 20_000_000, maxFileEntries: 100 },
    });
    expect(extracted.files.map(({ objectKey }) => objectKey)).toEqual([contentKey, issueKey]);
  });

  it("creates, lists, downloads, and restores a managed backup", async () => {
    const created = await fetch(`${baseUrl}/api/me/pages/${name}/data/backups`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "before change" }),
    });
    expect(created.status).toBe(200);
    const backup = (await created.json()).data;

    const listing = await fetch(`${baseUrl}/api/me/pages/${name}/data`, { headers: { Cookie: cookie } });
    await expect(listing.json()).resolves.toMatchObject({
      success: true,
      data: { files: { count: 2, size: 23 }, backups: [{ id: backup.id, format: "zip", fileCount: 2 }] },
    });

    const downloaded = await fetch(`${baseUrl}/api/me/pages/${name}/data/backups/${backup.id}/download`, { headers: { Cookie: cookie } });
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers.get("content-type")).toContain("application/zip");

    fs.writeFileSync(dbPath, await databaseBytes("changed"));
    const restored = await fetch(`${baseUrl}/api/me/pages/${name}/data/backups/${backup.id}/restore`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: name }),
    });
    expect(restored.status).toBe(200);
    expect(await readValue(dbPath)).toBe("original");
    expect(readPageMeta(dataDir, owner, name)?.lifecycle).toEqual({ status: "offline" });
  });

  it("imports a valid archive and rejects invalid input without data loss", async () => {
    fs.writeFileSync(dbPath, await databaseBytes("changed-before-import"));
    await putObject(contentKey, Buffer.from("changed-file"), "image/png");
    const valid = new FormData();
    valid.set("confirmName", name);
    valid.set("archive", new Blob([exportedArchive], { type: "application/zip" }), "import.zip");
    const imported = await fetch(`${baseUrl}/api/me/pages/${name}/data/import`, { method: "POST", headers: { Cookie: cookie }, body: valid });
    expect(imported.status).toBe(200);
    expect(await readValue(dbPath)).toBe("original");
    expect((await getObject(contentKey))?.body.toString()).toBe("business-file");
    expect(readPageMeta(dataDir, owner, name)?.lifecycle).toEqual({ status: "offline" });

    const invalid = new FormData();
    invalid.set("confirmName", name);
    invalid.set("archive", new Blob(["broken"]), "bad.zip");
    const rejected = await fetch(`${baseUrl}/api/me/pages/${name}/data/import`, { method: "POST", headers: { Cookie: cookie }, body: invalid });
    expect(rejected.status).toBe(400);
    expect(await readValue(dbPath)).toBe("original");
  });

  it("factory-resets data and platform settings while preserving the app and versions", async () => {
    const response = await fetch(`${baseUrl}/api/me/pages/${name}/data/factory-reset`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: name }),
    });

    expect(response.status).toBe(200);
    expect(fs.existsSync(path.join(pageDir, "meta.json"))).toBe(true);
    expect(fs.existsSync(path.join(pageDir, "versions", "v1", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(pageDir, "manifest.platform.json"))).toBe(false);
    expect(await readValue(dbPath)).toBeNull();
    expect(await getObject(contentKey)).toBeNull();
    expect(await getObject(issueKey)).toBeNull();
    expect(JSON.parse(fs.readFileSync(path.join(pageDir, "meta.json"), "utf8"))).toMatchObject({
      name,
      currentVersion: 1,
      description: "source",
    });
    expect(readPageMeta(dataDir, owner, name)?.lifecycle).toBeUndefined();
  });

  it("requires exact application-name confirmation", async () => {
    const response = await fetch(`${baseUrl}/api/me/pages/${name}/data/factory-reset`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: "wrong" }),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "APP_CONFIRMATION_MISMATCH" });
  });
});
