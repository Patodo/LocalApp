import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import multipart from "@fastify/multipart";
import cookie from "@fastify/cookie";
import * as path from "node:path";
import { storagePlugin } from "./plugins/storage.js";
import { verificationPlugin } from "./plugins/verification.js";
import { closeAllConnections, closeIdleConnections, isCurrentDbQueueOwner } from "./lib/app-db.js";
import { setDatabaseWriteGuard } from "./lib/app-db.js";
import { authPlugin, registerVersionCheck } from "./plugins/auth.js";
import { sessionPlugin } from "./plugins/session.js";
import { keysRoutes } from "./routes/keys.js";
import { uploadRoutes } from "./routes/upload.js";
import { pagesRoutes } from "./routes/pages.js";
import { serveRoutes } from "./routes/serve.js";
import { schemasRoutes } from "./routes/schemas.js";
import { authenticatedCliRoutes } from "./routes/cli.js";
import { depsRoutes } from "./routes/deps.js";
import { authRoutes } from "./routes/auth.js";
import { profileRoutes } from "./routes/profile.js";
import { appSettingsRoutes } from "./routes/app-settings.js";
import { groupsRoutes } from "./routes/groups.js";
import { configRoutes } from "./routes/config.js";
import { adminRoutes } from "./routes/admin.js";
import { myServeRoutes } from "./routes/my-serve.js";
import { issuesRoutes } from "./routes/issues.js";
import { favoritesRoutes } from "./routes/favorites.js";
import { subscribeRoutes } from "./routes/subscribe.js";
import { inboxRoutes } from "./routes/inbox.js";
import { wsRoutes } from "./routes/ws.js";
import { llmRoutes } from "./routes/llm.js";
import { platformDataRoutes } from "./routes/platform-data.js";
import { dbRoutes } from "./routes/db.js";
import { desktopActionsRoutes } from "./routes/desktop-actions.js";
import { verificationRoutes } from "./routes/verification.js";
import { cleanOldLogs } from "./lib/meta-sqlite.js";
import { startRequestLogger, stopRequestLogger, pushRequestLog } from "./lib/request-logger.js";
import { initContentStorage } from "./lib/s3-client.js";
import { applyPlatformMigrationsToAllApps } from "./lib/platform-migrations.js";
import { assertAppDataWritable } from "./lib/app-data-maintenance.js";

async function main() {
  const app: FastifyInstance = Fastify({ ignoreTrailingSlash: true });

  // WebSocket 总线（在 storage 之前注册，需要 storage 提供的 config）
  const { default: websocket } = await import("@fastify/websocket");
  await app.register(websocket);

  // storagePlugin loads config (env > config.toml > defaults) and decorates app.config
  await app.register(storagePlugin);
  setDatabaseWriteGuard((dbPath) => assertAppDataWritable(path.dirname(dbPath), isCurrentDbQueueOwner(dbPath)));
  await initContentStorage(app.config);
  await app.register(verificationPlugin);
  await applyPlatformMigrationsToAllApps({ dataDir: app.config.dataDir, logger: console });

  const port = app.config.port;

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });

  await app.register(sessionPlugin);

  // Short-lived production-path verification sessions (owner API key + one-time browser token).
  app.register(verificationRoutes);

  app.get("/health", async () => ({ status: "ok" }));

  // Serve Next.js static export (auth pages, _next assets)
  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, "../../web/out/_next"),
    prefix: "/_next",
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: path.resolve(__dirname, "../../web/out/home"),
    prefix: "/home",
    decorateReply: false,
  });

  // Auth routes (no auth required)
  app.register(authRoutes);

  // Profile routes (session auth, no API Key, no version check)
  app.register(profileRoutes);
  app.register(appSettingsRoutes);

  // Group routes (session + API Key auth, no version check)
  app.register(groupsRoutes);

  // Platform data routes (API Key auth, read-only)
  app.register(platformDataRoutes);

  // LLM proxy route (session auth, no version check)
  app.register(async (llmScope) => {
    await authPlugin(llmScope);
    llmScope.register(llmRoutes);
  });

  // Issue routes (session auth, no API Key) — before serve so /api/issues doesn't match /:userId/:name
  app.register(issuesRoutes);

  // Favorite routes (session auth for write, public for count/check)
  app.register(favoritesRoutes);

  // Subscription routes (session auth, /api/subscriptions*)
  app.register(subscribeRoutes);

  // Inbox routes (session auth, /api/inbox*)
  app.register(inboxRoutes);

  // WebSocket 消息总线（Authorization Bearer api_key，仅 daemon）
  app.register(wsRoutes);

  // Desktop action claim/status/SSE/capability APIs
  app.register(desktopActionsRoutes);

  // Dashboard serve routes /my/* (before serve to take priority over /:userId/:name)
  app.register(myServeRoutes);

  // Public routes (no auth) — serve includes CRUD under /serve/{uid}/{pid}/api/*
  app.register(serveRoutes);

  // CLI release routes (API key or authenticated session)
  app.register(authenticatedCliRoutes);

  // Public dependency installers (optional — 404 if not hosted)
  app.register(depsRoutes);

  // Business routes (auth + version check)
  app.register(async (authScope) => {
    await authPlugin(authScope);
    registerVersionCheck(authScope);
    authScope.register(keysRoutes);
    authScope.register(configRoutes);
    authScope.register(uploadRoutes);
    authScope.register(dbRoutes);
    authScope.register(pagesRoutes);
    authScope.register(schemasRoutes);
  });

  // Admin routes (admin role required, no version check)
  app.register(adminRoutes);

  // Request logging: record /api/* and /serve/*/api/* requests
  app.addHook("onResponse", async (req, reply) => {
    const url = req.routeOptions?.url ?? req.url;
    if (url.startsWith("/api/") || url.includes("/api/")) {
      pushRequestLog({
        path: req.url.split("?")[0],
        method: req.method,
        status: reply.statusCode,
        durationMs: reply.elapsedTime ? Math.round(reply.elapsedTime) : 0,
        userId: req.userId || null,
        visitorId: req.visitorId || null,
      });
    }
  });

  app.addHook("onClose", async () => {
    stopRequestLogger();
    closeAllConnections();
  });

  await app.listen({ port, host: "0.0.0.0" });
  console.log(`LocalApp server listening on port ${port}`);

  startRequestLogger();
  cleanOldLogs();
  setInterval(closeIdleConnections, 60_000);

}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
