import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { runCli, createCliTestEnv, cliEnvVars } from "./helpers.js";
import fs from "node:fs";
import path from "node:path";

const CLI_STATIC_DIR = path.join(import.meta.dirname, "..", "..", "static", "cli");

function platformOs(): string {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  return "linux";
}

function platformArch(): string {
  if (process.arch === "x64") return "x86_64";
  if (process.arch === "arm64") return "aarch64";
  return process.arch;
}

function platformFilename(osName: string, archName: string): string {
  const ext = osName === "windows" ? ".exe" : "";
  let target = "";
  if (osName === "windows" && archName === "x86_64") target = "x86_64-pc-windows-msvc";
  else if (osName === "linux" && archName === "x86_64") target = "x86_64-unknown-linux-gnu";
  else if (osName === "macos" && archName === "aarch64") target = "aarch64-apple-darwin";
  else if (osName === "macos" && archName === "x86_64") target = "x86_64-apple-darwin";
  else target = `${archName}-unknown-${osName}`;
  return `localapp-cli-${target}${ext}`;
}

async function apiJson(env: { baseUrl: string; apiKey: string }, urlPath: string, opts?: { headers?: Record<string, string> }) {
  const headers: Record<string, string> = {
    "x-api-key": env.apiKey,
    ...(opts?.headers ?? {}),
  };
  const res = await fetch(`${env.baseUrl}${urlPath}`, { headers });
  const body = await res.json();
  return { status: res.status, body, headers: res.headers };
}

/**
 * Place a CLI binary at static/cli/0.1.0/ for the current platform.
 * Returns the fixture path, or null if the CLI binary doesn't exist.
 * Safe to call multiple times — no-op if fixture already exists.
 */
function ensureDownloadFixture(cliBin: string): string | null {
  const fname = platformFilename(platformOs(), platformArch());
  const verDir = path.join(CLI_STATIC_DIR, "0.1.0");
  const fixturePath = path.join(verDir, fname);

  if (!fs.existsSync(fixturePath)) {
    if (!fs.existsSync(cliBin)) return null;
    fs.mkdirSync(verDir, { recursive: true });
    fs.copyFileSync(cliBin, fixturePath);
  }
  return fixturePath;
}

function removeDownloadFixture(): void {
  const fname = platformFilename(platformOs(), platformArch());
  const fixturePath = path.join(CLI_STATIC_DIR, "0.1.0", fname);
  if (fs.existsSync(fixturePath)) {
    fs.unlinkSync(fixturePath);
  }
}

describe("cli-update", () => {
  // ═══════════════════════════════════════════════════
  // 版本检查 — 每个 test 独立 env（不同 MIN_CLI_VERSION）
  // ═══════════════════════════════════════════════════
  describe("version check", () => {
    it("should block business endpoint when CLI version is below min", async () => {
      const env = await createCliTestEnv({ minCliVersion: "999.0.0" });
      try {
        const result = await runCli(["pages", "list"], { env: cliEnvVars(env) });
        expect(result.exitCode).toBe(1);
        const err = JSON.parse(result.stderr);
        expect(err.error).toContain("outdated");
        expect(err.error).toContain("localapp update");
      } finally {
        await env.cleanup();
      }
    });

    it("should allow business endpoint when CLI version meets minimum", async () => {
      const env = await createCliTestEnv({ minCliVersion: "0.0.1" });
      try {
        const result = await runCli(["pages", "list"], { env: cliEnvVars(env) });
        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(data.success).toBe(true);
      } finally {
        await env.cleanup();
      }
    });

    it("should block request when X-CLI-Version header is missing", async () => {
      const env = await createCliTestEnv({ minCliVersion: "0.1.0" });
      try {
        const res = await fetch(`${env.baseUrl}/api/pages`, {
          headers: { "x-api-key": env.apiKey },
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toContain("CLI version unknown");
        expect(body.error).toContain("localapp update");
      } finally {
        await env.cleanup();
      }
    });

    it("should allow all requests when MIN_CLI_VERSION is not set", async () => {
      const env = await createCliTestEnv();
      try {
        const result = await runCli(["pages", "list"], { env: cliEnvVars(env) });
        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(data.success).toBe(true);
      } finally {
        await env.cleanup();
      }
    });
  });

  // ═══════════════════════════════════════════════════
  // 版本查询接口 GET /api/cli/version
  // ═══════════════════════════════════════════════════
  describe("version query endpoint", () => {
    let env: Awaited<ReturnType<typeof createCliTestEnv>>;

    beforeAll(async () => {
      env = await createCliTestEnv({ withUpdateRoutes: true });
    });

    afterAll(async () => {
      await env.cleanup();
    });

    it("should return version info with valid API key", async () => {
      const { status, body } = await apiJson(env, "/api/cli/version");
      expect(status).toBe(200);
      expect(body).toHaveProperty("latest");
      expect(body).toHaveProperty("min");
      expect(body).toHaveProperty("assets");
      expect(Array.isArray(body.assets)).toBe(true);
      expect(typeof body.latest).toBe("string");
      expect(typeof body.min).toBe("string");
    });

    it("should return 401 without API key", async () => {
      const res = await fetch(`${env.baseUrl}/api/cli/version`);
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════
  // 二进制下载接口 GET /api/cli/download
  // ═══════════════════════════════════════════════════
  describe("download endpoint", () => {
    let env: Awaited<ReturnType<typeof createCliTestEnv>>;

    beforeAll(async () => {
      env = await createCliTestEnv({ withUpdateRoutes: true });
      ensureDownloadFixture(env.cliBin);
    });

    afterAll(async () => {
      removeDownloadFixture();
      await env.cleanup();
    });

    it("should return 400 when os and arch params are missing", async () => {
      const { status, body } = await apiJson(env, "/api/cli/download");
      expect(status).toBe(400);
      expect(body.error).toContain("os and arch");
    });

    it("should return 400 when only arch is provided", async () => {
      const { status, body } = await apiJson(env, "/api/cli/download?arch=x86_64");
      expect(status).toBe(400);
    });

    it("should return 400 when only os is provided", async () => {
      const { status, body } = await apiJson(env, "/api/cli/download?os=windows");
      expect(status).toBe(400);
    });

    it("should return 404 when binary not found for platform", async () => {
      const { status, body } = await apiJson(env, "/api/cli/download?os=freebsd&arch=x86_64");
      expect(status).toBe(404);
      expect(body.code).toBe("CLI_ASSET_NOT_FOUND");
    });

    it("should redirect current platform to the validated asset", async () => {
      const osName = platformOs();
      const archName = platformArch();
      const res = await fetch(`${env.baseUrl}/api/cli/download?os=${osName}&arch=${archName}`, {
        headers: { "x-api-key": env.apiKey },
        redirect: "manual",
      });
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toMatch(/^https:\/\/releases\.example\//);
      expect(res.headers.get("x-localapp-asset-size")).toBe("1");
      expect(res.headers.get("x-localapp-asset-sha256")).toBe("a".repeat(64));
    });

    it("should redirect an explicitly selected version", async () => {
      const osName = platformOs();
      const archName = platformArch();
      const res = await fetch(
        `${env.baseUrl}/api/cli/download?os=${osName}&arch=${archName}&version=0.1.0`,
        { headers: { "x-api-key": env.apiKey }, redirect: "manual" },
      );
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toContain("/0.1.0/");
    });

    it("should return 401 without API key", async () => {
      const res = await fetch(`${env.baseUrl}/api/cli/download?os=windows&arch=x86_64`);
      expect(res.status).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════
  // CLI update 命令
  // ═══════════════════════════════════════════════════
  describe("update command", () => {
    let env: Awaited<ReturnType<typeof createCliTestEnv>>;

    beforeAll(async () => {
      env = await createCliTestEnv({ withUpdateRoutes: true });
    });

    afterAll(async () => {
      await env.cleanup();
    });

    it("should fail with configuration error when not configured", async () => {
      const result = await runCli(["update"]);
      expect(result.exitCode).toBe(1);
      const err = JSON.parse(result.stderr);
      expect(err.error).toContain("Not configured");
    });

    it("should report already up to date when CLI matches latest", async () => {
      const result = await runCli(["update"], { env: cliEnvVars(env) });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data.success).toBe(true);
      expect(data.message).toContain("Already up to date");
    });

    it("should output valid JSON on stdout for success", async () => {
      const result = await runCli(["update"], { env: cliEnvVars(env) });
      expect(result.exitCode).toBe(0);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("success");
    });
  });

  // ═══════════════════════════════════════════════════
  // Update 端点绕过版本检查 — 各自独立 env
  // ═══════════════════════════════════════════════════
  describe("bypass version check", () => {
    it("should allow /api/cli/version to bypass version check", async () => {
      const env = await createCliTestEnv({ withUpdateRoutes: true, minCliVersion: "999.0.0" });
      try {
        const { status, body } = await apiJson(env, "/api/cli/version");
        expect(status).toBe(200);
        expect(body.latest).toBeDefined();
      } finally {
        await env.cleanup();
      }
    });

    it("should allow /api/cli/download to bypass version check", async () => {
      const env = await createCliTestEnv({ withUpdateRoutes: true, minCliVersion: "999.0.0" });
      try {
        // Request an unsupported platform — should get 404 (not 403)
        // Getting anything but 403 proves the version check was bypassed
        const { status, body } = await apiJson(env, "/api/cli/download?os=freebsd&arch=x86_64");
        expect(status).toBe(404);
        expect(body.code).toBe("CLI_ASSET_NOT_FOUND");
      } finally {
        await env.cleanup();
      }
    });

    it("should allow update command to bypass version check", async () => {
      const env = await createCliTestEnv({ withUpdateRoutes: true, minCliVersion: "999.0.0" });
      try {
        const result = await runCli(["update"], { env: cliEnvVars(env) });
        expect(result.exitCode).toBe(0);
        const data = JSON.parse(result.stdout);
        expect(data.success).toBe(true);
      } finally {
        await env.cleanup();
      }
    });
  });
});
