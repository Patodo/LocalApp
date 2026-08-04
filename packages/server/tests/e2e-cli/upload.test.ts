import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";

async function initAndNew(dir: string, env: Awaited<ReturnType<typeof createCliTestEnv>>, name: string) {
  await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ name, description: "", distDir: "dist" }));
  await runCli(["new"], { cwd: dir, env: cliEnvVars(env) });
}

describe("cli-upload", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let projectDir: string;
  let projectCleanup: () => Promise<void>;

  beforeAll(async () => {
    env = await createCliTestEnv();

    const p = await createTmpProjectDir();
    projectDir = p.dir;
    projectCleanup = p.cleanup;

    await initAndNew(projectDir, env, "upload-test");
  });

  afterAll(async () => {
    await projectCleanup();
    await env.cleanup();
  });

  it("should upload a directory with subdirectories", async () => {
    const distDir = path.join(projectDir, "dist");
    await fs.mkdir(path.join(distDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<h1>Hello</h1>");
    await fs.writeFile(path.join(distDir, "assets", "style.css"), "body { margin: 0 }");

    const result = await runCli(["upload", "./dist"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.name).toBeDefined();
    expect(data.version).toBe(1);
    expect(data.url).toBe(`${env.baseUrl}/${env.userId}/upload-test/`);
    expect(data.url).not.toContain("/serve/");
    expect(data.rawUrl).toBe(`${env.baseUrl}/serve/${env.userId}/upload-test/`);
  });

  it("should auto-register a page before first upload", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    await fs.writeFile(path.join(dir, "manifest.json"), JSON.stringify({ name: "auto-register", description: "", distDir: "dist" }));
    const distDir = path.join(dir, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<h1>Auto register</h1>");

    const result = await runCli(["upload", "./dist"], {
      cwd: dir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.name).toBe("auto-register");
    expect(data.version).toBe(1);
    expect(data.url).toBe(`${env.baseUrl}/${env.userId}/auto-register/`);
    expect(data.url).not.toContain("/serve/");
    expect(data.rawUrl).toBe(`${env.baseUrl}/serve/${env.userId}/auto-register/`);

    const pageRes = await fetch(`${env.baseUrl}/serve/${env.userId}/auto-register/`);
    expect(pageRes.status).toBe(200);
    expect(await pageRes.text()).toBe("<h1>Auto register</h1>");

    await cleanup();
  });

  it("should fail when uploading empty directory", async () => {
    const emptyDir = path.join(projectDir, "empty-dist");
    await fs.mkdir(emptyDir, { recursive: true });

    const result = await runCli(["upload", "./empty-dist"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(1);
    const err = JSON.parse(result.stderr);
    expect(err.error).toContain("No files found");
  });

  it("should increment version on repeated uploads", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    await initAndNew(dir, env, "version-test");

    const distDir = path.join(dir, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<h1>v1</h1>");

    const result1 = await runCli(["upload", "./dist"], {
      cwd: dir,
      env: cliEnvVars(env),
    });
    expect(result1.exitCode).toBe(0);
    expect(JSON.parse(result1.stdout).version).toBe(1);

    await fs.writeFile(path.join(distDir, "index.html"), "<h1>v2</h1>");
    const result2 = await runCli(["upload", "./dist"], {
      cwd: dir,
      env: cliEnvVars(env),
    });
    expect(result2.exitCode).toBe(0);
    expect(JSON.parse(result2.stdout).version).toBe(2);
    expect(result2.stderr).toContain("localapp check passed");

    const result3 = await runCli(["upload", "./dist"], {
      cwd: dir,
      env: cliEnvVars(env),
    });
    expect(result3.exitCode).toBe(0);
    expect(JSON.parse(result3.stdout).version).toBe(3);
    expect(result3.stderr).toContain("Reusing successful localapp check result");

    await cleanup();
  });

  it("should show version history via pages info", async () => {
    const result = await runCli(["pages", "info"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.success).toBe(true);
    expect(data.data.versionCount).toBeGreaterThanOrEqual(1);
    expect(data.data.versions).toBeDefined();
    expect(data.data.versions.length).toBeGreaterThanOrEqual(1);
  });

  it("should preserve subdirectory paths when uploading via CLI", async () => {
    const { dir, cleanup } = await createTmpProjectDir();
    await initAndNew(dir, env, "subdir-test");

    const distDir = path.join(dir, "site");
    await fs.mkdir(path.join(distDir, "assets", "images"), { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<h1>Subdir</h1>");
    await fs.writeFile(path.join(distDir, "assets", "style.css"), "body{}");
    await fs.writeFile(path.join(distDir, "assets", "images", "logo.png"), "png-data");

    const uploadResult = await runCli(["upload", "./site"], {
      cwd: dir,
      env: cliEnvVars(env),
    });
    expect(uploadResult.exitCode).toBe(0);

    const pageName = "subdir-test";

    // Verify files are accessible via /serve/ with correct subdirectory paths
    const indexRes = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/`);
    expect(indexRes.status).toBe(200);
    expect(await indexRes.text()).toBe("<h1>Subdir</h1>");

    const cssRes = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/assets/style.css`);
    expect(cssRes.status).toBe(200);
    expect(await cssRes.text()).toBe("body{}");
    expect(cssRes.headers.get("content-type")).toContain("text/css");

    const pngRes = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/assets/images/logo.png`);
    expect(pngRes.status).toBe(200);
    expect(await pngRes.text()).toBe("png-data");

    await cleanup();
  });
});
