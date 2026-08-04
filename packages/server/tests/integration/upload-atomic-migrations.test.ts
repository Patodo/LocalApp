import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import {
  createTestServer,
  getAppUrl,
  getTestApiKey,
} from "./helpers.js";

describe("upload atomic migrations", () => {
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const userId = "localadmin";

  beforeAll(async () => {
    const server = await createTestServer();
    baseUrl = getAppUrl(server.app);
    dataDir = server.dataDir;
    stop = server.stop;
  });

  afterAll(async () => {
    await stop();
  });

  it("applies migration and deploys dist in one upload", async () => {
    const pageName = "atomic-migration-ok";
    await createPage(pageName);

    const { body, contentType } = multipart([
      field("name", pageName),
      file("files", "index.html", "<html><body>v1</body></html>", "text/html"),
      ...migrationFile("001_init.sql", "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);"),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": contentType },
      body,
    });

    expect(res.status).toBe(200);
    const appDb = path.join(dataDir, userId, pageName, "app.db");
    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(appDb));
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'");
    const migrations = db.exec("SELECT filename FROM _localapp_applied_migrations");
    db.close();

    expect(tables[0]?.values).toEqual([["tasks"]]);
    expect(migrations[0]?.values).toEqual([["001_init.sql"]]);

    const served = await fetch(`${baseUrl}/serve/${userId}/${pageName}/index.html`);
    expect(await served.text()).toBe("<html><body>v1</body></html>");
  });

  it("rolls back db and leaves dist invisible when migration fails", async () => {
    const pageName = "atomic-migration-fail";
    await createPage(pageName);

    const okUpload = multipart([
      field("name", pageName),
      file("files", "index.html", "<html><body>old</body></html>", "text/html"),
    ]);
    const okRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": okUpload.contentType },
      body: okUpload.body,
    });
    expect(okRes.status).toBe(200);

    const badUpload = multipart([
      field("name", pageName),
      file("files", "index.html", "<html><body>new</body></html>", "text/html"),
      ...migrationFile("001_bad.sql", "CREATE TABLE broken (id INTEGER;"),
    ]);
    const badRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": badUpload.contentType },
      body: badUpload.body,
    });

    expect(badRes.status).toBe(422);
    expect(await badRes.json()).toMatchObject({
      success: false,
      code: "UPLOAD_MIGRATION_APPLY_FAILED",
      error: expect.stringContaining("001_bad.sql"),
    });
    const served = await fetch(`${baseUrl}/serve/${userId}/${pageName}/index.html`);
    expect(await served.text()).toBe("<html><body>old</body></html>");

    const versionsDir = path.join(dataDir, userId, pageName, "versions");
    expect(fs.readdirSync(versionsDir).some((name) => name.startsWith(".staging-"))).toBe(false);

    const appDb = path.join(dataDir, userId, pageName, "app.db");
    expect(fs.existsSync(appDb)).toBe(false);
  });

  it("rejects migration when declared checksum does not match", async () => {
    const pageName = "atomic-checksum";
    await createPage(pageName);

    const upload = multipart([
      field("name", pageName),
      field("migrationChecksum_001_init.sql", "not-the-real-checksum"),
      file("files", "index.html", "<html><body>checksum</body></html>", "text/html"),
      file(
        "migration_001_init.sql",
        "001_init.sql",
        "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);",
        "application/sql",
      ),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "UPLOAD_MIGRATION_INVALID",
      path: "001_init.sql",
      error: expect.stringContaining("checksum"),
    });
    expect(fs.existsSync(path.join(dataDir, userId, pageName, "app.db"))).toBe(false);
  });

  it("rejects migration when checksum is missing", async () => {
    const pageName = "atomic-checksum-missing";
    await createPage(pageName);

    const upload = multipart([
      field("name", pageName),
      file("files", "index.html", "<html><body>checksum missing</body></html>", "text/html"),
      file(
        "migration_001_init.sql",
        "001_init.sql",
        "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);",
        "application/sql",
      ),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      code: "UPLOAD_MIGRATION_INVALID",
      path: "001_init.sql",
      error: expect.stringContaining("checksum missing"),
    });
    expect(fs.existsSync(path.join(dataDir, userId, pageName, "app.db"))).toBe(false);
  });

  it("rotates app.db backups before applying pending migrations", async () => {
    const pageName = "atomic-backups";
    await createPage(pageName);

    const migrations: Array<[string, string]> = [];
    for (const [filename, sql] of [
      ["001_init.sql", "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);"],
      ["002_notes.sql", "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT);"],
      ["003_flags.sql", "CREATE TABLE flags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);"],
    ] as Array<[string, string]>) {
      migrations.push([filename, sql]);
      const upload = multipart([
        field("name", pageName),
        file("files", "index.html", `<html><body>${filename}</body></html>`, "text/html"),
        ...migrationFiles(migrations),
      ]);
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
        body: upload.body,
      });
      expect(res.status).toBe(200);
    }

    const pageDir = path.join(dataDir, userId, pageName);
    expect(fs.existsSync(path.join(pageDir, "app.db.backup.v1"))).toBe(true);
    expect(fs.existsSync(path.join(pageDir, "app.db.backup.v2"))).toBe(true);
  });

  it("does not rotate app.db backups when uploaded migrations are already applied", async () => {
    const pageName = "atomic-no-pending-backup";
    await createPage(pageName);
    const sql = "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);";

    for (const marker of ["first", "second"]) {
      const upload = multipart([
        field("name", pageName),
        file("files", "index.html", `<html><body>${marker}</body></html>`, "text/html"),
        ...migrationFile("001_init.sql", sql),
      ]);
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
        body: upload.body,
      });
      expect(res.status).toBe(200);
    }

    const pageDir = path.join(dataDir, userId, pageName);
    expect(fs.existsSync(path.join(pageDir, "app.db"))).toBe(true);
    expect(fs.existsSync(path.join(pageDir, "app.db.backup.v1"))).toBe(false);
    expect(fs.existsSync(path.join(pageDir, "app.db.backup.v2"))).toBe(false);
  });

  it("rejects upload when an already applied migration is missing", async () => {
    const pageName = "atomic-missing-applied-migration";
    await createPage(pageName);
    const sql = "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);";

    const firstUpload = multipart([
      field("name", pageName),
      file("files", "index.html", "<html><body>first</body></html>", "text/html"),
      ...migrationFile("001_init.sql", sql),
    ]);
    const firstRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": firstUpload.contentType },
      body: firstUpload.body,
    });
    expect(firstRes.status).toBe(200);

    const secondUpload = multipart([
      field("name", pageName),
      file("files", "index.html", "<html><body>second</body></html>", "text/html"),
    ]);
    const secondRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": secondUpload.contentType },
      body: secondUpload.body,
    });

    expect(secondRes.status).toBe(409);
    expect(await secondRes.json()).toMatchObject({
      success: false,
      code: "UPLOAD_MIGRATION_CONFLICT",
      path: "001_init.sql",
      error: expect.stringContaining("missing from this upload"),
    });
  });

  it("accepts manifest bundle without schemas field", async () => {
    const pageName = "atomic-manifest-no-schemas";
    await createPage(pageName);

    const upload = multipart([
      field("name", pageName),
      file("manifest", "manifest.json", JSON.stringify({ name: pageName, distDir: "dist" }), "application/json"),
      file("files", "index.html", "<html><body>manifest</body></html>", "text/html"),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(200);
  });

  it("persists the uploaded source manifest and keeps platform overrides effective", async () => {
    const pageName = "atomic-manifest-overlay";
    await createPage(pageName);
    const pageDir = path.join(dataDir, userId, pageName);
    fs.writeFileSync(path.join(pageDir, "manifest.platform.json"), JSON.stringify({
      description: "platform description",
      shell: { navbar: false },
      lifecycle: { status: "offline" },
    }));
    const sourceManifest = {
      name: pageName,
      description: "source description",
      distDir: "dist",
      shell: { navbar: true },
      db: { mode: "crud", defaultAccess: { read: "public" } },
    };

    const upload = multipart([
      field("name", pageName),
      file("manifest", "manifest.json", JSON.stringify(sourceManifest), "application/json"),
      file("files", "index.html", "<html><body>overlay</body></html>", "text/html"),
    ]);
    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(200);
    expect(JSON.parse(fs.readFileSync(path.join(pageDir, "manifest.json"), "utf8"))).toEqual(sourceManifest);
    expect(JSON.parse(fs.readFileSync(path.join(pageDir, "manifest.platform.json"), "utf8"))).toMatchObject({
      description: "platform description",
      lifecycle: { status: "offline" },
    });
    expect(JSON.parse(fs.readFileSync(path.join(pageDir, "meta.json"), "utf8"))).toMatchObject({
      description: "platform description",
      shell: { navbar: false },
      db: { mode: "crud", defaultAccess: { read: "public" } },
      lifecycle: { status: "offline" },
    });
  });

  it("stores backend contract files in the uploaded version", async () => {
    const pageName = "atomic-backend-contract";
    await createPage(pageName);

    const upload = multipart([
      field("name", pageName),
      field("backendFilepath_0", "backend/resources/work_items/schema.json"),
      file("files", "index.html", "<html><body>backend</body></html>", "text/html"),
      file("backendFiles", "schema.json", JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
        name: "work_items",
        fields: {},
      }), "application/json"),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(200);
    const stored = path.join(dataDir, userId, pageName, "versions", "v1", "backend", "resources", "work_items", "schema.json");
    expect(JSON.parse(fs.readFileSync(stored, "utf8")).name).toBe("work_items");
  });

  it("rejects upload when manifest platformVersion major does not match server", async () => {
    const pageName = "atomic-platform-version-mismatch";
    await createPage(pageName);

    const upload = multipart([
      field("name", pageName),
      file("manifest", "manifest.json", JSON.stringify({ name: pageName, platformVersion: "^2.0" }), "application/json"),
      file("files", "index.html", "<html><body>mismatch</body></html>", "text/html"),
    ]);

    const res = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("Platform version mismatch"),
    });
  });

  it("stores normalized Issue templates and atomically rejects invalid template config", async () => {
    const pageName = "atomic-issue-templates";
    await createPage(pageName);
    const validManifest = {
      name: pageName,
      platformVersion: "^1.0",
      issues: { templates: [{ id: "bug-report", name: " Bug report ", description: " Report a defect ", titlePrefix: "[Bug] ", type: "bug", labels: ["triage", "triage"] }] },
    };
    const validUpload = multipart([
      field("name", pageName),
      file("manifest", "manifest.json", JSON.stringify(validManifest), "application/json"),
      file("files", "index.html", "<html><body>templates</body></html>", "text/html"),
    ]);
    const validResponse = await fetch(`${baseUrl}/api/upload`, { method: "POST", headers: { "X-API-Key": apiKey, "Content-Type": validUpload.contentType }, body: validUpload.body });
    expect(validResponse.status).toBe(200);
    const metaPath = path.join(dataDir, userId, pageName, "meta.json");
    expect(JSON.parse(fs.readFileSync(metaPath, "utf8"))).toMatchObject({
      currentVersion: 1,
      issues: { templates: [{ id: "bug-report", name: "Bug report", description: "Report a defect", labels: ["triage"] }] },
    });

    const invalidUpload = multipart([
      field("name", pageName),
      file("manifest", "manifest.json", JSON.stringify({ ...validManifest, issues: { templates: [{ id: "Bad_ID", name: "Bad", description: "Bad" }] } }), "application/json"),
      file("files", "index.html", "<html><body>invalid</body></html>", "text/html"),
    ]);
    const invalidResponse = await fetch(`${baseUrl}/api/upload`, { method: "POST", headers: { "X-API-Key": apiKey, "Content-Type": invalidUpload.contentType }, body: invalidUpload.body });
    expect(invalidResponse.status).toBe(400);
    await expect(invalidResponse.json()).resolves.toMatchObject({ success: false, code: "invalid_issue_templates", path: "issues.templates[0].id" });
    expect(JSON.parse(fs.readFileSync(metaPath, "utf8")).currentVersion).toBe(1);
  });

  async function createPage(name: string): Promise<void> {
    const res = await fetch(`${baseUrl}/api/pages`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    expect(res.status).toBe(200);
  }
});

function multipart(parts: string[]): { body: string; contentType: string } {
  const boundary = `----AtomicUpload${Date.now()}`;
  return {
    body: `${parts.map((part) => `--${boundary}\r\n${part}`).join("")}--${boundary}--\r\n`,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function field(name: string, value: string): string {
  return `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
}

function migrationFile(filename: string, content: string): string[] {
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  return [
    field(`migrationChecksum_${filename}`, checksum),
    file(`migration_${filename}`, filename, content, "application/sql"),
  ];
}

function migrationFiles(entries: Array<[string, string]>): string[] {
  return entries.flatMap(([filename, content]) => migrationFile(filename, content));
}

function file(name: string, filename: string, content: string, contentType: string): string {
  return [
    `Content-Disposition: form-data; name="${name}"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
    content,
    "",
  ].join("\r\n");
}
