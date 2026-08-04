import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../config.js";
import {
  createAppDataExport,
  importAppData,
  type AppDataStorage,
} from "../app-data-service.js";
import {
  deleteObject,
  getObject,
  initContentStorage,
  listAppObjects,
  openObject,
  putObject,
  putObjectFromFile,
} from "../s3-client.js";

const limits = { maxCompressedBytes: 10 * 1024 * 1024, maxExpandedBytes: 20 * 1024 * 1024, maxFileEntries: 100 };
const application = { owner: "alice", name: "demo", version: 1 };

function config(dataDir: string): ServerConfig {
  return {
    port: 3000,
    dataDir,
    jwtSecret: "",
    bootstrapApiKey: "",
    templateRepoUrl: "",
    gitDownloadUrl: "",
    adminStaticDir: "",
    minCliVersion: "",
    releaseManifestUrl: "",
    llmApiKey: "",
    llmModel: "",
    llmBaseUrl: "",
    minioEndpoint: "127.0.0.1:19999",
    minioAccessKey: "none",
    minioSecretKey: "none",
    minioBucket: "test",
    adminDefaultPassword: "admin",
    appDataArchiveMaxBytes: 2 * 1024 * 1024 * 1024,
    appDataExpandedMaxBytes: 4 * 1024 * 1024 * 1024,
    appDataArchiveMaxFiles: 10_000,
  };
}

async function databaseBytes(value: string): Promise<Buffer> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  db.run("INSERT INTO records VALUES (1, ?)", [value]);
  const bytes = Buffer.from(db.export());
  db.close();
  return bytes;
}

async function readValue(dbPath: string): Promise<string> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const value = String(db.exec("SELECT value FROM records")[0].values[0][0]);
  db.close();
  return value;
}

const storage: AppDataStorage = { listAppObjects, getObject, openObject, putObject, putObjectFromFile, deleteObject };

describe("application data service", () => {
  let dataDir: string;
  let pageDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-data-service-"));
    pageDir = path.join(dataDir, application.owner, application.name);
    dbPath = path.join(pageDir, "app.db");
    fs.mkdirSync(path.join(pageDir, "migrations"), { recursive: true });
    fs.writeFileSync(path.join(pageDir, "migrations/001_init.sql"), "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL);");
    fs.writeFileSync(dbPath, await databaseBytes("original"));
    await initContentStorage(config(dataDir));
  });

  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  it("exports and restores the database, Content files, and Issue attachments", async () => {
    const contentKey = "alice/demo/0123456789abcdef0123.png";
    const issueKey = "issues/alice/demo/attachment/content";
    await putObject(contentKey, Buffer.from("original-content"), "image/png");
    await putObject(issueKey, Buffer.from("original-issue"), "application/octet-stream");
    const exported = await createAppDataExport({ pageDir, application, limits, storage });

    fs.writeFileSync(dbPath, await databaseBytes("changed"));
    await putObject(contentKey, Buffer.from("changed-content"), "image/png");
    await deleteObject(issueKey);
    await putObject("alice/demo/fedcba98765432100123.pdf", Buffer.from("stale"), "application/pdf");

    const result = await importAppData({ pageDir, application, archivePath: exported.archivePath, limits, storage, reason: "import" });

    expect(await readValue(dbPath)).toBe("original");
    expect((await getObject(contentKey))?.body.toString()).toBe("original-content");
    expect((await getObject(issueKey))?.body.toString()).toBe("original-issue");
    expect(await getObject("alice/demo/fedcba98765432100123.pdf")).toBeNull();
    expect(result).toMatchObject({ fileCount: 2, safetyBackupId: expect.any(String) });
    exported.cleanup();
  });

  it("rolls database and files back when replacement fails after the database swap", async () => {
    const currentKey = "alice/demo/0123456789abcdef0123.png";
    const staleKey = "alice/demo/fedcba98765432100123.pdf";
    await putObject(currentKey, Buffer.from("candidate"), "image/png");
    fs.writeFileSync(dbPath, await databaseBytes("candidate"));
    const candidate = await createAppDataExport({ pageDir, application, limits, storage });

    await putObject(currentKey, Buffer.from("current"), "image/png");
    await putObject(staleKey, Buffer.from("keep-on-rollback"), "application/pdf");
    fs.writeFileSync(dbPath, await databaseBytes("current"));

    let injected = false;
    const failingStorage: AppDataStorage = {
      ...storage,
      deleteObject: async (key) => {
        if (!injected && key === staleKey) {
          injected = true;
          throw new Error("injected delete failure");
        }
        await deleteObject(key);
      },
    };

    await expect(importAppData({ pageDir, application, archivePath: candidate.archivePath, limits, storage: failingStorage, reason: "import" }))
      .rejects.toThrow("injected delete failure");
    expect(await readValue(dbPath)).toBe("current");
    expect((await getObject(currentKey))?.body.toString()).toBe("current");
    expect((await getObject(staleKey))?.body.toString()).toBe("keep-on-rollback");
    candidate.cleanup();
  });
});
