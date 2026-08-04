import { test, expect } from "./helpers";

test.skip("CLI upload updates page content", async ({ page, baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cliBin = path.join(process.cwd(), "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-upload-"));
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
    // Step 1: init
    const initResult = await runCli(["init", "--name", "upload-app", "--builtin-repo"]);
    expect(initResult.exitCode, `init failed: ${initResult.stderr}`).toBe(0);
    const initData = JSON.parse(initResult.stdout);
    const projectDir = path.join(workDir, "upload-app");

    // Step 2: verify initial page loads
    await page.goto(initData.url);
    const initialHtml = await page.content();
    expect(initialHtml).toContain("<html");

    // Step 3: modify dist/index.html
    const distDir = path.join(projectDir, "dist");
    const indexPath = path.join(distDir, "index.html");
    const newContent = "<html><body><h1>Updated via upload!</h1></body></html>";
    await fs.promises.writeFile(indexPath, newContent);

    // Step 4: upload
    const uploadResult = await runCli(["upload"], projectDir);
    expect(uploadResult.exitCode, `upload failed: ${uploadResult.stderr}`).toBe(0);

    // Step 5: verify page shows new content
    await page.reload();
    const updatedHtml = await page.content();
    expect(updatedHtml).toContain("Updated via upload!");
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});
