import { execFile as execFileCb } from "node:child_process";
import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { storagePlugin } from "../../src/plugins/storage.js";
import { verificationPlugin } from "../../src/plugins/verification.js";
import { sessionPlugin } from "../../src/plugins/session.js";
import { authPlugin, registerVersionCheck } from "../../src/plugins/auth.js";
import { closeMetaDb, BOOTSTRAP_USER_ID, createInitialAdmin } from "../../src/lib/meta-sqlite.js";
import { keysRoutes } from "../../src/routes/keys.js";
import { uploadRoutes } from "../../src/routes/upload.js";
import { pagesRoutes } from "../../src/routes/pages.js";
import { serveRoutes } from "../../src/routes/serve.js";
import { schemasRoutes } from "../../src/routes/schemas.js";
import { configRoutes } from "../../src/routes/config.js";
import { createCliRoutes } from "../../src/routes/cli.js";
import type { ReleaseAsset, ReleaseManifestProvider } from "../../src/lib/release-manifest.js";
import { groupsRoutes } from "../../src/routes/groups.js";
import { authRoutes } from "../../src/routes/auth.js";
import { platformDataRoutes } from "../../src/routes/platform-data.js";
import { dbRoutes } from "../../src/routes/db.js";
import { verificationRoutes } from "../../src/routes/verification.js";
import { initContentStorage } from "../../src/lib/s3-client.js";

const execFile = promisify(execFileCb);

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../../..");
const CLI_DIR = path.join(PROJECT_ROOT, "packages", "cli");
const CLI_RELEASE_DIR = path.join(PROJECT_ROOT, "packages", "server", "static", "cli");
const CLI_BIN_NAME = process.platform === "win32" ? "localapp.exe" : "localapp";
const CLI_BIN_PATH = path.join(CLI_DIR, "target", "debug", CLI_BIN_NAME);
const RELEASE_TARGETS = JSON.parse(
  fs.readFileSync(path.join(PROJECT_ROOT, "packages", "shared", "release-targets.json"), "utf8"),
) as {
  targets: Array<{
    os: string;
    arch: string;
    rustTarget: string;
    cliFilename: string;
    desktop: boolean;
  }>;
};

function releaseBinaryName(): string | null {
  const osName = process.platform === "darwin" ? "macos"
    : process.platform === "win32" ? "windows"
      : process.platform;
  const arch = process.arch === "arm64" ? "aarch64"
    : process.arch === "x64" ? "x86_64"
      : process.arch;
  return RELEASE_TARGETS.targets.find(
    (target) => target.os === osName && target.arch === arch,
  )?.cliFilename ?? null;
}

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCliOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface CliTestEnv {
  baseUrl: string;
  apiKey: string;
  userId: string;
  cliBin: string;
  dataDir: string;
  app: FastifyInstance;
  cleanup: () => Promise<void>;
}

export interface CreateCliTestEnvOptions {
  withUpdateRoutes?: boolean;
  minCliVersion?: string;
}

let cliBinCached: string | null = null;

export async function buildCli(): Promise<string> {
  const expectedVersion = fs.readFileSync(path.join(CLI_DIR, "Cargo.toml"), "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const binaryMatchesPackage = async (binaryPath: string): Promise<boolean> => {
    if (!expectedVersion || !fs.existsSync(binaryPath)) return false;
    try { return (await execFile(binaryPath, ["--version"], { timeout: 5_000 })).stdout.trim().endsWith(` ${expectedVersion}`); }
    catch { return false; }
  };
  if (cliBinCached && await binaryMatchesPackage(cliBinCached)) return cliBinCached;
  if (await binaryMatchesPackage(CLI_BIN_PATH)) { cliBinCached = CLI_BIN_PATH; return CLI_BIN_PATH; }

  const releaseName = releaseBinaryName();
  const releasePath = expectedVersion && releaseName
    ? path.join(CLI_RELEASE_DIR, expectedVersion, releaseName)
    : null;
  if (releasePath && await binaryMatchesPackage(releasePath)) {
    cliBinCached = releasePath;
    return releasePath;
  }

  const { stdout, stderr } = await execFile("cargo", ["build"], {
    cwd: CLI_DIR,
    timeout: 120_000,
    shell: true,
  });

  if (!fs.existsSync(CLI_BIN_PATH)) {
    throw new Error(`CLI binary not found after build.\nstdout: ${stdout}\nstderr: ${stderr}`);
  }

  cliBinCached = CLI_BIN_PATH;
  return CLI_BIN_PATH;
}

export async function createCliTestEnv(opts?: CreateCliTestEnvOptions): Promise<CliTestEnv> {
  closeMetaDb();
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-e2e-"));
  const apiKey = "e2e-test-api-key-" + Math.random().toString(36).slice(2, 10);
  const cliBin = await buildCli();
  const cliVersion = fs
    .readFileSync(path.join(CLI_DIR, "Cargo.toml"), "utf8")
    .match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? "0.1.0";

  process.env.DATA_DIR = dataDir;
  process.env.BOOTSTRAP_API_KEY = apiKey;
  process.env.JWT_SECRET = "test-jwt-secret-key";
  process.env.TEMPLATE_REPO_URL = "https://github.com/example/template.git";
  if (opts?.minCliVersion) {
    process.env.MIN_CLI_VERSION = opts.minCliVersion;
  } else {
    delete process.env.MIN_CLI_VERSION;
  }

  const app: FastifyInstance = Fastify({ ignoreTrailingSlash: true });

  await app.register(storagePlugin);
  createInitialAdmin(
    BOOTSTRAP_USER_ID,
    BOOTSTRAP_USER_ID,
    await bcrypt.hash("localadmin", 10),
    apiKey,
  );
  await initContentStorage(app.config);
  await app.register(verificationPlugin);
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(sessionPlugin);

  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes);
  app.register(platformDataRoutes);
  app.register(verificationRoutes);
  app.register(serveRoutes);

  // CLI update routes (auth, no version check)
  if (opts?.withUpdateRoutes) {
    const targetAssets = (version: string): ReleaseAsset[] => RELEASE_TARGETS.targets.map((target) => ({
      kind: "cli",
      version,
      os: target.os,
      arch: target.arch,
      filename: target.cliFilename,
      url: `https://releases.example/${version}/${target.cliFilename}`,
      size: 1,
      sha256: "a".repeat(64),
      signature: "unsigned",
    }));
    const manifestProvider: ReleaseManifestProvider = {
      async get() {
        return {
          fetchedAt: Date.now(),
          stale: false,
          manifest: {
            schemaVersion: 1,
            latest: cliVersion,
            min: "0.1.0",
            generatedAt: "2026-07-30T00:00:00.000Z",
            assets: [...targetAssets(cliVersion), ...targetAssets("0.1.0")],
          },
        };
      },
    };
    app.register(async (updateScope) => {
      await authPlugin(updateScope);
      updateScope.register(createCliRoutes({ manifestProvider }));
    });
  }

  // Business routes
  app.register(async (authScope) => {
    await authPlugin(authScope);
    if (opts?.minCliVersion) {
      registerVersionCheck(authScope);
    }
    authScope.register(keysRoutes);
    authScope.register(configRoutes);
    authScope.register(uploadRoutes);
    authScope.register(dbRoutes);
    authScope.register(pagesRoutes);
    authScope.register(schemasRoutes);
    authScope.register(groupsRoutes);
  });

  await app.listen({ port: 0, host: "127.0.0.1" });

  const addresses = app.addresses();
  const addr = addresses[0];
  if (!addr || typeof addr === "string") throw new Error("Server not listening");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    apiKey,
    userId: BOOTSTRAP_USER_ID,
    cliBin,
    dataDir,
    app,
    cleanup: async () => {
      await app.close();
      closeMetaDb();
      await fs.promises.rm(dataDir, { recursive: true, force: true });
      delete process.env.MIN_CLI_VERSION;
    },
  };
}

export async function runCli(args: string[], options?: RunCliOptions): Promise<CliResult> {
  const env: Record<string, string> = {
    PATH: process.env.PATH || "",
    HOME: fs.mkdtempSync(path.join(os.tmpdir(), "localapp-cli-home-")),
    USERPROFILE: fs.mkdtempSync(path.join(os.tmpdir(), "localapp-cli-profile-")),
    TEMP: process.env.TEMP || "",
    TMP: process.env.TMP || "",
    SYSTEMROOT: process.env.SYSTEMROOT || "",
    LOCALAPP_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), "localapp-cli-config-")),
  };
  if (options?.env) {
    Object.assign(env, options.env);
  }

  try {
    const { stdout, stderr } = await execFile(cliBinCached || CLI_BIN_PATH, args, {
      cwd: options?.cwd,
      env,
      timeout: 30_000,
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (err: any) {
    const exitCode = typeof err.code === "number" ? err.code : 1;
    return {
      exitCode,
      stdout: (err.stdout ?? "").toString().trim(),
      stderr: (err.stderr ?? "").toString().trim(),
    };
  }
}

export async function createTmpProjectDir(files?: Record<string, string>): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-project-"));

  if (files) {
    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(dir, filePath);
      await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.promises.writeFile(fullPath, content);
    }
  }

  return {
    dir,
    cleanup: () => fs.promises.rm(dir, { recursive: true, force: true }),
  };
}

export function cliEnvVars(env: CliTestEnv): Record<string, string> {
  return {
    LOCALAPP_SERVER_URL: env.baseUrl,
    LOCALAPP_API_KEY: env.apiKey,
  };
}

export async function createTemplateRepo(): Promise<{ repoDir: string; cleanup: () => Promise<void> }> {
  const repoDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-template-"));

  // Create minimal template structure
  await fs.promises.writeFile(path.join(repoDir, "package.json"), JSON.stringify({ name: "template", scripts: { build: "vite build" } }, null, 2));
  await fs.promises.mkdir(path.join(repoDir, "src"), { recursive: true });
  await fs.promises.writeFile(path.join(repoDir, "src", "main.tsx"), 'import React from "react";\n');
  await fs.promises.writeFile(path.join(repoDir, ".gitignore"), "node_modules\ndist\n");

  // Initialize git repo
  await execFile("git", ["init"], { cwd: repoDir });
  await execFile("git", ["add", "-A"], { cwd: repoDir });
  await execFile("git", ["commit", "-m", "init template"], { cwd: repoDir });

  return {
    repoDir,
    cleanup: () => fs.promises.rm(repoDir, { recursive: true, force: true }),
  };
}
