import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { cliEnvVars, createCliTestEnv, createTmpProjectDir, runCli } from "./helpers.js";

describe("cli production verification", () => {
  let env: Awaited<ReturnType<typeof createCliTestEnv>>;
  const projectCleanups: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    env = await createCliTestEnv();
  });

  afterAll(async () => {
    for (const cleanup of projectCleanups.reverse()) await cleanup();
    await env.cleanup();
  });

  it("runs isolated HTTP/API smoke checks and leaves a browser session pending", async () => {
    const project = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "verify-e2e", description: "", distDir: "dist" }),
      "dist/index.html": "<main id=\"app\">Verify E2E</main>",
    });
    projectCleanups.push(project.cleanup);
    const vars = cliEnvVars(env);

    expect((await runCli(["new"], { cwd: project.dir, env: vars })).exitCode).toBe(0);
    expect((await runCli(["upload", "./dist"], { cwd: project.dir, env: vars })).exitCode).toBe(0);

    const result = await runCli(["verify", "--as", "member", "--json"], {
      cwd: project.dir,
      env: vars,
    });
    expect(result.exitCode, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      schemaVersion: 1,
      success: true,
      status: "pending-browser",
      identity: "member",
      owner: env.userId,
      app: "verify-e2e",
      version: 1,
      browserUrl: expect.stringContaining("/api/verification/open/"),
      browserSessionId: expect.any(String),
      pendingBrowserChecks: ["dom", "console", "interaction", "identity"],
    });
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: "http", status: "passed" }),
      expect.objectContaining({ phase: "api", status: "passed" }),
      expect.objectContaining({ phase: "identity", status: "passed" }),
      expect.objectContaining({ phase: "console", status: "pending" }),
    ]));

    const open = await fetch(report.browserUrl, { redirect: "manual" });
    expect(open.status).toBe(302);
    const reused = await fetch(report.browserUrl, { redirect: "manual" });
    expect(reused.status).toBe(410);

    const sessionDirs = await fs.readdir(path.join(env.dataDir, ".verification", "sessions"));
    expect(sessionDirs).toHaveLength(1);
    await finishBrowserSession(env, report.browserSessionId);
  });

  it("uploads and returns deployment and pending production verification separately", async () => {
    const project = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "upload-verify", description: "", distDir: "dist" }),
      "dist/index.html": "<main id=\"app\">Upload verify</main>",
    });
    projectCleanups.push(project.cleanup);

    const result = await runCli(["upload", "./dist", "--verify"], {
      cwd: project.dir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      success: true,
      status: "pending-browser",
      name: "upload-verify",
      version: 1,
      deployment: {
        status: "deployed",
        version: 1,
        url: `${env.baseUrl}/${env.userId}/upload-verify/`,
      },
      verification: {
        success: true,
        status: "pending-browser",
        identity: "owner",
        version: 1,
      },
    });
    await finishBrowserSession(
      env,
      report.verification.browserSessionId,
      report.verification.browserUrl,
    );
  });

  it("reports a deployed version even when post-deploy verification cannot start", async () => {
    const project = await createTmpProjectDir({
      "manifest.json": JSON.stringify({ name: "verify-capacity", description: "", distDir: "dist" }),
      "dist/index.html": "<main>Version one</main>",
    });
    projectCleanups.push(project.cleanup);
    const vars = cliEnvVars(env);
    expect((await runCli(["upload", "./dist"], { cwd: project.dir, env: vars })).exitCode).toBe(0);

    for (let index = 0; index < 8; index += 1) {
      const response = await fetch(`${env.baseUrl}/api/verification/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": env.apiKey },
        body: JSON.stringify({
          owner: env.userId,
          app: "verify-capacity",
          version: 1,
          identity: "owner",
        }),
      });
      expect(response.status).toBe(201);
    }
    await fs.writeFile(path.join(project.dir, "dist/index.html"), "<main>Version two</main>");

    const result = await runCli(["upload", "./dist", "--verify"], {
      cwd: project.dir,
      env: vars,
    });

    expect(result.exitCode).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      success: false,
      status: "verification-failed",
      version: 2,
      deployment: { status: "deployed", version: 2 },
      verification: { success: false, status: "failed", version: 2 },
    });
    const errorLine = result.stderr.split("\n").at(-1) ?? "";
    expect(JSON.parse(errorLine).error).toContain("deployed, but production verification failed");

    const page = await fetch(`${env.baseUrl}/api/pages/verify-capacity`, {
      headers: { "X-API-Key": env.apiKey },
    });
    expect((await page.json()).data.currentVersion).toBe(2);
  });

  it("stops an incompatible project without creating an empty application", async () => {
    const project = await createTmpProjectDir({
      "manifest.json": JSON.stringify({
        name: "future-platform",
        description: "",
        distDir: "dist",
        platformVersion: "^999.0",
      }),
      "dist/index.html": "<main>Future</main>",
    });
    projectCleanups.push(project.cleanup);

    const result = await runCli(["upload", "./dist", "--verify"], {
      cwd: project.dir,
      env: cliEnvVars(env),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("does not satisfy ^999.0");
    const page = await fetch(`${env.baseUrl}/api/pages/future-platform`, {
      headers: { "X-API-Key": env.apiKey },
    });
    expect(page.status).toBe(404);
  });
});

async function finishBrowserSession(
  env: Awaited<ReturnType<typeof createCliTestEnv>>,
  sessionId: string,
  openUrl?: string,
) {
  if (openUrl) {
    const opened = await fetch(openUrl, { redirect: "manual" });
    expect(opened.status).toBe(302);
  }
  const response = await fetch(`${env.baseUrl}/api/verification/sessions/${sessionId}/report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": env.apiKey },
    body: JSON.stringify({ status: "passed", checks: [] }),
  });
  expect(response.status).toBe(200);
}
