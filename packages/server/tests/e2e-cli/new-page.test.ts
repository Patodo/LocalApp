import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildCli, runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";

describe("cli-new-page", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let tmpDir: string;
  let tmpCleanup: () => Promise<void>;

  beforeAll(async () => {
    env = await createCliTestEnv();
    const project = await createTmpProjectDir();
    tmpDir = project.dir;
    tmpCleanup = project.cleanup;
  });

  afterAll(async () => {
    await tmpCleanup();
    await env.cleanup();
  });

  it("should build CLI and return version", async () => {
    const bin = await buildCli();
    expect(bin).toContain("localapp");

    const result = await runCli(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("localapp");
  });

  it("should create a new page and return name", async () => {
    // Write manifest.json directly
    await fs.writeFile(path.join(tmpDir, "manifest.json"), JSON.stringify({ name: "test-app", description: "", distDir: "dist" }));

    const result = await runCli(["new"], {
      cwd: tmpDir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.name).toBe("test-app");
    expect(data.url).toBeDefined();
    expect(data.url).toBe(`/${env.userId}/test-app/`);
    expect(data.url).not.toContain("/serve/");
    expect(data.rawUrl).toBe(`/serve/${env.userId}/test-app/`);

    // Verify manifest.json exists
    const projectFile = await fs.readFile(`${tmpDir}/manifest.json`, "utf-8");
    const manifest = JSON.parse(projectFile);
    expect(manifest.name).toBe("test-app");
  });

  it("should fail without config", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    const result = await runCli(["new"], { cwd: dir });
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("Not configured");
    await cleanup();
  });

  it("should fail without manifest.json", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    const result = await runCli(["new"], {
      cwd: dir,
      env: cliEnvVars(env),
    });
    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("manifest.json");
    await cleanup();
  });
});
