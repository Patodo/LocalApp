import Fastify, { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import { storagePlugin } from "../../src/plugins/storage.js";
import { verificationPlugin } from "../../src/plugins/verification.js";
import { authPlugin } from "../../src/plugins/auth.js";
import { sessionPlugin } from "../../src/plugins/session.js";
import { keysRoutes } from "../../src/routes/keys.js";
import { uploadRoutes } from "../../src/routes/upload.js";
import { pagesRoutes } from "../../src/routes/pages.js";
import { serveRoutes } from "../../src/routes/serve.js";
import { myServeRoutes } from "../../src/routes/my-serve.js";
import { schemasRoutes } from "../../src/routes/schemas.js";
import { authRoutes } from "../../src/routes/auth.js";
import { configRoutes } from "../../src/routes/config.js";
import { profileRoutes } from "../../src/routes/profile.js";
import { appSettingsRoutes } from "../../src/routes/app-settings.js";
import { groupsRoutes } from "../../src/routes/groups.js";
import { llmRoutes } from "../../src/routes/llm.js";
import { platformDataRoutes } from "../../src/routes/platform-data.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";
import { adminRoutes } from "../../src/routes/admin.js";
import { favoritesRoutes } from "../../src/routes/favorites.js";
import { subscribeRoutes } from "../../src/routes/subscribe.js";
import { inboxRoutes } from "../../src/routes/inbox.js";
import { desktopActionsRoutes } from "../../src/routes/desktop-actions.js";
import { wsRoutes } from "../../src/routes/ws.js";
import { verificationRoutes } from "../../src/routes/verification.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { initContentStorage } from "../../src/lib/s3-client.js";

const TEST_API_KEY = "test-api-key-1234567890abcdef";

export function getTestApiKey() {
  return TEST_API_KEY;
}

export interface CreateTestServerOptions {
  configToml?: string;
  env?: Record<string, string | undefined>;
  websocket?: boolean;
}

export async function createTestServer(
  options?: CreateTestServerOptions,
): Promise<{ app: FastifyInstance; dataDir: string; stop: () => Promise<void> }> {
  const dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-test-"));

  if (options?.configToml) {
    fs.writeFileSync(path.join(dataDir, "config.toml"), options.configToml, "utf-8");
  }

  // Default env vars
  const env = {
    DATA_DIR: dataDir,
    BOOTSTRAP_API_KEY: TEST_API_KEY,
    TEMPLATE_REPO_URL: "https://github.com/example/template.git",
    GIT_DOWNLOAD_URL: "https://example.com/git-install.exe" as string | undefined,
    JWT_SECRET: "test-jwt-secret-key",
    ADMIN_STATIC_DIR: path.resolve(__dirname, "../../static/admin"),
    ...options?.env,
  };

  // Apply env vars
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const app = Fastify({ ignoreTrailingSlash: true });

  if (options?.websocket) {
    const { default: websocket } = await import("@fastify/websocket");
    await app.register(websocket);
  }

  await app.register(storagePlugin);
  await initContentStorage(app.config);
  await app.register(verificationPlugin);
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  await app.register(sessionPlugin);
  app.register(verificationRoutes);

  app.get("/health", async () => ({ status: "ok" }));
  app.register(authRoutes);
  app.register(profileRoutes);
  app.register(appSettingsRoutes);
  app.register(groupsRoutes);
  app.register(platformDataRoutes);
  app.register(async (llmScope) => {
    await authPlugin(llmScope);
    llmScope.register(llmRoutes);
  });
  app.register(myServeRoutes);
  app.register(serveRoutes);

  app.register(async (authScope) => {
    await authPlugin(authScope);
    authScope.register(keysRoutes);
    authScope.register(configRoutes);
    authScope.register(uploadRoutes);
    authScope.register(pagesRoutes);
    authScope.register(schemasRoutes);
  });

  app.register(adminRoutes);
  app.register(favoritesRoutes);
  app.register(subscribeRoutes);
  app.register(inboxRoutes);
  app.register(desktopActionsRoutes);
  if (options?.websocket) app.register(wsRoutes);

  await app.listen({ port: 0, host: "127.0.0.1" });

  return {
    app,
    dataDir,
    stop: async () => {
      closeMetaDb();
      await app.close();
      await fs.promises.rm(dataDir, { recursive: true, force: true });
    },
  };
}

export function getAppUrl(app: FastifyInstance): string {
  const addresses = app.addresses();
  const addr = addresses[0];
  if (!addr || typeof addr === "string") throw new Error("Server not listening");
  return `http://127.0.0.1:${addr.port}`;
}

export function crudUrl(baseUrl: string, userId: string, pageName: string, resource: string, suffix?: string): string {
  const base = `${baseUrl}/serve/${userId}/${pageName}/api/${resource}`;
  return suffix ? `${base}/${suffix}` : base;
}

/**
 * Create a test user via admin API and set the requested password via force-change.
 * Browser registration is disabled — tests must use this helper instead.
 */
export async function registerUser(baseUrl: string, username: string, password = "test123456"): Promise<void> {
  const apiKey = getTestApiKey();
  const createRes = await fetch(`${baseUrl}/api/admin/users`, {
    method: "POST",
    headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });
  if (!createRes.ok) throw new Error(`Admin create user failed: ${await createRes.text()}`);
  const createBody = await createRes.json();
  const temporaryPassword = createBody.data.credentials.temporaryPassword as string;

  const forceRes = await fetch(`${baseUrl}/api/auth/force-change-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: username, oldPassword: temporaryPassword, newPassword: password }),
  });
  if (!forceRes.ok) throw new Error(`Force change password failed: ${await forceRes.text()}`);
}

export async function createTestPage(
  app: FastifyInstance,
  userId: string,
  pageName: string,
  options?: { pageAccess?: Record<string, unknown> },
): Promise<void> {
  const dataDir = app.config.dataDir;
  const pageDir = path.join(dataDir, userId, pageName);
  fs.mkdirSync(pageDir, { recursive: true });

  const now = new Date().toISOString();
  const meta = {
    name: pageName,
    userId,
    description: "",
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
    versions: [{ version: 1, createdAt: now, fileCount: 1, totalSize: 100 }],
    metadata: {},
    ...(options?.pageAccess ? { pageAccess: options.pageAccess } : {}),
  };
  fs.writeFileSync(path.join(pageDir, "meta.json"), JSON.stringify(meta, null, 2));
}
