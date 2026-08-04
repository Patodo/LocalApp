import { describe, it, expect, afterAll } from "vitest";
import { runCli, createCliTestEnv, createTmpProjectDir, cliEnvVars } from "./helpers.js";
import fs from "node:fs/promises";
import path from "node:path";


describe("cli-full-workflow", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  let projectDir: string;
  let projectCleanup: () => Promise<void>;

  afterAll(async () => {
    await projectCleanup();
    await env.cleanup();
  });

  it("should complete init → new → upload → pages info → serve flow", async () => {
    env = await createCliTestEnv();
    const p = await createTmpProjectDir();
    projectDir = p.dir;
    projectCleanup = p.cleanup;
    const vars = cliEnvVars(env);

    // Step 1: Write manifest.json directly
    await fs.writeFile(path.join(projectDir, "manifest.json"), JSON.stringify({ name: "workflow-test", description: "", distDir: "dist" }));

    // Step 2: Create page on server
    const newResult = await runCli(["new"], { cwd: projectDir, env: vars });
    expect(newResult.exitCode).toBe(0);
    const newPage = JSON.parse(newResult.stdout);
    expect(newPage.name).toBe("workflow-test");
    const pageName = newPage.name;

    // Step 3: Verify manifest.json
    const projectFile = await fs.readFile(path.join(projectDir, "manifest.json"), "utf-8");
    expect(JSON.parse(projectFile).name).toBe(pageName);

    // Step 4: Create dist and upload
    const distDir = path.join(projectDir, "dist");
    await fs.mkdir(distDir, { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<h1>Workflow Test</h1>");

    const uploadResult = await runCli(["upload", "./dist"], { cwd: projectDir, env: vars });
    expect(uploadResult.exitCode).toBe(0);
    const uploadData = JSON.parse(uploadResult.stdout);
    expect(uploadData.version).toBe(1);

    // Step 5: Check page info
    const infoResult = await runCli(["pages", "info"], { cwd: projectDir, env: vars });
    expect(infoResult.exitCode).toBe(0);
    const infoData = JSON.parse(infoResult.stdout);
    expect(infoData.success).toBe(true);
    expect(infoData.data.name).toBe(pageName);
    expect(infoData.data.currentVersion).toBe(1);

    // Step 6: Verify page is accessible via HTTP
    const pageRes = await fetch(`${env.baseUrl}/${env.userId}/${pageName}`);
    expect(pageRes.status).toBe(200);
    const html = await pageRes.text();
    expect(html).toContain("PlatformShellClient");
    expect(html).toContain("data-localapp-native-shell");
    expect(html).toContain(`\\"${env.userId}\\"`);
    expect(html).toContain(`\\"${pageName}\\"`);

    // Step 7: Verify content is served
    const serveRes = await fetch(`${env.baseUrl}/serve/${env.userId}/${pageName}/`);
    expect(serveRes.status).toBe(200);
    const content = await serveRes.text();
    expect(content).toBe("<h1>Workflow Test</h1>");
  });
});
