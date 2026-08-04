import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";

describe("cli-pages", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let projectDir: string;
  let projectCleanup: () => Promise<void>;
  let pageName: string;

  beforeAll(async () => {
    env = await createCliTestEnv();

    const p = await createTmpProjectDir();
    projectDir = p.dir;
    projectCleanup = p.cleanup;

    await fs.writeFile(path.join(projectDir, "manifest.json"), JSON.stringify({ name: "pages-test", description: "", distDir: "dist" }));
    const result = await runCli(["new"], { cwd: projectDir, env: cliEnvVars(env) });
    expect(result.exitCode).toBe(0);
    pageName = JSON.parse(result.stdout).name;
  });

  afterAll(async () => {
    await projectCleanup();
    await env.cleanup();
  });

  it("should list pages", async () => {
    const result = await runCli(["pages", "list"], { env: cliEnvVars(env) });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(Array.isArray(data.data)).toBe(true);
    expect(data.data.length).toBeGreaterThanOrEqual(1);
    expect(data.data.some((p: any) => p.name === pageName)).toBe(true);
  });

  it("should show page info from manifest.json", async () => {
    const result = await runCli(["pages", "info"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.data.name).toBe(pageName);
    expect(data.data.userId).toBe(env.userId);
    expect(data.data.url).toBe(`/${env.userId}/${pageName}/`);
    expect(data.data.url).not.toContain("/serve/");
    expect(data.data.rawUrl).toBe(`/serve/${env.userId}/${pageName}/`);
    expect(data.data.currentVersion).toBeDefined();
    expect(data.data.versions).toBeDefined();
  });

  it("should delete a page by explicit name", async () => {
    // Create a new page to delete
    const { dir, cleanup } = await createTmpProjectDir();
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ name: "delete-test", description: "", distDir: "dist" }));
    const newResult = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
    expect(newResult.exitCode).toBe(0);
    const newName = JSON.parse(newResult.stdout).name;

    const result = await runCli(["pages", "delete", newName], { env: cliEnvVars(env) });
    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.data.deleted).toBe(true);
    expect(data.data.name).toBe(newName);

    await cleanup();
  });

  it("should fail to delete nonexistent page", async () => {
    const result = await runCli(["pages", "delete", "nonexistent999"], { env: cliEnvVars(env) });
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toBeDefined();
  });
});
