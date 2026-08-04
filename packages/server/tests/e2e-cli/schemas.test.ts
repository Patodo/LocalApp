import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { cliEnvVars, createCliTestEnv, createTmpProjectDir, runCli } from "./helpers.js";

describe("cli-schemas", () => {
  it("rejects the removed schemas command group", async () => {
    const result = await runCli(["schemas", "create", "todos", "--fields", "{}"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("schemas");
  });

  it("warns but does not block when manifest.json still contains schemas", async () => {
    const env = await createCliTestEnv();
    const { dir, cleanup } = await createTmpProjectDir();
    try {
      await fs.writeFile(
        path.join(dir, "manifest.json"),
        JSON.stringify({
          name: "deprecated-schema-manifest",
          description: "",
          distDir: "dist",
          schemas: { todos: { fields: { title: { type: "string" } } } },
        }),
      );

      const result = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).toContain("deprecated schemas field");
    } finally {
      await cleanup();
      await env.cleanup();
    }
  });
});
