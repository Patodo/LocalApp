import { test, expect } from "./helpers";

test.skip("init template React app renders in browser", async ({ page, baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cliBin = path.join(process.cwd(), "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-react-"));
  const env = { PATH: process.env.PATH || "", SYSTEMROOT: process.env.SYSTEMROOT || "", USERPROFILE: process.env.USERPROFILE || "", TEMP: process.env.TEMP || "", TMP: process.env.TMP || "", LOCALAPP_SERVER_URL: baseUrl, LOCALAPP_API_KEY: "test-ui-api-key-1234567890abcdef" };

  function runCli(args, cwd) {
    return new Promise((resolve) => {
      execFile(cliBin, args, { cwd: cwd || workDir, env, timeout: 120000 }, (err, stdout, stderr) => {
        if (err) resolve({ exitCode: 1, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() });
        else resolve({ exitCode: 0, stdout: String(stdout).trim(), stderr: String(stderr || "").trim() });
      });
    });
  }

  try {
    // Step 1: CLI init with builtin template (full React app)
    const initResult = await runCli(["init", "--name", "react-app", "--builtin-repo"]);
    expect(initResult.exitCode, `init failed: ${initResult.stderr}`).toBe(0);
    const initData = JSON.parse(initResult.stdout);
    const projectDir = path.join(workDir, "react-app");

    // Step 2: install dependencies and build with relative paths
    const buildEnv = { ...process.env, LOCALAPP_SERVER_URL: baseUrl, LOCALAPP_API_KEY: "test-ui-api-key-1234567890abcdef" };
    const { execSync } = await import("node:child_process");
    execSync("npm install", { cwd: projectDir, env: buildEnv, timeout: 120000, stdio: "pipe" });

    // Build with relative base so assets resolve under /serve/{uid}/{name}/
    const viteConfig = path.join(projectDir, "vite.config.ts");
    const origConfig = await fs.promises.readFile(viteConfig, "utf-8");
    await fs.promises.writeFile(viteConfig, origConfig.replace(/export default defineConfig\(\{/, 'export default defineConfig({\n  base: "./",'));
    execSync("npm run build", { cwd: projectDir, env: buildEnv, timeout: 120000, stdio: "pipe" });

    // Step 3: upload the built app
    const uploadResult = await runCli(["upload"], projectDir);
    expect(uploadResult.exitCode, `upload failed: ${uploadResult.stderr}`).toBe(0);

    // Step 4: verify React rendering in browser
    // Ensure trailing slash so relative paths resolve correctly
    const pageUrl = initData.url.endsWith("/") ? initData.url : initData.url + "/";
    await page.goto(pageUrl);

    // Wait for React hydration — h1 should appear
    await page.locator("h1").waitFor({ state: "visible", timeout: 15000 });
    await expect(page.locator("h1")).toHaveText("LocalApp App");

    // useMe hook resolves to "Not logged in" (unauthenticated)
    await expect(page.locator("body")).toContainText("Not logged in", { timeout: 10000 });

  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});
