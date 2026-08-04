import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";

function parseLastJson(output: string) {
  const line = output
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("{"))
    .at(-1);
  if (!line) throw new Error(`No JSON object found in output:\n${output}`);
  return JSON.parse(line);
}

describe("cli-upload-distdir", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let projectDir: string;
  let projectCleanup: () => Promise<void>;

  beforeAll(async () => {
    env = await createCliTestEnv();

    const p = await createTmpProjectDir();
    projectDir = p.dir;
    projectCleanup = p.cleanup;
  });

  afterAll(async () => {
    await projectCleanup();
    await env.cleanup();
  });

  it("should upload using distDir from manifest when path is omitted", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    const name = "upload-distdir-test";

    // Create manifest with distDir
    const manifest = { name, description: "", distDir: "build-output" };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.exit(0)\"" } }));

    // Create page on server
    const newResult = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
    expect(newResult.exitCode).toBe(0);

    // Create build-output directory
    const buildDir = path.join(dir, "build-output");
    await fs.mkdir(buildDir, { recursive: true });
    await fs.writeFile(path.join(buildDir, "index.html"), "<h1>DistDir Test</h1>");

    // Upload without path argument
    const result = await runCli(["upload"], {
      cwd: dir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const data = parseLastJson(result.stdout);
    expect(data.name).toBeDefined();
    expect(data.version).toBe(1);

    await cleanup();
  });

  it("should error when distDir directory does not exist", async () => {
    const { dir, cleanup } = await createTmpProjectDir();

    // Create manifest without distDir — defaults to "dist" which doesn't exist
    const manifest = { name: "no-distdir-test", description: "" };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    await fs.writeFile(path.join(dir, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.exit(0)\"" } }));

    const result = await runCli(["upload"], {
      cwd: dir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(1);
    const err = parseLastJson(result.stderr);
    expect(err.error).toContain("Directory not found");

    await cleanup();
  });

  it("should use explicit path when provided (ignoring distDir)", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    const name = "explicit-path-test";

    const manifest = { name, description: "", distDir: "wrong-dir" };
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));

    // Create page on server
    const newResult = await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
    expect(newResult.exitCode).toBe(0);

    // Create the actual dist dir
    const distDir = path.join(dir, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<h1>Explicit Path</h1>");

    // Upload with explicit path
    const result = await runCli(["upload", "./dist"], {
      cwd: dir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.version).toBe(1);

    await cleanup();
  });
});
