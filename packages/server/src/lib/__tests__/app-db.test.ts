import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  createTable,
  alterTableAddColumn,
  closeConnectionsForPage,
  evictConnectionForDbPath,
  execRawSql,
  getConnection,
  getDbPath,
} from "../app-db.js";
import type { SchemaField, DataSchema } from "../../types/models.js";

function testSchema(
  overrides: { fields: Record<string, SchemaField> } & Partial<Omit<DataSchema, "fields">>,
): DataSchema {
  const { fields, ...rest } = overrides;
  return {
    name: "bugs",
    pageName: "test-page",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...rest,
    fields,
  };
}

async function prepareDb(tmpDir: string): Promise<string> {
  const dbPath = getDbPath(tmpDir);
  await getConnection(dbPath);
  return dbPath;
}

describe("alterTableAddColumn", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-test-"));
  });

  afterEach(() => {
    closeConnectionsForPage(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("backfills defaultValue for existing rows when adding column", async () => {
    const initialSchema = testSchema({ fields: { title: { type: "string" } } });
    await createTable(tmpDir, initialSchema);
    const dbPath = await prepareDb(tmpDir);
    execRawSql(dbPath, "INSERT INTO bugs (title) VALUES (?)", ["bug 1"]);
    execRawSql(dbPath, "INSERT INTO bugs (title) VALUES (?)", ["bug 2"]);

    await alterTableAddColumn(tmpDir, "bugs", "priority", "string", { defaultValue: "normal" });

    const result = execRawSql(dbPath, "SELECT title, priority FROM bugs ORDER BY id");
    expect(result.rows ?? []).toHaveLength(2);
    for (const row of result.rows ?? []) {
      expect(row.priority).toBe("normal");
    }
  });

  it("does not backfill when adding column without defaultValue", async () => {
    const initialSchema = testSchema({ fields: { title: { type: "string" } } });
    await createTable(tmpDir, initialSchema);
    const dbPath = await prepareDb(tmpDir);
    execRawSql(dbPath, "INSERT INTO bugs (title) VALUES (?)", ["bug 1"]);

    await alterTableAddColumn(tmpDir, "bugs", "note", "string");

    const result = execRawSql(dbPath, "SELECT note FROM bugs");
    expect((result.rows ?? [])[0].note).toBeNull();
  });
});

describe("execRawSql", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-test-"));
  });

  afterEach(() => {
    closeConnectionsForPage(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("executes SELECT query and returns columns + rows", async () => {
    const schema = testSchema({
      fields: { title: { type: "string" }, status: { type: "string" } },
    });
    await createTable(tmpDir, schema);
    const dbPath = await prepareDb(tmpDir);
    execRawSql(dbPath, "INSERT INTO bugs (title, status) VALUES (?, ?)", ["bug 1", "open"]);
    execRawSql(dbPath, "INSERT INTO bugs (title, status) VALUES (?, ?)", ["bug 2", "closed"]);

    const result = execRawSql(dbPath, "SELECT status, COUNT(*) as cnt FROM bugs GROUP BY status");

    expect(result.rows ?? []).toHaveLength(2);
    expect(result.columns).toContain("status");
    expect(result.columns).toContain("cnt");
  });

  it("evicts a cached sql.js connection so later access reopens from disk", async () => {
    const schema = testSchema({
      fields: { title: { type: "string" } },
    });
    await createTable(tmpDir, schema);
    const dbPath = await prepareDb(tmpDir);
    const before = await getConnection(dbPath);
    execRawSql(dbPath, "INSERT INTO bugs (title) VALUES (?)", ["persisted"]);

    evictConnectionForDbPath(dbPath);

    const after = await getConnection(dbPath);
    const result = execRawSql(dbPath, "SELECT title FROM bugs");
    expect(after).not.toBe(before);
    expect(result.rows).toEqual([{ title: "persisted" }]);
  });

  it("evicts cached sql.js runtime after sql-wasm surfaces an empty runtime error", async () => {
    const schema = testSchema({
      fields: { title: { type: "string" } },
    });
    await createTable(tmpDir, schema);
    const dbPath = await prepareDb(tmpDir);
    const before = await getConnection(dbPath);
    (before as unknown as { create_function: (name: string, fn: () => unknown) => void })
      .create_function("localapp_boom", () => {
        throw new WebAssembly.RuntimeError("memory access out of bounds");
      });

    expect(() => execRawSql(dbPath, "SELECT localapp_boom()")).toThrow();

    const after = await getConnection(dbPath);
    expect(after).not.toBe(before);
    execRawSql(dbPath, "INSERT INTO bugs (title) VALUES (?)", ["recovered"]);
    expect(execRawSql(dbPath, "SELECT title FROM bugs").rows).toEqual([{ title: "recovered" }]);
  });
});
