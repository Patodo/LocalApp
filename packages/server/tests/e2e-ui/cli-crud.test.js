import { test, expect } from "./helpers";

test.skip("CLI init + backend resource generate → CRUD via browser", async ({ page, baseUrl }) => {
  const { execFile } = await import("node:child_process");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const cliBin = path.join(process.cwd(), "packages", "cli", "target", "debug", process.platform === "win32" ? "localapp.exe" : "localapp");
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-crud-"));
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
    const initResult = await runCli(["init", "--name", "crud-app", "--builtin-repo"]);
    expect(initResult.exitCode, `init failed: ${initResult.stderr}`).toBe(0);
    const initData = JSON.parse(initResult.stdout);
    expect(initData.created).toBe("crud-app");

    // Step 2: backend resource generate
    const projectDir = path.join(workDir, "crud-app");
    const schemaResult = await runCli(["generate", "schema", "todos"], projectDir);
    expect(schemaResult.exitCode, `generate schema failed: ${schemaResult.stderr}`).toBe(0);

    // Step 3: CRUD via page.evaluate
    const pageUrl = initData.url;
    const rawUrl = initData.rawUrl;
    await page.goto(pageUrl);

    // User-visible page URL is the formal PlatformShell route; app APIs stay under rawUrl.
    const apiUrl = rawUrl.replace(/\/$/, "") + "/api/todos";

    // Create
    const createResult = await page.evaluate(async (url) => {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: "Test todo", done: false }) });
      return { status: res.status, data: await res.json() };
    }, apiUrl);
    expect(createResult.status).toBe(201);
    expect(createResult.data.data.title).toBe("Test todo");

    // Read list
    const listResult = await page.evaluate(async (url) => {
      const res = await fetch(url);
      return { status: res.status, data: await res.json() };
    }, apiUrl);
    expect(listResult.status).toBe(200);
    expect(listResult.data.data.length).toBe(1);
    expect(listResult.data.data[0].title).toBe("Test todo");

    // Update
    const itemId = createResult.data.data.id;
    const updateResult = await page.evaluate(async ({ url, id }) => {
      const res = await fetch(`${url}/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ done: true }) });
      return { status: res.status, data: await res.json() };
    }, { url: apiUrl, id: itemId });
    expect(updateResult.status).toBe(200);
    expect(updateResult.data.data.done).toBe(1);

    // Delete
    const deleteResult = await page.evaluate(async ({ url, id }) => {
      const res = await fetch(`${url}/${id}`, { method: "DELETE" });
      return { status: res.status };
    }, { url: apiUrl, id: itemId });
    expect(deleteResult.status).toBe(200);
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
});
