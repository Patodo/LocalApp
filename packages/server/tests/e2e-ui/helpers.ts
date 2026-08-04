import { test as base, expect } from "@playwright/test";
import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { storagePlugin } from "../../src/plugins/storage.js";
import { authPlugin } from "../../src/plugins/auth.js";
import { sessionPlugin } from "../../src/plugins/session.js";
import { authRoutes } from "../../src/routes/auth.js";
import { profileRoutes } from "../../src/routes/profile.js";
import { appSettingsRoutes } from "../../src/routes/app-settings.js";
import { myServeRoutes } from "../../src/routes/my-serve.js";
import { adminRoutes } from "../../src/routes/admin.js";
import { serveRoutes } from "../../src/routes/serve.js";
import { keysRoutes } from "../../src/routes/keys.js";
import { uploadRoutes } from "../../src/routes/upload.js";
import { pagesRoutes } from "../../src/routes/pages.js";
import { schemasRoutes } from "../../src/routes/schemas.js";
import { configRoutes } from "../../src/routes/config.js";
import { groupsRoutes } from "../../src/routes/groups.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TEST_API_KEY = "test-ui-api-key-1234567890abcdef";

type TestFixtures = {
  baseUrl: string;
  serverStop: () => Promise<void>;
};

export const test = base.extend<TestFixtures>({
  baseUrl: async ({}, use) => {
    const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-e2e-ui-"));

    const env = {
      DATA_DIR: dataDir,
      BOOTSTRAP_API_KEY: TEST_API_KEY,
      TEMPLATE_REPO_URL: "https://github.com/example/template.git",
      GIT_DOWNLOAD_URL: "https://example.com/git-install.exe",
      JWT_SECRET: "test-jwt-secret-key",
    };
    for (const [k, v] of Object.entries(env)) {
      process.env[k] = v;
    }

    const app: FastifyInstance = Fastify({ ignoreTrailingSlash: true });
    await app.register(storagePlugin);
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
    await app.register(sessionPlugin);

    app.get("/health", async () => ({ status: "ok" }));

    // Serve Next.js static assets (JS/CSS chunks) so React hydration works.
    // Without this, /my/*.html loads but referenced /_next/static/* return 404,
    // and all DOM-dependent tests time out.
    await app.register(fastifyStatic, {
      root: path.resolve(__dirname, "../../../web/out/_next"),
      prefix: "/_next/",
      decorateReply: false,
    });

    app.register(authRoutes);
    app.register(profileRoutes);
    app.register(appSettingsRoutes);
    app.register(myServeRoutes);
    app.register(serveRoutes);

    app.register(async (authScope) => {
      await authPlugin(authScope);
      authScope.register(keysRoutes);
      authScope.register(configRoutes);
      authScope.register(uploadRoutes);
      authScope.register(pagesRoutes);
      authScope.register(schemasRoutes);
      authScope.register(groupsRoutes);
    });

    app.register(adminRoutes);

    await app.listen({ port: 0, host: "127.0.0.1" });

    const addresses = app.addresses();
    const addr = addresses[0];
    const baseUrl = `http://127.0.0.1:${addr.port}`;

    await use(baseUrl);

    await app.close();
    closeMetaDb();
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  },
});

export { expect };

export async function registerUser(baseUrl: string, username: string, password: string = "test123456"): Promise<void> {
  const createRes = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": TEST_API_KEY },
    body: JSON.stringify({ username }),
  });
  if (!createRes.ok) throw new Error(`admin create failed: ${createRes.status}`);
  const createBody = await createRes.json();
  const temporaryPassword = createBody.data.credentials.temporaryPassword as string;

  const changeRes = await fetch(`${baseUrl}/api/auth/force-change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: username, oldPassword: temporaryPassword, newPassword: password }),
  });
  if (!changeRes.ok) throw new Error(`force-change-password failed: ${changeRes.status}`);
}

export async function loginAndGetCookie(baseUrl: string, username: string, password: string = "test123456"): Promise<string> {
  const res = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(`Login failed: ${await res.text()}`);
  const setCookie = res.headers.getSetCookie();
  const tokenCookie = setCookie.find((c) => c.startsWith("token="));
  if (!tokenCookie) throw new Error("No token cookie");
  return tokenCookie.split(";")[0];
}
