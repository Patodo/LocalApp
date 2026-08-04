import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import {
  applyMigration,
  ensureAppliedMigrationsTable,
  getPendingMigrations,
  validateMigrationFilenames,
} from "../migrations.js";

describe("migration engine", () => {
  let tmpDir: string;
  let db: initSqlJs.Database;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-migrations-"));
    const SQL = await initSqlJs();
    db = new SQL.Database();
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates migration filenames by numeric prefix and .sql extension", () => {
    expect(validateMigrationFilenames(["001_init.sql", "003_add_priority.sql"])).toEqual({
      valid: true,
      errors: [],
    });

    const result = validateMigrationFilenames([
      "000_bad.sql",
      "002_add.sql",
      "002_conflict.sql",
      "003.txt",
      "abc.sql",
    ]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("000_bad.sql"),
        expect.stringContaining("002"),
        expect.stringContaining("003.txt"),
        expect.stringContaining("abc.sql"),
      ]),
    );
  });

  it("creates and queries the applied migrations table", () => {
    ensureAppliedMigrationsTable(db);

    const table = db.exec(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_localapp_applied_migrations'",
    );

    expect(table[0]?.values).toEqual([["_localapp_applied_migrations"]]);
  });

  it("imports Desktop's legacy migration ledger before checking pending files", () => {
    const sql = "CREATE TABLE tasks (id INTEGER);";
    const checksum = crypto.createHash("sha256").update(sql).digest("hex");
    db.run(sql);
    db.run(`
      CREATE TABLE _localapp_migrations (
        filename TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      )
    `);
    db.run(
      "INSERT INTO _localapp_migrations(filename, checksum, applied_at) VALUES (?, ?, ?)",
      ["001_tasks.sql", checksum, 1_785_398_400_000],
    );

    expect(getPendingMigrations(pathWithMigration("001_tasks.sql", sql), db)).toEqual([]);
    expect(
      db.exec(
        "SELECT filename, checksum FROM _localapp_applied_migrations ORDER BY filename",
      )[0]?.values,
    ).toEqual([["001_tasks.sql", checksum]]);
  });

  it("returns pending migrations ordered by numeric prefix", () => {
    const migrationsDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, "003_notes.sql"), "CREATE TABLE notes (id INTEGER);");
    fs.writeFileSync(path.join(migrationsDir, "001_tasks.sql"), "CREATE TABLE tasks (id INTEGER);");
    fs.writeFileSync(path.join(migrationsDir, "002_done.sql"), "ALTER TABLE tasks ADD COLUMN done INTEGER;");

    applyMigration(db, "001_tasks.sql", "CREATE TABLE tasks (id INTEGER);");
    const pending = getPendingMigrations(migrationsDir, db);

    expect(pending.map((migration) => migration.filename)).toEqual([
      "002_done.sql",
      "003_notes.sql",
    ]);
  });

  it("applies migration in a transaction and records checksum", () => {
    applyMigration(
      db,
      "001_tasks.sql",
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);",
    );

    const tasks = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'");
    const rows = db.exec("SELECT filename, checksum FROM _localapp_applied_migrations");

    expect(tasks[0]?.values).toEqual([["tasks"]]);
    expect(rows[0]?.values[0]?.[0]).toBe("001_tasks.sql");
    expect(String(rows[0]?.values[0]?.[1])).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects ATTACH and DETACH migrations before execution", () => {
    expect(() => applyMigration(db, "001_attach.sql", "ATTACH DATABASE 'x.db' AS x;")).toThrow(
      "Migration 001_attach.sql contains ATTACH/DETACH which breaks transaction",
    );
    expect(() => applyMigration(db, "002_detach.sql", "DETACH DATABASE x;")).toThrow(
      "Migration 002_detach.sql contains ATTACH/DETACH which breaks transaction",
    );
  });

  it("rejects already applied migration files when checksum changes", () => {
    applyMigration(db, "001_tasks.sql", "CREATE TABLE tasks (id INTEGER);");

    expect(() =>
      getPendingMigrations(pathWithMigration("001_tasks.sql", "CREATE TABLE renamed (id INTEGER);"), db),
    ).toThrow("Migration 001_tasks.sql was modified after being applied");
  });

  function pathWithMigration(filename: string, sql: string): string {
    const migrationsDir = path.join(tmpDir, "checksum");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, filename), sql);
    return migrationsDir;
  }
});
