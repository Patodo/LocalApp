import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initContentStorage, putObject, getObject } from "../s3-client.js";
import type { ServerConfig } from "../config.js";
import {
  AppDataError,
  createAppBackup,
  deleteAppBackup,
  listAppBackups,
  replaceAppDatabase,
  resetAppDatabase,
  restoreAppBackup,
  withAppDataLock,
} from "../app-backups.js";

async function sqliteBytes(title: string): Promise<Buffer> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL)");
  db.run("INSERT INTO items (id, title) VALUES (1, ?)", [title]);
  const bytes = Buffer.from(db.export());
  db.close();
  return bytes;
}

async function readTitle(filePath: string): Promise<string> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(filePath));
  const title = db.exec("SELECT title FROM items WHERE id = 1")[0]?.values[0]?.[0];
  db.close();
  return String(title);
}

describe("application database backups", () => {
  let dataDir: string;
  let pageDir: string;
  let dbPath: string;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-app-backup-"));
    pageDir = path.join(dataDir, "dataowner", "app");
    fs.mkdirSync(pageDir, { recursive: true });
    dbPath = path.join(pageDir, "app.db");
    fs.writeFileSync(dbPath, await sqliteBytes("original"));
    await initContentStorage({
      port: 3000, dataDir, jwtSecret: "", bootstrapApiKey: "", templateRepoUrl: "", gitDownloadUrl: "", adminStaticDir: "", minCliVersion: "", releaseManifestUrl: "",
      llmApiKey: "", llmModel: "", llmBaseUrl: "", minioEndpoint: "127.0.0.1:19999", minioAccessKey: "none", minioSecretKey: "none",
      minioBucket: "test", adminDefaultPassword: "admin",
      appDataArchiveMaxBytes: 2 * 1024 * 1024 * 1024, appDataExpandedMaxBytes: 4 * 1024 * 1024 * 1024, appDataArchiveMaxFiles: 10_000,
    } satisfies ServerConfig);
  });

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("creates metadata-backed manual backups and lists newest first", async () => {
    const first = await createAppBackup(pageDir, { name: "before import", source: "manual" });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await createAppBackup(pageDir, { name: "nightly", source: "manual" });

    expect(listAppBackups(pageDir).map((backup) => backup.id)).toEqual([second.id, first.id]);
    expect(first).toMatchObject({ name: "before import", source: "manual", format: "zip", fileCount: 0 });
    expect(first.size).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(pageDir, "backups", `${first.id}.zip`))).toBe(true);
  });

  it("rejects invalid SQLite without replacing or backing up the current database", async () => {
    await expect(replaceAppDatabase(pageDir, Buffer.from("not sqlite"), "import")).rejects.toMatchObject({
      code: "APP_DATABASE_INVALID",
    });
    expect(await readTitle(dbPath)).toBe("original");
    expect(listAppBackups(pageDir)).toEqual([]);
  });

  it("creates a safety backup before replacing and can restore it", async () => {
    await replaceAppDatabase(pageDir, await sqliteBytes("imported"), "import");

    expect(await readTitle(dbPath)).toBe("imported");
    const [safety] = listAppBackups(pageDir);
    expect(safety).toMatchObject({ source: "automatic", reason: "import" });

    await restoreAppBackup(pageDir, safety.id);
    expect(await readTitle(dbPath)).toBe("original");
    expect(listAppBackups(pageDir)).toHaveLength(2);
  });

  it("lists and restores legacy database-only backups without changing application files", async () => {
    const id = "12345678-1234-4123-8123-123456789abc";
    const backupsDir = path.join(pageDir, "backups");
    fs.mkdirSync(backupsDir, { recursive: true });
    fs.writeFileSync(path.join(backupsDir, `${id}.db`), await sqliteBytes("legacy"));
    fs.writeFileSync(path.join(backupsDir, `${id}.json`), JSON.stringify({
      id,
      name: "Legacy backup",
      createdAt: "2026-01-01T00:00:00.000Z",
      source: "manual",
    }));
    const objectKey = "dataowner/app/0123456789abcdef0123.png";
    await putObject(objectKey, Buffer.from("keep-file"), "image/png");

    expect(listAppBackups(pageDir)).toEqual([
      expect.objectContaining({ id, format: "legacy-db", fileCount: 0, fileSize: 0 }),
    ]);
    await restoreAppBackup(pageDir, id);

    expect(await readTitle(dbPath)).toBe("legacy");
    expect((await getObject(objectKey))?.body.toString()).toBe("keep-file");
    expect(listAppBackups(pageDir)).toHaveLength(2);
    expect(listAppBackups(pageDir)[0]).toMatchObject({ format: "zip", source: "automatic", reason: `restore:${id}` });
  });

  it("rejects unknown and traversal backup IDs", async () => {
    await expect(restoreAppBackup(pageDir, "../app.db")).rejects.toMatchObject({
      code: "APP_BACKUP_NOT_FOUND",
    });
    await expect(restoreAppBackup(pageDir, "missing")).rejects.toMatchObject({
      code: "APP_BACKUP_NOT_FOUND",
    });
  });

  it("deletes only the requested managed backup", async () => {
    const keep = await createAppBackup(pageDir, { name: "keep", source: "manual" });
    const remove = await createAppBackup(pageDir, { name: "remove", source: "manual" });

    await deleteAppBackup(pageDir, remove.id);

    expect(listAppBackups(pageDir).map((backup) => backup.id)).toEqual([keep.id]);
    expect(fs.existsSync(path.join(pageDir, "backups", `${remove.id}.zip`))).toBe(false);
  });

  it("serializes mutations for one app while allowing another app", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = withAppDataLock(pageDir, async () => held);

    await expect(withAppDataLock(pageDir, async () => undefined)).rejects.toEqual(
      new AppDataError("APP_DATA_OPERATION_BUSY", "Another data operation is already running"),
    );

    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-app-backup-other-"));
    await expect(withAppDataLock(otherDir, async () => "ok")).resolves.toBe("ok");
    fs.rmSync(otherDir, { recursive: true, force: true });
    release();
    await first;
  });

  it("rebuilds an empty database from current migrations and keeps a safety backup", async () => {
    const migrationsDir = path.join(pageDir, "migrations");
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      "CREATE TABLE items (id INTEGER PRIMARY KEY, title TEXT NOT NULL);",
    );
    await putObject("dataowner/app/0123456789abcdef0123.png", Buffer.from("attachment"), "image/png");

    await resetAppDatabase(pageDir);

    const SQL = await initSqlJs();
    const db = new SQL.Database(fs.readFileSync(dbPath));
    expect(db.exec("SELECT COUNT(*) FROM items")[0]?.values[0]?.[0]).toBe(0);
    db.close();
    expect(listAppBackups(pageDir)[0]).toMatchObject({
      source: "automatic",
      reason: "factory-reset",
      format: "zip",
      fileCount: 1,
    });
    expect(await getObject("dataowner/app/0123456789abcdef0123.png")).toBeNull();
  });
});
