import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CliIo } from "../src/cli/output.js";
import { runDev, writeDevConfig } from "../src/commands/dev.js";
import { readOrCreateDevCredentials } from "../src/dev/credentials.js";
import { spawnOwnedProcess, type OwnedProcess } from "../src/process/process-tree.js";
import { waitForServerReady } from "../src/process/readiness.js";
import { runLocalApp } from "../src/main.js";

const repositoryRoot = path.resolve(process.cwd(), "../..");
const testRoot = path.join(repositoryRoot, "tmp/task-6-dev-tests");
const directories: string[] = [];
const processes: OwnedProcess[] = [];

beforeAll(async () => {
  await fs.mkdir(testRoot, { recursive: true });
});

afterEach(async () => {
  await Promise.allSettled(processes.splice(0).map((process) => process.terminate()));
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("canonical local development", () => {
  it("reports asynchronous dev startup failures as structured CLI errors", async () => {
    // Break caught: returning the runDev promise outside the CLI try/catch leaks an unhandled stack trace.
    const output = captureIo();

    await expect(runLocalApp(["dev"], output.io)).resolves.toBe(1);

    expect(output.stderr).toContain('"code":"project_manifest_missing"');
    expect(output.stderr).not.toContain("LocalAppLifecycleError");
  });

  it("keeps stable CSPRNG credentials private and dev-config credential-free", async () => {
    // Break caught: predictable or public dev credentials allow another local user or checked-in config to impersonate the owner.
    const projectDir = await fixtureProject();
    const durableConfig = path.join(projectDir, ".localapp/project-config.json");
    await fs.writeFile(durableConfig, '{"autoSync":false,"sentinel":"preserve"}\n');

    const first = await readOrCreateDevCredentials(projectDir);
    const second = await readOrCreateDevCredentials(projectDir);
    await writeDevConfig({
      projectDir,
      serverUrl: "http://127.0.0.1:43127",
      pageName: "task-six-app",
      appServerPort: 5182,
    });

    expect(second).toEqual(first);
    expect(first.apiKey).toMatch(/^localapp_dev_[0-9a-f]{64}$/);
    expect(first.password).toMatch(/^localapp_dev_password_[0-9a-f]{64}$/);
    expect(first.jwtSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const stateRoot = path.join(projectDir, "tmp/localapp-dev");
    expect(Object.values(first.paths).every((filePath) => path.dirname(filePath) === stateRoot)).toBe(true);
    if (process.platform !== "win32") {
      for (const filePath of Object.values(first.paths)) {
        expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
      }
    }
    expect(JSON.parse(await fs.readFile(path.join(projectDir, ".localapp/dev-config.json"), "utf8"))).toEqual({
      serverUrl: "http://127.0.0.1:43127",
      userId: "dev-user",
      pageName: "task-six-app",
      appServerPort: 5182,
    });
    expect(await fs.readFile(durableConfig, "utf8")).toBe('{"autoSync":false,"sentinel":"preserve"}\n');
  });

  it("accepts only the structured exact loopback Server ready listener", async () => {
    // Break caught: trusting public url, arbitrary log text, or a non-loopback listenUrl can expose dev credentials over the network.
    const projectDir = await fixtureProject();
    const valid = spawnOwnedProcess(process.execPath, ["-e", `
      console.log("Server listening at https://public.example");
      console.log(JSON.stringify({ type: "ready", url: "https://public.example", listenUrl: "http://127.0.0.1:43127" }));
      setInterval(() => {}, 1000);
    `], { cwd: projectDir, stdio: ["ignore", "pipe", "ignore"] });
    processes.push(valid);

    await expect(waitForServerReady(valid, { timeoutMs: 1_000 })).resolves.toMatchObject({
      listenUrl: "http://127.0.0.1:43127",
    });

    const invalid = spawnOwnedProcess(process.execPath, ["-e", `
      console.log(JSON.stringify({ type: "ready", url: "https://public.example", listenUrl: "http://0.0.0.0:43127" }));
      setInterval(() => {}, 1000);
    `], { cwd: projectDir, stdio: ["ignore", "pipe", "ignore"] });
    processes.push(invalid);
    await expect(waitForServerReady(invalid, { timeoutMs: 1_000 })).rejects.toThrow(/exact http:\/\/127\.0\.0\.1:<port>/i);
  });

  it("bounds Server readiness and terminates the silent process tree", async () => {
    // Break caught: an unstructured or wedged Server can hang localapp dev indefinitely and survive startup failure.
    const projectDir = await fixtureProject();
    const silent = spawnOwnedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "ignore"],
      gracefulTimeoutMs: 50,
      forceTimeoutMs: 1_000,
    });
    processes.push(silent);
    const started = Date.now();

    await expect(waitForServerReady(silent, { timeoutMs: 100 })).rejects.toThrow(/readiness timed out after 100 ms/i);
    await silent.terminate();

    expect(Date.now() - started).toBeLessThan(2_000);
    await expect(silent.exited).resolves.toBeDefined();
  });

  it("an abort during Server readiness terminates startup immediately", async () => {
    // Break caught: consulting AbortSignal only after Vite starts leaves a silent Server alive until the 15-second readiness deadline.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = path.join(fixtureRoot, "silent-server.mjs");
    const pidPath = path.join(fixtureRoot, "silent-server.pid");
    await fs.writeFile(serverLauncher, `
      import fs from "node:fs";
      fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
      setInterval(() => {}, 1000);
    `);
    const controller = new AbortController();
    const output = captureIo();
    const running = runDev({ projectDir, signal: controller.signal, io: output.io }, {
      serverLauncher,
      readyTimeoutMs: 5_000,
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
    });
    const pid = Number(await waitForFile(pidPath));
    const started = Date.now();

    controller.abort();

    await expect(running).resolves.toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
    await expect(waitForProcessExit(pid)).resolves.toBe(true);
  });

  it("builds and installs a unique package before loopback Vite, then abort cleans both trees without leaking credentials", async () => {
    // Break caught: starting Vite before canonical install serves stale APIs, and leader-only abort cleanup leaves Server/Vite descendants alive.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const viteLauncher = await writeFakeVite(fixtureRoot, false);
    const controller = new AbortController();
    const output = captureIo();
    const invocation = runDev({ projectDir, signal: controller.signal, io: output.io }, {
      serverLauncher,
      viteCommand: { command: process.execPath, args: [viteLauncher] },
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
    });
    const viteStatePath = path.join(fixtureRoot, "vite.json");
    const viteState = JSON.parse(await waitForFile(viteStatePath)) as { pid: number; config: Record<string, unknown>; args: string[] };
    const serverState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "server.json"), "utf8")) as { pid: number; host: string; port: number; args: string[] };
    const installState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "install.json"), "utf8")) as { authenticated: boolean; bytes: number };
    const packageState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "package.json"), "utf8")) as { outputPath: string; versionOverride: string };
    const credentials = await readOrCreateDevCredentials(projectDir);

    expect(serverState).toMatchObject({ host: "127.0.0.1", port: 0 });
    expect(serverState.args).toEqual([
      "start", "--data-dir", path.join(projectDir, "tmp/localapp-dev/server"), "--host", "127.0.0.1", "--port", "0",
    ]);
    expect(installState.authenticated).toBe(true);
    expect(installState.bytes).toBeGreaterThan(0);
    expect(packageState.outputPath.startsWith(path.join(projectDir, "tmp/localapp-dev/packages"))).toBe(true);
    expect(packageState.versionOverride).toMatch(/^0\.0\.0-dev\./);
    expect(viteState.config).toEqual({
      serverUrl: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      userId: "dev-user",
      pageName: "task-six-app",
      appServerPort: expect.any(Number),
    });
    expect(viteState.args).toContain("127.0.0.1");
    expect(JSON.stringify(viteState)).not.toContain(credentials.apiKey);
    expect(output.stdout + output.stderr).not.toContain(credentials.apiKey);
    expect(output.stdout + output.stderr).not.toContain(credentials.password);
    expect(output.stdout + output.stderr).not.toContain(credentials.jwtSecret);

    controller.abort();
    await expect(invocation).resolves.toBe(0);
    await expect(waitForProcessExit(serverState.pid)).resolves.toBe(true);
    await expect(waitForProcessExit(viteState.pid)).resolves.toBe(true);
  });

  it("a Vite exit terminates the still-running Server tree", async () => {
    // Break caught: supervising only interrupts leaves the canonical Server orphaned when one child exits by itself.
    const projectDir = await fixtureProject();
    const fixtureRoot = path.join(projectDir, "tmp/localapp-dev/fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    const serverLauncher = await writeFakeServer(fixtureRoot);
    const viteLauncher = await writeFakeVite(fixtureRoot, true);
    const output = captureIo();

    const code = await runDev({ projectDir, signal: new AbortController().signal, io: output.io }, {
      serverLauncher,
      viteCommand: { command: process.execPath, args: [viteLauncher] },
      buildApplicationPackage: fakePackageBuilder(fixtureRoot),
    });

    const serverState = JSON.parse(await fs.readFile(path.join(fixtureRoot, "server.json"), "utf8")) as { pid: number };
    expect(code).toBe(1);
    await expect(waitForProcessExit(serverState.pid)).resolves.toBe(true);
  });
});

async function fixtureProject(): Promise<string> {
  const projectDir = await fs.mkdtemp(path.join(testRoot, "project-"));
  directories.push(projectDir);
  await fs.mkdir(path.join(projectDir, ".localapp"), { recursive: true });
  await fs.writeFile(path.join(projectDir, "manifest.json"), `${JSON.stringify({ name: "task-six-app" })}\n`);
  return projectDir;
}

async function writeFakeServer(fixtureRoot: string): Promise<string> {
  const filePath = path.join(fixtureRoot, "fake-server.mjs");
  await fs.writeFile(filePath, `
    import fs from "node:fs";
    import http from "node:http";
    import path from "node:path";
    const args = process.argv.slice(2);
    const value = (flag) => args[args.indexOf(flag) + 1];
    const host = value("--host");
    const port = Number(value("--port"));
    const fixtureRoot = ${JSON.stringify(fixtureRoot)};
    fs.writeFileSync(path.join(fixtureRoot, "server.json"), JSON.stringify({ pid: process.pid, host, port, args }));
    const server = http.createServer((request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        if (request.url === "/api/setup/initialize") {
          fs.writeFileSync(path.join(fixtureRoot, "setup.json"), JSON.stringify({ initialized: true }));
          response.writeHead(201, { "content-type": "application/json" });
          response.end(JSON.stringify({ success: true }));
          return;
        }
        if (request.url === "/api/me/apps/install") {
          fs.writeFileSync(path.join(fixtureRoot, "install.json"), JSON.stringify({
            authenticated: request.headers["x-api-key"] === process.env.BOOTSTRAP_API_KEY,
            bytes: Buffer.concat(chunks).length,
          }));
          response.writeHead(201, { "content-type": "application/json" });
          response.end(JSON.stringify({ success: true, data: { name: "task-six-app" } }));
          return;
        }
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ success: false }));
      });
    });
    server.listen(0, host, () => {
      const address = server.address();
      const listenUrl = \`http://127.0.0.1:\${address.port}\`;
      console.log(JSON.stringify({ type: "ready", listenUrl, url: listenUrl, setupUrl: \`\${listenUrl}/setup?token=fixture-token\` }));
    });
    const stop = () => server.close(() => process.exit(0));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  `);
  return filePath;
}

async function writeFakeVite(fixtureRoot: string, exitImmediately: boolean): Promise<string> {
  const filePath = path.join(fixtureRoot, exitImmediately ? "exiting-vite.mjs" : "fake-vite.mjs");
  await fs.writeFile(filePath, `
    import fs from "node:fs";
    import path from "node:path";
    const fixtureRoot = ${JSON.stringify(fixtureRoot)};
    const config = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".localapp/dev-config.json"), "utf8"));
    if (!fs.existsSync(path.join(fixtureRoot, "install.json"))) process.exit(91);
    if (!process.env.LOCALAPP_DEV_API_KEY) process.exit(92);
    fs.writeFileSync(path.join(fixtureRoot, "vite.json"), JSON.stringify({ pid: process.pid, config, args: process.argv.slice(2) }));
    ${exitImmediately ? "process.exit(7);" : "setInterval(() => {}, 1000);"}
  `);
  return filePath;
}

function fakePackageBuilder(fixtureRoot: string) {
  return async (options: { outputPath?: string; versionOverride?: string }) => {
    const outputPath = options.outputPath!;
    const versionOverride = options.versionOverride!;
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, "canonical-package-fixture\n", { mode: 0o600 });
    await fs.writeFile(path.join(fixtureRoot, "package.json"), JSON.stringify({ outputPath, versionOverride }));
    return { path: outputPath, appId: "task-six-app", version: versionOverride, sha256: "fixture", size: 26 };
  };
}

function captureIo(): { io: CliIo; stdout: string; stderr: string } {
  const capture = {
    stdout: "",
    stderr: "",
    io: undefined as unknown as CliIo,
  };
  capture.io = {
    stdout: (value) => { capture.stdout += value; },
    stderr: (value) => { capture.stderr += value; },
  };
  return capture;
}

async function waitForFile(filePath: string, timeoutMs = 5_000): Promise<string> {
  return waitForCondition(async () => fs.readFile(filePath, "utf8").catch(() => undefined), `file ${filePath}`, timeoutMs);
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  return waitForCondition(() => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }, `process ${pid} exit`, 5_000);
}

async function waitForCondition<T>(condition: () => T | undefined | false | Promise<T | undefined | false>, label: string, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}
