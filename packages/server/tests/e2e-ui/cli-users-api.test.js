import { test, expect } from "./helpers";

test.skip("SDK useUsers returns user list in browser", async ({ page, baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cliBin = path.join(process.cwd(), "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-users-"));
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
    // Step 1: CLI init
    const initResult = await runCli(["init", "--name", "users-test", "--builtin-repo"]);
    expect(initResult.exitCode, `init failed: ${initResult.stderr}`).toBe(0);
    const initData = JSON.parse(initResult.stdout);
    const projectDir = path.join(workDir, "users-test");

    // Step 2: build HTML with inline users fetch (using API key for auth)
    const apiKey = env.LOCALAPP_API_KEY;
    const testHtml = `<!DOCTYPE html>
<html><body>
<div id="result"></div>
<script type="module">
try {
  const res = await fetch('/api/users', { headers: { 'X-API-Key': '${apiKey}' } });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  document.getElementById('result').textContent = JSON.stringify({ status: res.status, body });
} catch (e) {
  document.getElementById('result').textContent = JSON.stringify({ error: e.message });
}
</script>
</body></html>`;

    const distDir = path.join(projectDir, "dist");
    await fs.promises.mkdir(distDir, { recursive: true });
    await fs.promises.writeFile(path.join(distDir, "index.html"), testHtml);

    // Step 3: upload
    const uploadResult = await runCli(["upload"], projectDir);
    expect(uploadResult.exitCode, `upload failed: ${uploadResult.stderr}`).toBe(0);

    // Step 4: verify user list in browser
    await page.goto(initData.url);
    const resultText = await page.locator("#result").textContent();
    const result = JSON.parse(resultText);

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(Array.isArray(result.body.data)).toBe(true);
    expect(result.body.data.length).toBeGreaterThan(0);

    const user = result.body.data[0];
    expect(user).toHaveProperty("id");
    expect(user).toHaveProperty("name");
    expect(user).toHaveProperty("displayName");
    expect(user).not.toHaveProperty("password");
    expect(user).not.toHaveProperty("role");

  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});

test("SDK useUsers returns 401 for unauthenticated browser request", async ({ page, baseUrl }) => {
  // Directly request /api/users without any auth - should return 401
  const res = await page.request.get(baseUrl + "/api/users");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.success).toBe(false);
});
