import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import { authPlugin, registerVersionCheck } from "../src/plugins/auth.js";
import { storagePlugin } from "../src/plugins/storage.js";
import { closeMetaDb, createInitialAdmin, listUsers } from "../src/lib/meta-sqlite.js";
import bcrypt from "bcryptjs";
import { createCliRoutes } from "../src/routes/cli.js";
import type { ReleaseManifestProvider } from "../src/lib/release-manifest.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TEST_API_KEY = "test-api-key-vc-1234567890abcdef";
const manifestProvider: ReleaseManifestProvider = {
  async get() {
    return {
      fetchedAt: 0,
      stale: false,
      manifest: {
        schemaVersion: 1,
        latest: "1.0.0",
        min: "0.1.0",
        generatedAt: "2026-07-30T00:00:00.000Z",
        assets: [],
      },
    };
  },
};

async function buildApp(): Promise<{ app: FastifyInstance; baseUrl: string }> {
  const app = Fastify({ ignoreTrailingSlash: true });
  await app.register(storagePlugin);
  if (listUsers(1, 1).total === 0) {
    createInitialAdmin("localadmin", "localadmin", await bcrypt.hash("localadmin", 10), TEST_API_KEY);
  }

  // Update routes (auth, NO version check)
  app.register(async (scope) => {
    await authPlugin(scope);
    scope.register(createCliRoutes({ manifestProvider }));
  });

  // Business routes (auth + version check)
  app.register(async (scope) => {
    await authPlugin(scope);
    registerVersionCheck(scope);

    // Dummy business route for testing version check
    scope.get("/api/test", async () => ({ success: true }));
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.addresses()[0];
  if (!addr || typeof addr === "string") throw new Error("Server not listening");
  return { app, baseUrl: `http://127.0.0.1:${addr.port}` };
}

let dataDir: string;

function headers(version?: string) {
  const h: Record<string, string> = { "X-API-Key": TEST_API_KEY };
  if (version) h["X-CLI-Version"] = version;
  return h;
}

beforeAll(async () => {
  dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-vc-test-"));
});

afterAll(async () => {
  closeMetaDb();
  if (dataDir) {
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  }
});

describe("version check middleware", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    // Set env BEFORE building app — registerVersionCheck reads config at registration time
    process.env.DATA_DIR = dataDir;
    process.env.BOOTSTRAP_API_KEY = TEST_API_KEY;
    process.env.TEMPLATE_REPO_URL = "https://github.com/example/template.git";
    process.env.MIN_CLI_VERSION = "0.2.0";
    const built = await buildApp();
    app = built.app;
    baseUrl = built.baseUrl;
  });

  afterEach(async () => {
    await app.close();
    delete process.env.MIN_CLI_VERSION;
  });

  it("allows requests with version above min", async () => {
    const res = await fetch(`${baseUrl}/api/test`, { headers: headers("0.3.0") });
    expect(res.status).toBe(200);
  });

  it("allows requests with version equal to min", async () => {
    const res = await fetch(`${baseUrl}/api/test`, { headers: headers("0.2.0") });
    expect(res.status).toBe(200);
  });

  it("rejects requests with version below min", async () => {
    const res = await fetch(`${baseUrl}/api/test`, { headers: headers("0.1.0") });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("localapp update");
  });

  it("rejects requests without X-CLI-Version header", async () => {
    const res = await fetch(`${baseUrl}/api/test`, { headers: headers() });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("CLI version unknown");
  });

  it("bypasses version check for /api/cli/version", async () => {
    const res = await fetch(`${baseUrl}/api/cli/version`, { headers: headers("0.1.0") });
    expect(res.status).toBe(200);
  });

  it("bypasses version check for /api/cli/download", async () => {
    const res = await fetch(`${baseUrl}/api/cli/download?os=windows&arch=x86_64`, {
      headers: headers("0.1.0"),
    });
    // 404 for missing binary, but NOT 403
    expect(res.status).not.toBe(403);
  });
});

describe("version check middleware (no MIN_CLI_VERSION)", () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    process.env.DATA_DIR = dataDir;
    process.env.BOOTSTRAP_API_KEY = TEST_API_KEY;
    process.env.TEMPLATE_REPO_URL = "https://github.com/example/template.git";
    delete process.env.MIN_CLI_VERSION;
    const built = await buildApp();
    app = built.app;
    baseUrl = built.baseUrl;
  });

  afterEach(async () => {
    await app.close();
  });

  it("allows requests without X-CLI-Version header", async () => {
    const res = await fetch(`${baseUrl}/api/test`, { headers: headers() });
    expect(res.status).toBe(200);
  });

  it("allows requests with any version", async () => {
    const res = await fetch(`${baseUrl}/api/test`, { headers: headers("0.0.1") });
    expect(res.status).toBe(200);
  });
});
