import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerConfig } from "../config.js";
import { createDataArchive } from "../app-data-archive.js";
import {
  createAppBackup,
  createAppDataExport,
  importAppData,
  listAppBackups,
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
    listenHost: "127.0.0.1",
    listenPort: 3000,
    publicUrl: "",
    workspaceDir: path.join(dataDir, "workspaces"),
    jwtKeyFile: path.join(dataDir, "jwt.key"),
    masterKeyFile: path.join(dataDir, "master.key"),
    allowInsecureLan: false,
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

async function databaseWithContentReferences(owner: string): Promise<Buffer> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE records (id INTEGER PRIMARY KEY, file_key TEXT NOT NULL, file_url TEXT NOT NULL, metadata TEXT NOT NULL, created_by TEXT NOT NULL)");
  db.run("INSERT INTO records VALUES (1, ?, ?, ?, ?)", [
    `${owner}/demo/0123456789abcdef0123.png`,
    `/serve/${owner}/demo/api/content/0123456789abcdef0123.png`,
    `  ${JSON.stringify({
      preview: `/serve/${owner}/demo/api/content/0123456789abcdef0123.png`,
      note: `do not rewrite ${owner}/demo/ inside prose`,
    })}`,
    owner,
  ]);
  const bytes = Buffer.from(db.export());
  db.close();
  return bytes;
}

async function readContentReferences(dbPath: string): Promise<string[]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const values = db.exec("SELECT file_key, file_url, metadata, created_by FROM records")[0].values[0].map(String);
  db.close();
  return values;
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

  it("reuses a caller-provided safety backup instead of creating a duplicate", async () => {
    const exported = await createAppDataExport({ pageDir, application, limits, storage });
    const safety = await createAppBackup(pageDir, {
      application,
      limits,
      storage,
      source: "automatic",
      reason: "peer-data-sync",
    });

    const result = await importAppData({
      pageDir,
      application,
      archivePath: exported.archivePath,
      limits,
      storage,
      reason: "peer-data-sync",
      safetyBackupId: safety.id,
    });

    expect(result.safetyBackupId).toBe(safety.id);
    expect(listAppBackups(pageDir)).toHaveLength(1);
    exported.cleanup();
  });

  it("rebases database content references when importing data for another peer owner", async () => {
    fs.writeFileSync(dbPath, await databaseWithContentReferences("alice"));
    const schemaDir = path.join(pageDir, "versions/v1/backend/resources/records");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.writeFileSync(path.join(schemaDir, "schema.json"), JSON.stringify({
      name: "records",
      business: { ownerField: "created_by" },
    }));
    await putObject("alice/demo/0123456789abcdef0123.png", Buffer.from("image"), "image/png");
    const exported = await createAppDataExport({
      pageDir,
      application,
      archiveApplication: { owner: "bob", name: "demo", version: 1 },
      limits,
      storage,
    });
    const targetDir = path.join(dataDir, "bob", "demo");
    fs.mkdirSync(path.join(targetDir, "migrations"), { recursive: true });
    fs.writeFileSync(path.join(targetDir, "migrations/001_init.sql"), "CREATE TABLE records (id INTEGER PRIMARY KEY, file_key TEXT NOT NULL, file_url TEXT NOT NULL, metadata TEXT NOT NULL, created_by TEXT NOT NULL);");
    fs.writeFileSync(path.join(targetDir, "app.db"), await databaseWithContentReferences("bob"));

    await importAppData({
      pageDir: targetDir,
      application: { owner: "bob", name: "demo", version: 1 },
      archivePath: exported.archivePath,
      limits,
      storage,
      reason: "peer-data-sync",
    });

    expect(await readContentReferences(path.join(targetDir, "app.db"))).toEqual([
      "bob/demo/0123456789abcdef0123.png",
      "/serve/bob/demo/api/content/0123456789abcdef0123.png",
      JSON.stringify({
        preview: "/serve/bob/demo/api/content/0123456789abcdef0123.png",
        note: "do not rewrite alice/demo/ inside prose",
      }),
      "bob",
    ]);
    exported.cleanup();
  });

  it("forces declared identity fields to the target owner when source metadata is absent", async () => {
    const candidateDatabase = path.join(dataDir, "candidate.db");
    const candidateArchive = path.join(dataDir, "candidate.zip");
    fs.writeFileSync(candidateDatabase, await databaseWithContentReferences("alice"));
    await createDataArchive({
      outputPath: candidateArchive,
      databasePath: candidateDatabase,
      application: { owner: "bob", name: "demo", version: 1 },
      objects: [],
      openObject: async () => null,
      limits,
    });

    const targetDir = path.join(dataDir, "bob", "demo");
    fs.mkdirSync(path.join(targetDir, "migrations"), { recursive: true });
    fs.mkdirSync(path.join(targetDir, "versions/v1/backend/resources/records"), { recursive: true });
    fs.writeFileSync(path.join(targetDir, "migrations/001_init.sql"), "CREATE TABLE records (id INTEGER PRIMARY KEY, file_key TEXT NOT NULL, file_url TEXT NOT NULL, metadata TEXT NOT NULL, created_by TEXT NOT NULL);");
    fs.writeFileSync(path.join(targetDir, "versions/v1/backend/resources/records/schema.json"), JSON.stringify({
      name: "records",
      business: { ownerField: "created_by" },
    }));
    fs.writeFileSync(path.join(targetDir, "app.db"), await databaseWithContentReferences("bob"));

    await importAppData({
      pageDir: targetDir,
      application: { owner: "bob", name: "demo", version: 1 },
      archivePath: candidateArchive,
      limits,
      storage,
      reason: "peer-data-sync",
    });

    expect((await readContentReferences(path.join(targetDir, "app.db")))[3]).toBe("bob");
  });

  it("rejects cross-owner export when custom user-owned SQL omits an identity declaration", async () => {
    fs.writeFileSync(dbPath, await databaseWithContentReferences("alice"));
    const resourceDir = path.join(pageDir, "versions/v1/backend/resources/records");
    fs.mkdirSync(resourceDir, { recursive: true });
    fs.writeFileSync(path.join(resourceDir, "schema.json"), JSON.stringify({ name: "records" }));
    fs.writeFileSync(path.join(resourceDir, "queries.json"), JSON.stringify({
      queries: {
        "$records.list": {
          sql: "SELECT * FROM records WHERE created_by = :currentUserId",
          security: { mode: "custom", systemParams: ["currentUserId"] },
        },
      },
    }));

    await expect(createAppDataExport({
      pageDir,
      application,
      archiveApplication: { owner: "bob", name: "demo", version: 1 },
      limits,
      storage,
    })).rejects.toMatchObject({ code: "APP_DATA_IDENTITY_CONTRACT_REQUIRED" });
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
