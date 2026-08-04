import { test, expect } from "./helpers";

test.skip("init --builtin-repo creates page", async ({ page, baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cwd = process.cwd();
  const cliBin = path.join(cwd, "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-cli-"));
  const env = { PATH: process.env.PATH || "", SYSTEMROOT: process.env.SYSTEMROOT || "", USERPROFILE: process.env.USERPROFILE || "", TEMP: process.env.TEMP || "", TMP: process.env.TMP || "", LOCALAPP_SERVER_URL: baseUrl, LOCALAPP_API_KEY: "test-ui-api-key-1234567890abcdef" };
  try {
    const result = await new Promise((resolve) => {
      execFile(cliBin, ["init", "--name", "test-app", "--builtin-repo"], { cwd: workDir, env, timeout: 120000 }, (err, stdout, stderr) => {
        if (err) resolve({ exitCode: 1, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() });
        else resolve({ exitCode: 0, stdout: String(stdout).trim(), stderr: String(stderr || "").trim() });
      });
    });
    expect(result.exitCode, `CLI failed: ${result.stderr}`).toBe(0);
    const data = JSON.parse(result.stdout);
    expect(data.created).toBe("test-app");
    expect(data.url).toBeTruthy();
    const response = await page.goto(data.url);
    expect(response.status()).toBe(200);
    expect(await page.content()).toContain("<html");
  } finally { await fs.promises.rm(workDir, { recursive: true, force: true }); }
});

test("init with invalid name returns error", async ({ baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cliBin = path.join(process.cwd(), "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-cli-"));
  const env = { PATH: process.env.PATH || "", SYSTEMROOT: process.env.SYSTEMROOT || "", USERPROFILE: process.env.USERPROFILE || "", TEMP: process.env.TEMP || "", TMP: process.env.TMP || "", LOCALAPP_SERVER_URL: baseUrl, LOCALAPP_API_KEY: "test-ui-api-key-1234567890abcdef" };
  try {
    const result = await new Promise((resolve) => {
      execFile(cliBin, ["init", "--name", "XX", "--builtin-repo"], { cwd: workDir, env, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) resolve({ exitCode: 1, stdout: String(stdout || "").trim(), stderr: String(stderr || "").trim() });
        else resolve({ exitCode: 0, stdout: String(stdout).trim(), stderr: String(stderr || "").trim() });
      });
    });
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error).toContain("Invalid name");
  } finally { await fs.promises.rm(workDir, { recursive: true, force: true }); }
});
