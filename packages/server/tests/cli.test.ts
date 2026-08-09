import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { createAuthenticatedCliRoutes } from "../src/routes/cli.js";
import type { ReleaseManifestProvider } from "../src/lib/release-manifest.js";
import { storagePlugin } from "../src/plugins/storage.js";
import { closeMetaDb, createInitialAdmin } from "../src/lib/meta-sqlite.js";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TEST_API_KEY = "test-api-key-for-cli-update";
const WINDOWS_ASSET_URL = "https://releases.example/localapp-cli-x86_64-pc-windows-msvc.exe";
const manifestProvider: ReleaseManifestProvider = {
  async get() {
    return {
      fetchedAt: Date.parse("2026-07-30T00:00:00.000Z"),
      stale: false,
      manifest: {
        schemaVersion: 1,
        latest: "1.2.0",
        min: "1.0.0",
        generatedAt: "2026-07-30T00:00:00.000Z",
        assets: [{
          kind: "cli",
          version: "1.2.0",
          os: "windows",
          arch: "x86_64",
          filename: "localapp-cli-x86_64-pc-windows-msvc.exe",
          url: WINDOWS_ASSET_URL,
          size: 12,
          sha256: "a".repeat(64),
          signature: "unsigned",
        }],
      },
    };
  },
};

let app: FastifyInstance;
let baseUrl: string;
let dataDir: string;

beforeAll(async () => {
  dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-cli-test-"));
  process.env.DATA_DIR = dataDir;
  process.env.BOOTSTRAP_API_KEY = TEST_API_KEY;
  process.env.TEMPLATE_REPO_URL = "https://github.com/example/template.git";

  app = Fastify({ ignoreTrailingSlash: true });
  await app.register(storagePlugin);
  createInitialAdmin("localadmin", "localadmin", await bcrypt.hash("localadmin", 10), TEST_API_KEY);

  app.register(createAuthenticatedCliRoutes({ manifestProvider }));

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.addresses()[0];
  if (!addr || typeof addr === "string") throw new Error("Server not listening");
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await app.close();
  closeMetaDb();
  if (dataDir) {
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }
});

function apiHeaders() {
  return { "X-API-Key": TEST_API_KEY };
}

describe("GET /api/cli/version", () => {
  it("requires authentication through the production route wrapper", async () => {
    const res = await fetch(`${baseUrl}/api/cli/version`);

    expect(res.status).toBe(401);
  });

  it("returns normalized release manifest content", async () => {
    const res = await fetch(`${baseUrl}/api/cli/version`, {
      headers: apiHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("min");
    expect(body).toHaveProperty("latest");
    expect(body.assets[0]).toMatchObject({
      version: "1.2.0",
      os: "windows",
      arch: "x86_64",
      size: 12,
      sha256: "a".repeat(64),
    });
    expect(body.stale).toBe(false);
  });
});

describe("GET /api/cli/download", () => {
  it("returns 400 when os or arch query params are missing", async () => {
    const res = await fetch(`${baseUrl}/api/cli/download`, {
      headers: apiHeaders(),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it("returns a stable 404 for an unknown target", async () => {
    const res = await fetch(`${baseUrl}/api/cli/download?os=freebsd&arch=x86_64`, {
      headers: apiHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("CLI_ASSET_NOT_FOUND");
  });

  it("redirects to the exact validated HTTPS asset with integrity metadata", async () => {
    const res = await fetch(
      `${baseUrl}/api/cli/download?os=windows&arch=x86_64`,
      { headers: apiHeaders(), redirect: "manual" },
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(WINDOWS_ASSET_URL);
    expect(res.headers.get("x-localapp-asset-size")).toBe("12");
    expect(res.headers.get("x-localapp-asset-sha256")).toBe("a".repeat(64));
  });
});
