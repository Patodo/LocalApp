import { test, expect } from "./helpers";

test.skip("SDK detectBasePath correct under /serve/{uid}/{name}/", async ({ page, baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cliBin = path.join(process.cwd(), "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-sdk-"));
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
    const initResult = await runCli(["init", "--name", "sdk-test", "--builtin-repo"]);
    expect(initResult.exitCode, `init failed: ${initResult.stderr}`).toBe(0);
    const initData = JSON.parse(initResult.stdout);
    const projectDir = path.join(workDir, "sdk-test");

    // Step 2: backend resource generate
    const schemaResult = await runCli(["generate", "schema", "items"], projectDir);
    expect(schemaResult.exitCode, `generate schema failed: ${schemaResult.stderr}`).toBe(0);

    // Step 3: build test HTML with inline SDK logic
    const testHtml = `<!DOCTYPE html>
<html><body>
<div id="result"></div>
<script type="module">
function detectBasePath() {
  const pathname = window.location.pathname;
  const match = pathname.match(/^(\\/serve\\/[^/]+\\/[^/]+)/);
  return match ? match[1] + '/api' : '/api';
}
const basePath = detectBasePath();
document.getElementById('result').textContent = JSON.stringify({ basePath });
</script>
</body></html>`;

    const distDir = path.join(projectDir, "dist");
    await fs.promises.mkdir(distDir, { recursive: true });
    await fs.promises.writeFile(path.join(distDir, "index.html"), testHtml);

    // Step 4: upload
    const uploadResult = await runCli(["upload"], projectDir);
    expect(uploadResult.exitCode, `upload failed: ${uploadResult.stderr}`).toBe(0);

    // Step 5: verify basePath in browser
    await page.goto(initData.url);
    const resultText = await page.locator("#result").textContent();
    const result = JSON.parse(resultText);
    expect(result.basePath).toMatch(/^\/serve\/[^/]+\/sdk-test\/api$/);

  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});

test.skip("SDK create + list full chain", async ({ page, baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cliBin = path.join(process.cwd(), "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-sdk-"));
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
    // Setup: init + backend resource generate
    const initResult = await runCli(["init", "--name", "sdk-crud", "--builtin-repo"]);
    expect(initResult.exitCode, `init failed: ${initResult.stderr}`).toBe(0);
    const initData = JSON.parse(initResult.stdout);
    const projectDir = path.join(workDir, "sdk-crud");

    const schemaResult = await runCli(["generate", "schema", "items"], projectDir);
    expect(schemaResult.exitCode, `generate schema failed: ${schemaResult.stderr}`).toBe(0);

    // Build test HTML that does create + list
    const testHtml = `<!DOCTYPE html>
<html><body>
<div id="result"></div>
<script type="module">
function detectBasePath() {
  const pathname = window.location.pathname;
  const match = pathname.match(/^(\\/serve\\/[^/]+\\/[^/]+)/);
  return match ? match[1] + '/api' : '/api';
}
const basePath = detectBasePath();
try {
  // Create
  const createRes = await fetch(basePath + '/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'hello' })
  });
  const createBody = await createRes.json();

  // List
  const listRes = await fetch(basePath + '/items');
  const listBody = await listRes.json();

  document.getElementById('result').textContent = JSON.stringify({
    createStatus: createRes.status,
    createTitle: createBody.data?.title,
    listStatus: listRes.status,
    listLength: listBody.data?.length,
    listItemTitle: listBody.data?.[0]?.title
  });
} catch (e) {
  document.getElementById('result').textContent = JSON.stringify({ error: e.message });
}
</script>
</body></html>`;

    const distDir = path.join(projectDir, "dist");
    await fs.promises.mkdir(distDir, { recursive: true });
    await fs.promises.writeFile(path.join(distDir, "index.html"), testHtml);

    const uploadResult = await runCli(["upload"], projectDir);
    expect(uploadResult.exitCode, `upload failed: ${uploadResult.stderr}`).toBe(0);

    // Verify in browser
    await page.goto(initData.url);
    const resultText = await page.locator("#result").textContent();
    const result = JSON.parse(resultText);

    expect(result.error).toBeUndefined();
    expect(result.createStatus).toBe(201);
    expect(result.createTitle).toBe("hello");
    expect(result.listStatus).toBe(200);
    expect(result.listLength).toBe(1);
    expect(result.listItemTitle).toBe("hello");

  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});
