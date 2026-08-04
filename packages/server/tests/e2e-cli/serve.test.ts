import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";


describe("page-serving-e2e", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let projectDir: string;
  let projectCleanup: () => Promise<void>;
  let pageName: string;

  const indexHtml = "<h1>Test Page</h1>";
  const appJs = "console.log('hello');";

  beforeAll(async () => {
    env = await createCliTestEnv();

    const p = await createTmpProjectDir();
    projectDir = p.dir;
    projectCleanup = p.cleanup;

    await fs.writeFile(path.join(projectDir, "manifest.json"), JSON.stringify({ name: "serve-test", description: "", distDir: "dist" }));
    const newResult = await runCli(["new"], { cwd: projectDir, env: cliEnvVars(env) });
    expect(newResult.exitCode).toBe(0);
    pageName = JSON.parse(newResult.stdout).name;

    const distDir = path.join(projectDir, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), indexHtml);
    await fs.writeFile(path.join(distDir, "app.js"), appJs);

    const uploadResult = await runCli(["upload", "./dist"], {
      cwd: projectDir,
      env: cliEnvVars(env),
    });
    expect(uploadResult.exitCode).toBe(0);

    // Also create a subdirectory file directly to test path serving
    const dataDir = process.env.DATA_DIR!;
    const versionDir = path.join(dataDir, env.userId, pageName, "versions", "v1");
    await fs.mkdir(path.join(versionDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(versionDir, "assets", "style.css"), "body { margin: 0; }");
  });

  afterAll(async () => {
    await projectCleanup();
    await env.cleanup();
  });

  // Platform shell
  it("should return Next shell HTML for GET /{userId}/{name}", async () => {
    const res = await fetch(`${env.baseUrl}/${env.userId}/${pageName}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("PlatformShellClient");
    expect(html).toContain("data-localapp-native-shell");
    expect(html).toContain(`\\"${env.userId}\\"`);
    expect(html).toContain(`\\"${pageName}\\"`);
  });

  it("should return 404 for nonexistent page", async () => {
    const res = await fetch(`${env.baseUrl}/${env.userId}/nonexistent999`);
    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Page not found");
  });

  // Static file serving
  it("should redirect /serve/{uid}/{name} (no trailing slash) to trailing-slash URL", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/serve/${env.userId}/${pageName}/`);
  });

  it("should preserve query params on trailing-slash redirect", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}?foo=bar`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`/serve/${env.userId}/${pageName}/?foo=bar`);
  });

  it("should return index.html for GET /serve/{uid}/{name}/ (trailing slash)", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toBe(indexHtml);
  });

  it("should serve subdirectory files with correct MIME", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/assets/style.css`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("body { margin: 0; }");
    expect(res.headers.get("content-type")).toContain("text/css");
  });

  it("should return 404 for nonexistent file with extension", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/missing.js`);
    expect(res.status).toBe(404);
  });

  // SPA fallback
  it("should fallback to index.html for path without extension", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/about`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toBe(indexHtml);
  });

  it("should NOT fallback for path with extension", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/nonexistent.css`);
    expect(res.status).toBe(404);
  });

  // CSP header
  it("should include CSP header in page responses", async () => {
    const res = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/`);
    const csp = res.headers.get("content-security-policy");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
  });
});
