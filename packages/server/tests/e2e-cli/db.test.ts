import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";
import { cliEnvVars, createCliTestEnv, createTmpProjectDir, runCli } from "./helpers.js";

describe("cli-db", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;

  beforeAll(async () => {
    env = await createCliTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("generates TypeScript interfaces from .localapp/dev.db", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-types-test", distDir: "dist", platformVersion: "^1.0" }),
    });
    try {
      await writeDevDb(dir, `
        CREATE TABLE tasks (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          created_by TEXT,
          created_at TEXT,
          data BLOB
        );
        CREATE TABLE _localapp_applied_migrations (filename TEXT);
        CREATE TABLE users (id TEXT);
      `);

      const result = await runCli(["db", "types", "-o", "src/types.ts"], {
        cwd: dir,
        env: cliEnvVars(env),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Generated 1 interfaces to src/types.ts");
      const types = await fs.readFile(path.join(dir, "src", "types.ts"), "utf8");
      expect(types).toContain("For platform data types (users, groups, roles), import from @localapp/sdk-react");
      expect(types).toContain("export interface tasks");
      expect(types).toContain("id: number;");
      expect(types).toContain("title: string;");
      expect(types).toContain("created_by?: string;");
      expect(types).toContain("/** ISO 8601 timestamp */");
      expect(types).toContain("created_at?: string;");
      expect(types).toContain("data?: Uint8Array;");
      expect(types).not.toContain("interface _localapp_applied_migrations");
      expect(types).not.toContain("interface users");
    } finally {
      await cleanup();
    }
  });

  it("applies db/seeds/dev.sql after migrations during db reset", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-reset-test", distDir: "dist", platformVersion: "^1.0" }),
      "migrations/001_init.sql": "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);",
      "db/seeds/dev.sql": "INSERT INTO tasks (title) VALUES ('seeded task');",
    });
    try {
      const result = await runCli(["db", "reset"], {
        cwd: dir,
        env: cliEnvVars(env),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Applied seed: 1 SQL statements");
      const rows = await readDevDbRows(dir, "SELECT title FROM tasks");
      expect(rows).toEqual([["seeded task"]]);
    } finally {
      await cleanup();
    }
  });

  it("skips seed step when db/seeds/dev.sql is missing", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-reset-no-seed-test", distDir: "dist", platformVersion: "^1.0" }),
      "migrations/001_init.sql": "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);",
    });
    try {
      const result = await runCli(["db", "reset"], {
        cwd: dir,
        env: cliEnvVars(env),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No seed file found at db/seeds/dev.sql");
      const rows = await readDevDbRows(dir, "SELECT COUNT(*) FROM tasks");
      expect(rows).toEqual([[0]]);
    } finally {
      await cleanup();
    }
  });

  it("validates migrations against a prod snapshot and writes .last-validated", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-validate-test", description: "", distDir: "dist", platformVersion: "^1.0" }),
      "migrations/001_init.sql": "CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT);",
      "migrations/002_add_status.sql": "ALTER TABLE tasks ADD COLUMN status TEXT;",
    });
    try {
      const newResult = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
      expect(newResult.exitCode).toBe(0);

      const result = await runCli(["db", "validate"], {
        cwd: dir,
        env: cliEnvVars(env),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Validate OK. 2 migrations ready to apply.");
      await expect(fs.stat(path.join(dir, ".localapp", "prod-snapshot.db"))).resolves.toBeTruthy();
      const marker = JSON.parse(await fs.readFile(path.join(dir, ".localapp", ".last-validated"), "utf8"));
      expect(marker.checksums).toHaveProperty("001_init.sql");
      expect(marker.checksums).toHaveProperty("002_add_status.sql");
    } finally {
      await cleanup();
    }
  });

  it("rejects db validate when prod server is unreachable", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "offline-validate-test", distDir: "dist", platformVersion: "^1.0" }),
    });
    try {
      const result = await runCli(["db", "validate"], {
        cwd: dir,
        env: { LOCALAPP_SERVER_URL: "http://127.0.0.1:9", LOCALAPP_API_KEY: env.apiKey },
      });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error).toContain("Cannot reach prod server. Validation requires online connection.");
    } finally {
      await cleanup();
    }
  });

  it("keeps prod-snapshot.db when validate fails", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-validate-fail-test", description: "", distDir: "dist", platformVersion: "^1.0" }),
      "migrations/001_bad.sql": "CREATE TABLE broken (id INTEGER;",
    });
    try {
      const newResult = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
      expect(newResult.exitCode).toBe(0);

      const result = await runCli(["db", "validate"], {
        cwd: dir,
        env: cliEnvVars(env),
      });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error).toContain("Validation FAILED");
      await expect(fs.stat(path.join(dir, ".localapp", "prod-snapshot.db"))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(dir, ".localapp", ".last-validated"))).rejects.toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it("restores app.db from server backup v1", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-restore-test", description: "", distDir: "dist", platformVersion: "^1.0" }),
    });
    try {
      const newResult = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
      expect(newResult.exitCode).toBe(0);

      const pageDir = path.join(env.dataDir, env.userId, "db-restore-test");
      await writeSqliteFile(path.join(pageDir, "app.db.backup.v1"), "CREATE TABLE restored (id INTEGER PRIMARY KEY);");

      const unsafeResult = await runCli(["db", "restore", "--backup", "v1"], {
        cwd: dir,
        env: cliEnvVars(env),
      });
      expect(unsafeResult.exitCode).toBe(1);
      expect(JSON.parse(unsafeResult.stderr).error).toContain("Restoring a database backup loses current production data");

      const result = await runCli(["db", "restore", "--backup", "v1", "--i-know-this-loses-data", "--confirm-project-name", "db-restore-test"], {
        cwd: dir,
        env: cliEnvVars(env),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Restore complete from backup v1");
      await expect(fs.stat(path.join(pageDir, "app.db"))).resolves.toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it("prints applied and pending migrations in db status", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-status-test", distDir: "dist", platformVersion: "^1.0" }),
      "migrations/001_init.sql": "CREATE TABLE tasks (id INTEGER PRIMARY KEY);",
      "migrations/002_add_title.sql": "ALTER TABLE tasks ADD COLUMN title TEXT;",
    });
    try {
      const resetResult = await runCli(["db", "reset"], {
        cwd: dir,
        env: cliEnvVars(env),
      });
      expect(resetResult.exitCode).toBe(0);

      await fs.writeFile(path.join(dir, "migrations", "003_add_status.sql"), "ALTER TABLE tasks ADD COLUMN status TEXT;");
      const result = await runCli(["db", "status"], {
        cwd: dir,
        env: cliEnvVars(env),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Applied migrations");
      expect(result.stdout).toContain("001_init.sql");
      expect(result.stdout).toContain("002_add_title.sql");
      expect(result.stdout).toContain("Pending migrations");
      expect(result.stdout).toContain("003_add_status.sql");
    } finally {
      await cleanup();
    }
  });

  it("records SHA-256 checksums for local migrations", async () => {
    const sql = "CREATE TABLE tasks (id INTEGER PRIMARY KEY);";
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-checksum-test", distDir: "dist", platformVersion: "^1.0" }),
      "migrations/001_init.sql": sql,
    });
    try {
      const migrateResult = await runCli(["db", "migrate"], { cwd: dir });
      expect(migrateResult.exitCode).toBe(0);

      const rows = await readDevDbRows(
        dir,
        "SELECT checksum FROM _localapp_applied_migrations WHERE filename = '001_init.sql'",
      );
      expect(rows[0]?.[0]).toBe(crypto.createHash("sha256").update(sql).digest("hex"));
    } finally {
      await cleanup();
    }
  });

  it("opens sqlite3 shell for dev.db", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "db-shell-test", distDir: "dist", platformVersion: "^1.0" }),
      "migrations/001_init.sql": "CREATE TABLE tasks (id INTEGER PRIMARY KEY);",
    });
    try {
      const migrateResult = await runCli(["db", "migrate"], { cwd: dir });
      expect(migrateResult.exitCode).toBe(0);

      const result = await runCli(["db", "shell", "--command", ".tables"], { cwd: dir });
      expect(result.exitCode).toBe(0);
    } finally {
      await cleanup();
    }
  });
});

async function writeDevDb(projectDir: string, sql: string): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(sql);
    const localappDir = path.join(projectDir, ".localapp");
    await fs.mkdir(localappDir, { recursive: true });
    await fs.writeFile(path.join(localappDir, "dev.db"), Buffer.from(db.export()));
  } finally {
    db.close();
  }
}

async function writeSqliteFile(filePath: string, sql: string): Promise<void> {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(sql);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, Buffer.from(db.export()));
  } finally {
    db.close();
  }
}

async function readDevDbRows(projectDir: string, sql: string): Promise<unknown[][]> {
  const SQL = await initSqlJs();
  const db = new SQL.Database(await fs.readFile(path.join(projectDir, ".localapp", "dev.db")));
  try {
    return db.exec(sql)[0]?.values ?? [];
  } finally {
    db.close();
  }
}
