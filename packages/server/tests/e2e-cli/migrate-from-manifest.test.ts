import { describe, expect, it } from "vitest";
import initSqlJs from "sql.js";
import fs from "node:fs/promises";
import path from "node:path";
import { cliEnvVars, createCliTestEnv, createTmpProjectDir, runCli } from "./helpers.js";

describe("cli migrate-from-manifest", () => {
  it("generates migrations/001_initial_from_manifest.sql from manifest.schemas", async () => {
    const { dir, cleanup } = await createLegacyProject("manifest-convert");
    try {
      const result = await runCli(["migrate-from-manifest"], { cwd: dir });

      expect(result.exitCode).toBe(0);
      const sql = await fs.readFile(path.join(dir, "migrations", "001_initial_from_manifest.sql"), "utf8");
      expect(sql).toContain("CREATE TABLE todos");
      expect(sql).toContain("title TEXT NOT NULL");
      expect(sql).toContain("done INTEGER");
    } finally {
      await cleanup();
    }
  });

  it("backs up manifest.json and removes schemas field", async () => {
    const { dir, cleanup } = await createLegacyProject("manifest-backup");
    try {
      const result = await runCli(["migrate-from-manifest"], { cwd: dir });

      expect(result.exitCode).toBe(0);
      const backup = JSON.parse(await fs.readFile(path.join(dir, "manifest.json.bak"), "utf8"));
      const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
      expect(backup.schemas.todos).toBeDefined();
      expect(manifest.schemas).toBeUndefined();
    } finally {
      await cleanup();
    }
  });

  it("preserves schema business metadata and route access in manifest.business", async () => {
    const { dir, cleanup } = await createLegacyProject("manifest-business");
    try {
      const result = await runCli(["migrate-from-manifest"], { cwd: dir });

      expect(result.exitCode).toBe(0);
      const manifest = JSON.parse(await fs.readFile(path.join(dir, "manifest.json"), "utf8"));
      expect(manifest.schemas).toBeUndefined();
      expect(manifest.business.todos.routeAccess.read).toBe("authenticated");
      expect(manifest.business.todos.kind).toBe("workflow");
      expect(manifest.business.todos.statusField).toBe("status");
    } finally {
      await cleanup();
    }
  });

  it("refuses to run when migrations directory already exists", async () => {
    const { dir, cleanup } = await createLegacyProject("manifest-conflict");
    try {
      await fs.mkdir(path.join(dir, "migrations"));
      const result = await runCli(["migrate-from-manifest"], { cwd: dir });

      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).error).toContain("migrations directory already exists");
    } finally {
      await cleanup();
    }
  });

  it("skips gracefully when manifest has no schemas field", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "manifest-no-schemas", distDir: "dist" }),
    });
    try {
      const result = await runCli(["migrate-from-manifest"], { cwd: dir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("No manifest.schemas found");
      await expect(fs.stat(path.join(dir, "migrations"))).rejects.toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it("runs db migrate after converting manifest schemas", async () => {
    const { dir, cleanup } = await createLegacyProject("manifest-db-migrate");
    try {
      expect((await runCli(["migrate-from-manifest"], { cwd: dir })).exitCode).toBe(0);
      const result = await runCli(["db", "migrate"], { cwd: dir });

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("1 migrations applied");
      await expect(fs.stat(path.join(dir, ".localapp", "dev.db"))).resolves.toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  it("uploads successfully after converting manifest schemas", async () => {
    const env = await createCliTestEnv();
    const { dir, cleanup } = await createLegacyProject("manifest-upload");
    try {
      await fs.mkdir(path.join(dir, "dist"), { recursive: true });
      await fs.writeFile(path.join(dir, "dist", "index.html"), "<h1>converted</h1>");

      expect((await runCli(["new"], { cwd: dir, env: cliEnvVars(env) })).exitCode).toBe(0);
      expect((await runCli(["migrate-from-manifest"], { cwd: dir })).exitCode).toBe(0);
      expect((await runCli(["db", "migrate"], { cwd: dir })).exitCode).toBe(0);

      const result = await runCli(["upload", "./dist"], { cwd: dir, env: cliEnvVars(env) });

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout).version).toBe(1);

      // DB 表结构由 migration 创建
      const SQL = await initSqlJs();
      const appDb = path.join(env.dataDir, env.userId, "manifest-upload", "app.db");
      const db = new SQL.Database(await fs.readFile(appDb));
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'todos'");
      expect(tables[0]?.values).toEqual([["todos"]]);

      // REST CRUD 端点的 defaultFrom / enum / routeAccess 验证已随端点整体
      // 移除（restrict-app-api-to-named-sql 变更）。这些约束现在由 named SQL
      // 的 access 字段和 SQL WHERE 子句表达，不再由服务端中间件强制。
    } finally {
      await cleanup();
      await env.cleanup();
    }
  });
});

async function createLegacyProject(name: string) {
  return createTmpProjectDir({
    "manifest.json": JSON.stringify({
      name,
      description: "",
      distDir: "dist",
      platformVersion: "^1.0",
      schemas: {
        todos: {
          fields: {
            title: { type: "string", constraints: { required: true } },
            done: { type: "boolean", constraints: { defaultValue: false } },
            status: { type: "string" },
            created_by: { type: "string" },
            reviewer_id: { type: "string" },
          },
          routeAccess: { read: "authenticated", create: "authenticated" },
          business: {
            kind: "workflow",
            ownerField: "reviewer_id",
            statusField: "status",
            defaultFields: { created_by: { defaultFrom: "currentUser.id" } },
            enums: { status: ["todo", "done"] },
            recordAccess: { create: "owner" },
          },
        },
      },
    }),
  });
}
