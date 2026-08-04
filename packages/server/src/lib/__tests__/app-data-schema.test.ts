import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import initSqlJs from "sql.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeSchemaFingerprint, validateCandidateSchema } from "../app-data-schema.js";

async function createDatabase(filePath: string, sql: string): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(sql);
  fs.writeFileSync(filePath, Buffer.from(db.export()));
  db.close();
}

describe("application data schema validation", () => {
  let tmpDir: string;
  let migrationsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-data-schema-"));
    migrationsDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(migrationsDir);
    fs.writeFileSync(path.join(migrationsDir, "001_init.sql"), [
      "CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL, title TEXT NOT NULL, FOREIGN KEY(team_id) REFERENCES teams(id));",
      "CREATE INDEX tasks_team_idx ON tasks(team_id);",
      "CREATE INDEX tasks_open_idx ON tasks(title) WHERE title <> '';",
    ].join("\n"));
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("rejects archives created by a newer application version", async () => {
    const candidatePath = path.join(tmpDir, "newer.db");
    await createDatabase(candidatePath, "CREATE TABLE anything (id INTEGER)");
    await expect(validateCandidateSchema({ candidatePath, migrationsDir, archiveVersion: 3, currentVersion: 2 }))
      .rejects.toMatchObject({ code: "APP_ARCHIVE_VERSION_TOO_NEW" });
  });

  it("migrates an older database and returns a stable fingerprint", async () => {
    const candidatePath = path.join(tmpDir, "older.db");
    await createDatabase(candidatePath, "CREATE TABLE legacy (id INTEGER)");

    const first = await validateCandidateSchema({ candidatePath, migrationsDir, archiveVersion: 1, currentVersion: 2 });
    const second = await computeSchemaFingerprint(candidatePath);

    expect(first.schemaFingerprint).toBe(second);
    expect(first.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects a same-version database missing required structures", async () => {
    const candidatePath = path.join(tmpDir, "incompatible.db");
    await createDatabase(candidatePath, "CREATE TABLE teams (id INTEGER PRIMARY KEY)");

    await expect(validateCandidateSchema({ candidatePath, migrationsDir, archiveVersion: 2, currentVersion: 2 }))
      .rejects.toMatchObject({ code: "APP_DATABASE_SCHEMA_INCOMPATIBLE" });
  });

  it("allows extra structures when every required structure exists", async () => {
    const candidatePath = path.join(tmpDir, "compatible.db");
    await createDatabase(candidatePath, [
      "CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL, title TEXT NOT NULL, FOREIGN KEY(team_id) REFERENCES teams(id));",
      "CREATE INDEX tasks_team_idx ON tasks(team_id);",
      "CREATE INDEX tasks_open_idx ON tasks(title) WHERE title <> '';",
      "ALTER TABLE tasks ADD COLUMN local_note TEXT;",
      "CREATE INDEX tasks_local_note_idx ON tasks(local_note);",
      "CREATE TABLE local_extension (value TEXT);",
    ].join("\n"));

    await expect(validateCandidateSchema({ candidatePath, migrationsDir, archiveVersion: 2, currentVersion: 2 }))
      .resolves.toMatchObject({ schemaFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
  });

  it("rejects a partial index with the required name and columns but a different predicate", async () => {
    const candidatePath = path.join(tmpDir, "wrong-partial-index.db");
    await createDatabase(candidatePath, [
      "CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL);",
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY, team_id INTEGER NOT NULL, title TEXT NOT NULL, FOREIGN KEY(team_id) REFERENCES teams(id));",
      "CREATE INDEX tasks_team_idx ON tasks(team_id);",
      "CREATE INDEX tasks_open_idx ON tasks(title) WHERE title = '';",
    ].join("\n"));

    await expect(validateCandidateSchema({ candidatePath, migrationsDir, archiveVersion: 2, currentVersion: 2 }))
      .rejects.toMatchObject({ code: "APP_DATABASE_SCHEMA_INCOMPATIBLE" });
  });
});
