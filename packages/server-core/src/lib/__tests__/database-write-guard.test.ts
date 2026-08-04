import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeAllConnections,
  execRawSql,
  getConnection,
  setDatabaseWriteGuard,
} from "../app-db.js";

describe("database write guard", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-write-guard-"));
    dbPath = path.join(tmpDir, "app.db");
    const db = await getConnection(dbPath);
    db.run("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT NOT NULL)");
  });

  afterEach(() => {
    setDatabaseWriteGuard(null);
    closeAllConnections();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("allows reads while rejecting run and exec writes before mutation", async () => {
    setDatabaseWriteGuard(() => { throw new Error("maintenance"); });
    const db = await getConnection(dbPath);

    expect(db.exec("SELECT COUNT(*) FROM items")[0].values[0][0]).toBe(0);
    expect(() => db.run("INSERT INTO items(value) VALUES ('run')")).toThrow("maintenance");
    expect(() => execRawSql(dbPath, "INSERT INTO items(value) VALUES ('exec')")).toThrow("maintenance");

    setDatabaseWriteGuard(null);
    expect(db.exec("SELECT COUNT(*) FROM items")[0].values[0][0]).toBe(0);
  });

  it("rejects prepared write statements before they can execute", async () => {
    setDatabaseWriteGuard(() => { throw new Error("maintenance"); });
    const db = await getConnection(dbPath);

    expect(() => db.prepare("INSERT INTO items(value) VALUES (?)")).toThrow("maintenance");

    setDatabaseWriteGuard(null);
    expect(db.exec("SELECT COUNT(*) FROM items")[0].values[0][0]).toBe(0);
  });
});
