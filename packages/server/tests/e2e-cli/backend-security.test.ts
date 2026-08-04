import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  cliEnvVars,
  createCliTestEnv,
  createTmpProjectDir,
  runCli,
} from "./helpers.js";

describe("cli backend security contract", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;

  beforeAll(async () => {
    env = await createCliTestEnv();
  });

  afterAll(async () => {
    await env.cleanup();
  });

  it("uploads a Rust-scaffolded owner contract through the TypeScript server boundary", async () => {
    const { dir, cleanup } = await createTmpProjectDir({
      "manifest.json": JSON.stringify({
        name: "secure-owner-app",
        description: "",
        distDir: "dist",
        platformVersion: "^1.1",
        backend: { root: "backend" },
        requires: { backend: "named-sql", identity: ["currentUser"] },
      }),
      "migrations/001_tasks.sql": [
        "CREATE TABLE tasks (",
        "  id INTEGER PRIMARY KEY AUTOINCREMENT,",
        "  title TEXT NOT NULL,",
        "  created_by TEXT NOT NULL,",
        "  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP",
        ");",
      ].join("\n"),
      "dist/index.html": "<html><body>secure owner app</body></html>",
    });
    try {
      const scaffold = await runCli([
        "backend",
        "scaffold",
        "--table",
        "tasks",
        "--security-profile",
        "owner",
        "--identity-field",
        "created_by",
      ], { cwd: dir, env: cliEnvVars(env) });
      expect(scaffold.exitCode).toBe(0);

      const queries = JSON.parse(
        await fs.readFile(path.join(dir, "backend/resources/tasks/queries.json"), "utf8"),
      );
      expect(queries.queries["$tasks.list"].security).toMatchObject({
        mode: "generated",
        template: "owner-read-v1",
        resource: "tasks",
      });
      expect(queries.queries["$tasks.list"].security.digest).toMatch(/^sha256:[a-f0-9]{64}$/);

      const created = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
      expect(created.exitCode).toBe(0);

      const uploaded = await runCli(["upload", "./dist"], {
        cwd: dir,
        env: cliEnvVars(env),
      });
      expect(uploaded.exitCode, uploaded.stderr).toBe(0);
      expect(JSON.parse(uploaded.stdout).name).toBe("secure-owner-app");
    } finally {
      await cleanup();
    }
  });
});
