import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getPageDir, readPageMeta, readDbConfig } from "../plugins/storage.js";
import { pushPageView } from "../lib/request-logger.js";
import {
  matchAppApiRoute,
  loadBackendContract,
  loadDefaultBackendContract,
  classifyAppRuntimeError,
  createAppNamedSqlRuntime,
  executeNamedSql,
  LocalAppRuntimeError,
  execRawSql,
  getDbPath,
  runDbTransaction,
  type AppApiRoute,
} from "../lib/app-db.js";
import { checkPageAccess, checkNotifyPermission } from "../lib/access-control.js";
import type { VisitorContext } from "../lib/record-access.js";
import { handleContentUpload, handleContentRead } from "./content.js";
import { listUsers, validateApiKey, findUserById } from "../lib/meta-sqlite.js";
import { shouldRegisterNotify } from "../lib/notify-policy.js";
import { validateNotifyPayload } from "../lib/notify-payload.js";
import { validateReferer } from "../lib/notify-referer.js";
import { getNotifyRateLimiter } from "../lib/notify-rate-limit.js";
import { resolveRecipients, persistNotifications } from "../lib/notifications-db.js";
import { handleDesktopActionCreation } from "./desktop-actions.js";
import { handleDeviceActionCreation } from "./device-actions.js";
import {
  VERIFICATION_APP_COOKIE,
  VERIFICATION_ME_COOKIE,
  VERIFICATION_SHELL_COOKIE,
  type VerificationCheck,
  type VerificationSessionContext,
} from "../lib/verification-sessions.js";
import { isAppOffline } from "../lib/app-lifecycle.js";

declare module "fastify" {
  interface FastifyRequest {
    verificationSession?: VerificationSessionContext | null;
  }
}

const HTML_404 = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;margin:0;font-family:system-ui;background:#f8f9fa"><div style="text-align:center"><h1 style="font-size:2rem;color:#1a1d23">404</h1><p style="color:#6b7280">Page not found.</p><a href="/" style="color:#2563eb">Back to home</a></div></body></html>`;

const CSP_HEADER = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'";

type CollaborationSseClient = {
  userId: string;
  pageName: string;
  resource: string | null;
  write: (event: unknown) => void;
};

const collaborationSseClients = new Set<CollaborationSseClient>();

type PresenceSseClient = {
  appOwner: string;
  appName: string;
  visitorKey: string;
  visitor: { id: string; name: string; displayName: string | null; avatarUrl: string | null } | null;
  canViewIdentities: boolean;
  write: (event: unknown) => void;
};

const presenceSseClients = new Set<PresenceSseClient>();
type PresenceVisitor = NonNullable<PresenceSseClient["visitor"]>;
type PresenceLease = {
  appOwner: string;
  appName: string;
  visitorKey: string;
  visitor: PresenceVisitor | null;
  expiresAt: number;
};

const PRESENCE_LEASE_TTL_MS = 120_000;
const presenceLeases = new Map<string, PresenceLease>();

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".eot": "application/vnd.ms-fontobject",
    ".webp": "image/webp",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
  };
  return mimeMap[ext] || "application/octet-stream";
}

function buildServerTime(now: string): { now: string; today: string } {
  return {
    now,
    today: now.slice(0, 10),
  };
}

function sendOfflineAppError(reply: FastifyReply) {
  reply.header("Cache-Control", "no-store");
  return reply.status(503).send({
    success: false,
    code: "APP_OFFLINE",
    error: "Application is offline",
  });
}

export async function serveRoutes(app: FastifyInstance, options: { webRoot?: string } = {}) {
  const webOutDir = options.webRoot ?? path.resolve(__dirname, "../../../web/out");
  const dataDir = () => app.config.dataDir;

  // Serve Next.js HTML pages for auth routes
  function serveNextHtml(page: string) {
    const filePath = path.join(webOutDir, `${page}.html`);
    return async (_req: FastifyRequest, reply: FastifyReply) => {
      try {
        const html = fs.readFileSync(filePath, "utf-8");
        reply.type("text/html").send(html);
      } catch {
        reply.status(404).send({ success: false, error: "Page not found" });
      }
    };
  }

  app.get("/", serveNextHtml("index"));

  app.get("/setup", async (_req, reply) => {
    if (listUsers(1, 1).total !== 0) return reply.status(404).type("text/html").send(HTML_404);
    return serveNextHtml("setup")(_req, reply);
  });

  app.get("/setup.txt", async (_req, reply) => {
    if (listUsers(1, 1).total !== 0) return reply.status(404).send("");
    try {
      return reply.type("text/plain; charset=utf-8").send(fs.readFileSync(path.join(webOutDir, "setup.txt"), "utf-8"));
    } catch {
      return reply.status(404).send("");
    }
  });

  app.get("/api/home/stats", async () => {
    let totalPages = 0;
    let totalSchemas = 0;
    let totalDeploys = 0;
    let monthDeploys = 0;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    if (fs.existsSync(dataDir())) {
      const userDirs = fs.readdirSync(dataDir(), { withFileTypes: true });
      for (const userDir of userDirs) {
        if (!userDir.isDirectory()) continue;
        const userPath = path.join(dataDir(), userDir.name);
        const pageDirs = fs.readdirSync(userPath, { withFileTypes: true });
        for (const pageDir of pageDirs) {
          if (!pageDir.isDirectory()) continue;
          const meta = readPageMeta(dataDir(), userDir.name, pageDir.name);
          if (!meta) continue;

          totalPages += 1;
          totalSchemas += meta.schemas?.length ?? 0;
          totalDeploys += meta.versions.length;
          for (const version of meta.versions) {
            const createdAt = new Date(version.createdAt);
            if (!Number.isNaN(createdAt.getTime()) && createdAt >= monthStart) {
              monthDeploys += 1;
            }
          }
        }
      }
    }

    return {
      success: true,
      data: {
        users: listUsers(1, 1).total,
        pages: totalPages,
        schemas: totalSchemas,
        deploys: totalDeploys,
        monthDeploys,
      },
    };
  });

  // Production app entry: PlatformShell from Next.js static export.
  // Raw uploaded app resources remain under /serve/:userId/:name/*.
  app.get<{ Params: { userId: string; name: string } }>(
    "/:userId/:name",
    async (req, reply) => {
      const { userId, name } = req.params;
      const meta = readPageMeta(dataDir(), userId, name);

      if (!meta) {
        return reply.status(404).type("text/html").send(HTML_404);
      }
      const verification = resolveVerification(app, req, userId, name, VERIFICATION_SHELL_COOKIE);
      const visitorId = verification?.actorId ?? req.visitorId;
      if (!verification && !checkPageAccess(meta.pageAccess, visitorId, meta.userId)) {
        if (!visitorId) return reply.status(401).send({ success: false, error: "Authentication required" });
        return reply.status(403).send({ success: false, error: "Access denied" });
      }

      pushPageView({ pagePath: `/${userId}/${name}`, visitorId: visitorId || null, userId: verification ? null : (req.visitorId || req.userId || null) });

      // Serve Next.js static React platform shell with actual params injected.
      try {
        let html = fs.readFileSync(path.join(webOutDir, "platform-shell/placeholder/placeholder.html"), "utf-8");
        // Replace static placeholder params with actual values in RSC payload
        html = html
          .replace(/\\"platform-shell\\",\\"placeholder\\",\\"placeholder\\"/g, `\\"platform-shell\\",\\"${userId}\\",\\"${name}\\"`)
          .replace(/\[\\"userId\\",\\"placeholder\\"/g, `[\\"userId\\",\\"${userId}\\"`)
          .replace(/\[\\"name\\",\\"placeholder\\"/g, `[\\"name\\",\\"${name}\\"`);
        html = injectNativeShellMetadata(html, userId, name);
        reply.type("text/html").send(html);
      } catch {
        reply.status(404).send({ success: false, error: "Shell not built. Run build:web first." });
      }
    }
  );

  // Raw app resource entry for /serve/:userId/:name (no trailing slash)
  // With ignoreTrailingSlash, this also handles the trailing-slash case via the wildcard route below.
  // This specific route is needed because /serve/:userId/:name without /* won't match the wildcard.
  app.get<{ Params: { userId: string; name: string } }>(
    "/serve/:userId/:name",
    async (req, reply) => {
      const { userId, name } = req.params;

      const meta = readPageMeta(dataDir(), userId, name);
      if (!meta) return reply.status(404).send({ success: false, error: "Page not found" });
      if (isAppOffline(meta)) return sendOfflineAppError(reply);

      // Redirect /serve/:userId/:name → /serve/:userId/:name/ to ensure correct
      // relative asset resolution in browsers (e.g. ./assets/app.js).
      const urlPath = req.url.split("?")[0];
      if (!urlPath.endsWith("/")) {
        const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
        return reply.redirect(301, `/serve/${userId}/${name}/${qs}`);
      }

      const verification = resolveVerification(app, req, userId, name, VERIFICATION_APP_COOKIE);
      const visitorId = verification?.actorId ?? req.visitorId;
      if (!verification && !checkPageAccess(meta.pageAccess, visitorId, meta.userId)) {
        if (!visitorId) return reply.status(401).send({ success: false, error: "Authentication required" });
        return reply.status(403).send({ success: false, error: "Access denied" });
      }

      const version = verification?.version ?? meta.currentVersion;
      const versionDir = path.join(getPageDir(dataDir(), userId, name), "versions", `v${version}`);
      const indexPath = path.join(versionDir, "index.html");
      if (fs.existsSync(indexPath)) {
        reply.header("Content-Security-Policy", CSP_HEADER);
        return reply.type("text/html").send(fs.readFileSync(indexPath));
      }
      return reply.status(404).send({ success: false, error: "index.html not found" });
    },
  );

  // Combined static file serving + CRUD API
  app.all<{ Params: { userId: string; name: string; wildcard: string } }>(
    "/serve/:userId/:name/*",
    { bodyLimit: 2 * 1024 * 1024 },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const urlParts = req.url.split("?");
      const pathParts = urlParts[0].split("/");
      const userId = pathParts[2];
      const pageName = pathParts[3];
      const restPath = pathParts.slice(4).join("/");

      const meta = readPageMeta(dataDir(), userId, pageName);
      if (!meta) {
        return reply.status(404).send({ success: false, error: "Page not found" });
      }
      if (isAppOffline(meta)) return sendOfflineAppError(reply);

      req.verificationSession = resolveVerification(app, req, userId, pageName, VERIFICATION_APP_COOKIE);
      const isDesktopActionCreation = restPath === "api/desktop-actions" && req.method === "POST";
      const isDeviceActionCreation = restPath === "api/device-actions" && req.method === "POST";
      const actionApiKey = isDesktopActionCreation || isDeviceActionCreation ? req.headers["x-api-key"] : undefined;
      const pageVisitorId = req.verificationSession?.actorId ?? (typeof actionApiKey === "string"
        ? validateApiKey(actionApiKey)
        : req.visitorId);

      // Page-level access control
      if (!req.verificationSession && !checkPageAccess(meta.pageAccess, pageVisitorId, meta.userId)) {
        if (!pageVisitorId) return reply.status(401).send({ success: false, error: "Authentication required" });
        return reply.status(403).send({ success: false, error: "Access denied" });
      }

      // CRUD API routes: /serve/{userId}/{name}/api/{resource}[/:id][/count]
      if (restPath.startsWith("api/")) {
        if (restPath === "api/_verification/report" && req.method === "POST") {
          return handleVerificationReport(app, req, reply, userId, pageName);
        }

        if (req.verificationSession && (isDesktopActionCreation || isDeviceActionCreation || restPath === "api/notify")) {
          return reply.status(409).send({
            success: false,
            error: "This platform side effect is disabled during isolated verification",
            code: "verification_side_effect_blocked",
          });
        }

        if (isDesktopActionCreation) {
          return handleDesktopActionCreation(req, reply, meta, userId, pageName);
        }
        if (isDeviceActionCreation) {
          return handleDeviceActionCreation(req, reply, meta, userId, pageName);
        }

        const appRoute = matchAppApiRoute(req.method, restPath.slice("api".length));

        if (appRoute.kind === "time") {
          return { success: true, data: buildServerTime(req.devNow ?? new Date().toISOString()) };
        }

        if (restPath === "api/collaboration/commit" && req.method === "POST") {
          return handleCollaborationCommit(req, reply, dataDir(), userId, pageName);
        }

        if (restPath === "api/collaboration/events" && req.method === "GET") {
          return handleCollaborationEvents(req, reply, dataDir(), userId, pageName);
        }

        if (restPath === "api/presence/events" && req.method === "GET") {
          return handlePresenceEvents(req, reply, userId, pageName);
        }

        if (restPath === "api/presence/heartbeat" && req.method === "POST") {
          return handlePresenceLeaseMutation(req, reply, userId, pageName, "heartbeat");
        }

        if (restPath === "api/presence/leave" && req.method === "POST") {
          return handlePresenceLeaseMutation(req, reply, userId, pageName, "leave");
        }

        if (appRoute.kind === "action") {
          return handleActionRequest(req, reply, dataDir(), userId, pageName, appRoute.name);
        }

        // Content upload/read routes: /serve/{userId}/{name}/api/content/upload|{key}
        if (appRoute.kind === "content-upload") {
          return handleContentUpload(req, reply, userId, pageName, getPageDir(dataDir(), userId, pageName));
        }
        if (appRoute.kind === "content-read") {
          return handleContentRead(req, reply, userId, pageName, appRoute.key);
        }

        // Notify endpoint: POST /serve/{userId}/{name}/api/notify
        // 端点存在性由 manifest.notify.enabled 控制；不存在时回落到 CRUD（最终 404）。
        if (restPath === "api/notify" && req.method === "POST" && shouldRegisterNotify(meta)) {
          const rateLimit = getNotifyRateLimiter().check(`${userId}/${pageName}`);
          if (!rateLimit.allowed) {
            reply.header("Retry-After", String(rateLimit.retryAfterSec));
            return reply.status(429).send({ success: false, error: "Rate limit exceeded. Try again later." });
          }
          const refererError = validateReferer(
            req.headers.referer as string | undefined,
            req.hostname,
            userId,
            pageName,
          );
          if (refererError) {
            return reply.status(403).send({ success: false, error: refererError });
          }
          const perm = await checkNotifyPermission(
            req.visitorId,
            meta.userId,
            getPageDir(dataDir(), userId, pageName),
            meta.notify?.permission,
          );
          if (perm.status !== 200) {
            return reply.status(perm.status).send({ success: false, error: perm.error });
          }
          const payloadResult = validateNotifyPayload(req.body);
          if (!payloadResult.ok) {
            return reply.status(400).send({ success: false, error: payloadResult.error });
          }
          const payload = payloadResult.payload;
          const recipients = resolveRecipients(userId, pageName, payload.to);
          const records = recipients.map((uid) => ({
            id: "",
            userId: uid,
            appOwner: userId,
            appName: pageName,
            title: payload.title,
            body: payload.body,
            url: payload.url,
            priority: payload.priority,
            data: payload.data,
          }));
          const persisted = persistNotifications(records);
          return {
            success: true,
            delivered: persisted.length,
            ids: persisted.map((p) => p.id),
          };
        }

        return handleCrudRequest(req, reply, dataDir(), userId, pageName, restPath, appRoute);
      }

      // Static file serving
      const version = req.verificationSession?.version ?? meta.currentVersion;
      const versionDir = path.join(getPageDir(dataDir(), userId, pageName), "versions", `v${version}`);

      if (restPath === ".localapp" || restPath.startsWith(".localapp/")) {
        return reply.status(404).send({ success: false, error: "File not found" });
      }

      let filePath = path.join(versionDir, restPath || "index.html");
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        reply.header("Content-Security-Policy", CSP_HEADER);
        return reply.type(getMimeType(filePath)).send(fs.readFileSync(filePath));
      }

      // SPA fallback: if not a static asset (no extension), serve index.html
      const indexPath = path.join(versionDir, "index.html");
      if (fs.existsSync(indexPath) && !restPath.includes(".")) {
        reply.header("Content-Security-Policy", CSP_HEADER);
        return reply.type("text/html").send(fs.readFileSync(indexPath));
      }

      return reply.status(404).send({ success: false, error: "File not found" });
    }
  );
}

function injectNativeShellMetadata(html: string, userId: string, name: string): string {
  const resourceBase = `/serve/${userId}/${name}/`;
  const marker = [
    `<template data-localapp-native-shell="true"`,
    ` data-localapp-app-root="root"`,
    ` data-localapp-app-resource-base="${escapeHtmlAttr(resourceBase)}"></template>`,
  ].join("");
  if (html.includes("data-localapp-native-shell")) return html;
  return html.replace("</body>", `${marker}</body>`);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handleCrudRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  dataDir: string,
  userId: string,
  pageName: string,
  restPath: string,
  appRoute = matchAppApiRoute(req.method, restPath.slice("api".length)),
) {
  // Page-level schemas endpoint: api/_schemas
  if (appRoute.kind === "schemas") {
    const meta = readPageMeta(dataDir, userId, pageName);
    if (!meta) return reply.status(404).send({ success: false, error: "Page not found" });
    const schemas = (meta.schemas ?? []).map((s) => ({
      name: s.name,
      fields: s.fields,
      business: s.business,
      routeAccess: s.routeAccess,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
    return { success: true, data: schemas };
  }

  if (appRoute.kind === "named-query" || appRoute.kind === "named-mutation" || appRoute.kind === "named-mutation-transaction") {
    const pageDir = getPageDir(dataDir, userId, pageName);
    const meta = readPageMeta(dataDir, userId, pageName);
    const contractDir = meta
      ? path.join(pageDir, "versions", `v${req.verificationSession?.version ?? meta.currentVersion}`)
      : pageDir;
    const visitor = visitorFromReq(req);
    try {
      let contract;
      try {
        contract = meta?.backend
          ? loadBackendContract(contractDir, meta.backend, { allowDisabledHostedActions: true })
          : loadDefaultBackendContract(contractDir, { allowDisabledHostedActions: true });
      } catch (err: any) {
        if (!/backend root does not exist/i.test(err?.message ?? "")) throw err;
        contract = meta?.backend
          ? loadBackendContract(pageDir, meta.backend, { allowDisabledHostedActions: true })
          : loadDefaultBackendContract(pageDir, { allowDisabledHostedActions: true });
      }
      const runtime = createAppNamedSqlRuntime({
        contract,
        dbPath: req.verificationSession?.databasePath ?? pageDir,
        context: () => ({
          visitorId: visitor.id,
          ownerId: userId,
          now: new Date(req.devNow ?? Date.now()),
        }),
      });
      const result = await runtime.execute(appRoute, req.body);
      return { success: true, data: result };
    } catch (err: unknown) {
      const response = classifyAppRuntimeError(err, visitor.id !== null);
      return reply.status(response.status).send(response.body);
    }
  }

  // 其余平台辅助端点（time/me/users/groups等）由上层 wildcard 处理器分流；
  // 未识别路径统一返回 404。REST CRUD / transitions / db-exec / legacy-upload
  // 已由 restrict-app-api-to-named-sql 变更移除，应用层数据通道现由 named SQL 唯一承担。
  return reply.status(404).send({ success: false, error: "Not found" });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureCollaborationTables(dbPath: string): void {
  execRawSql(dbPath, `
    CREATE TABLE IF NOT EXISTS _localapp_record_revisions (
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      resource TEXT NOT NULL,
      record_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (app_owner, app_name, resource, record_id)
    )
  `);
  execRawSql(dbPath, `
    CREATE TABLE IF NOT EXISTS _localapp_operation_log (
      id TEXT PRIMARY KEY,
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      resource TEXT NOT NULL,
      record_id TEXT NOT NULL,
      actor_id TEXT,
      operation_id TEXT NOT NULL,
      operation_kind TEXT,
      base_revision INTEGER NOT NULL,
      next_revision INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);
}

function readRecordRevision(dbPath: string, userId: string, pageName: string, resource: string, recordId: string): number {
  const rows = execRawSql(
    dbPath,
    "SELECT revision FROM _localapp_record_revisions WHERE app_owner = ? AND app_name = ? AND resource = ? AND record_id = ?",
    [userId, pageName, resource, recordId],
  ).rows ?? [];
  const value = rows[0]?.revision;
  return typeof value === "number" ? value : 0;
}

function publishCollaborationCommitted(event: {
  type: "collab:operation_committed";
  data: {
    appOwner: string;
    appName: string;
    resource: string;
    recordId: string;
    revision: number;
    actorId: string | null;
    operationId: string;
    patch?: Record<string, unknown>;
  };
}): void {
  for (const client of collaborationSseClients) {
    if (client.userId !== event.data.appOwner || client.pageName !== event.data.appName) continue;
    if (client.resource && client.resource !== event.data.resource) continue;
    client.write(event);
  }
}

async function handleCollaborationEvents(
  req: FastifyRequest,
  reply: FastifyReply,
  dataDir: string,
  userId: string,
  pageName: string,
) {
  const meta = readPageMeta(dataDir, userId, pageName);
  if (!meta?.collaboration?.enabled) {
    return reply.status(404).send({ success: false, error: "Collaboration is not enabled" });
  }

  const url = new URL(req.url, "http://localhost");
  const resource = url.searchParams.get("resource");
  const client: CollaborationSseClient = {
    userId,
    pageName,
    resource: resource?.trim() || null,
    write: (event) => {
      reply.raw.write(`event: collab:operation_committed\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    },
  };

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  reply.raw.write(": connected\n\n");
  collaborationSseClients.add(client);
  req.raw.on("close", () => {
    collaborationSseClients.delete(client);
  });
  reply.hijack();
}

function publishPresenceSnapshot(appOwner: string, appName: string): void {
  pruneExpiredPresenceLeases();
  const authenticatedUsers = new Map<string, NonNullable<PresenceSseClient["visitor"]>>();
  const anonymousKeys = new Set<string>();
  for (const lease of presenceLeases.values()) {
    if (lease.appOwner !== appOwner || lease.appName !== appName) continue;
    if (lease.visitor) authenticatedUsers.set(lease.visitor.id, lease.visitor);
    else anonymousKeys.add(lease.visitorKey);
  }
  for (const client of presenceSseClients) {
    if (client.appOwner !== appOwner || client.appName !== appName) continue;
    client.write({
      type: "presence:snapshot",
      data: {
        appOwner,
        appName,
        count: authenticatedUsers.size + anonymousKeys.size,
        anonymousCount: anonymousKeys.size,
        authenticatedUsers: client.canViewIdentities ? [...authenticatedUsers.values()] : [],
      },
    });
  }
}

function normalizePresenceClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clientId = value.trim();
  return /^[A-Za-z0-9_-]{1,100}$/.test(clientId) ? clientId : null;
}

function pruneExpiredPresenceLeases(now = Date.now()): void {
  for (const [key, lease] of presenceLeases) {
    if (lease.expiresAt <= now) presenceLeases.delete(key);
  }
}

function resolvePresenceLease(
  req: FastifyRequest,
  appOwner: string,
  appName: string,
  clientId: string,
): { key: string; lease: PresenceLease } {
  const visitor = visitorFromReq(req);
  const user = visitor.id ? findUserById(visitor.id) : null;
  const visitorDetails = visitor.id ? {
    id: visitor.id,
    name: user?.name ?? visitor.name ?? visitor.id,
    displayName: user?.displayName ?? null,
    avatarUrl: user?.avatarUrl ?? null,
  } : null;
  const visitorKey = visitor.id ? `user:${visitor.id}:${clientId}` : `anon:${clientId}`;
  return {
    key: `${appOwner}\u0000${appName}\u0000${visitorKey}`,
    lease: {
      appOwner,
      appName,
      visitorKey,
      visitor: visitorDetails,
      expiresAt: Date.now() + PRESENCE_LEASE_TTL_MS,
    },
  };
}

function handlePresenceLeaseMutation(
  req: FastifyRequest,
  reply: FastifyReply,
  appOwner: string,
  appName: string,
  action: "heartbeat" | "leave",
) {
  const clientId = normalizePresenceClientId(isRecord(req.body) ? req.body.clientId : null);
  if (!clientId) {
    return reply.status(400).send({ success: false, code: "PRESENCE_CLIENT_ID_INVALID", error: "Valid clientId is required" });
  }
  pruneExpiredPresenceLeases();
  const resolved = resolvePresenceLease(req, appOwner, appName, clientId);
  if (action === "heartbeat") presenceLeases.set(resolved.key, resolved.lease);
  else presenceLeases.delete(resolved.key);
  publishPresenceSnapshot(appOwner, appName);
  return { success: true, data: { status: action === "heartbeat" ? "online" : "offline" } };
}

async function handlePresenceEvents(
  req: FastifyRequest,
  reply: FastifyReply,
  userId: string,
  pageName: string,
) {
  const requestedClientId = normalizePresenceClientId((req.query as { clientId?: unknown } | undefined)?.clientId);
  const clientId = requestedClientId ?? crypto.randomUUID();
  const resolved = resolvePresenceLease(req, userId, pageName, clientId);
  const client: PresenceSseClient = {
    appOwner: userId,
    appName: pageName,
    visitorKey: resolved.lease.visitorKey,
    visitor: resolved.lease.visitor,
    canViewIdentities: resolved.lease.visitor !== null,
    write: (event) => {
      reply.raw.write("event: presence:snapshot\n");
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    },
  };

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  presenceLeases.set(resolved.key, resolved.lease);
  presenceSseClients.add(client);
  publishPresenceSnapshot(userId, pageName);
  req.raw.on("close", () => {
    presenceSseClients.delete(client);
    publishPresenceSnapshot(userId, pageName);
  });
  reply.hijack();
}

async function handleCollaborationCommit(
  req: FastifyRequest,
  reply: FastifyReply,
  dataDir: string,
  userId: string,
  pageName: string,
) {
  if (!isRecord(req.body)) {
    return reply.status(400).send({ success: false, error: "Collaboration commit body must be an object" });
  }
  if ("sql" in req.body) {
    return reply.status(400).send({ success: false, error: "Client SQL is not allowed in collaboration commits" });
  }

  const resource = typeof req.body.resource === "string" ? req.body.resource : "";
  const recordId = typeof req.body.recordId === "string" ? req.body.recordId : "";
  const baseRevision = typeof req.body.baseRevision === "number" ? req.body.baseRevision : NaN;
  const params = isRecord(req.body.params) ? req.body.params : undefined;
  if (!resource || !recordId || !Number.isInteger(baseRevision) || baseRevision < 0 || !params) {
    return reply.status(400).send({ success: false, error: "Collaboration commit requires resource, recordId, baseRevision and params" });
  }

  const meta = readPageMeta(dataDir, userId, pageName);
  const collaborationResource = meta?.collaboration?.enabled ? meta.collaboration.resources?.[resource] : undefined;
  if (!collaborationResource) {
    return reply.status(403).send({ success: false, error: `Collaboration resource is not declared: ${resource}` });
  }

  const pageDir = getPageDir(dataDir, userId, pageName);
  const contractDir = meta
    ? path.join(pageDir, "versions", `v${req.verificationSession?.version ?? meta.currentVersion}`)
    : pageDir;
  const contract = meta?.backend
    ? loadBackendContract(contractDir, meta.backend, { allowDisabledHostedActions: true })
    : loadDefaultBackendContract(contractDir, { allowDisabledHostedActions: true });
  if (!contract.mutations[collaborationResource.mutation]) {
    return reply.status(400).send({
      success: false,
      error: `Collaboration mutation is not declared in backend contract: ${collaborationResource.mutation}`,
    });
  }

  const dbPath = req.verificationSession?.databasePath ?? getDbPath(pageDir);
  const visitor = visitorFromReq(req);
  const actorId = visitor.id;
  const operationId = typeof req.body.operationId === "string" && req.body.operationId.trim()
    ? req.body.operationId
    : crypto.randomUUID();
  const operationKind = typeof req.body.operationKind === "string" ? req.body.operationKind : "save";
  const now = new Date().toISOString();

  try {
    const result = await runDbTransaction(dbPath, async () => {
      ensureCollaborationTables(dbPath);
      const currentRevision = readRecordRevision(dbPath, userId, pageName, resource, recordId);
      if (currentRevision !== baseRevision) {
        const conflict = new Error("revision_conflict") as Error & { code?: string; serverRevision?: number };
        conflict.code = "revision_conflict";
        conflict.serverRevision = currentRevision;
        throw conflict;
      }

      const mutationResult = await executeNamedSql(contract, {
        kind: "mutation",
        name: collaborationResource.mutation,
        dbPath,
        body: { params },
        context: {
          visitorId: actorId,
          ownerId: userId,
          now: new Date(now),
        },
        queue: { bypass: true },
      });

      const nextRevision = currentRevision + 1;
      execRawSql(
        dbPath,
        `INSERT INTO _localapp_record_revisions
          (app_owner, app_name, resource, record_id, revision, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_owner, app_name, resource, record_id)
         DO UPDATE SET revision = excluded.revision, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        [userId, pageName, resource, recordId, nextRevision, actorId, now],
      );
      execRawSql(
        dbPath,
        `INSERT INTO _localapp_operation_log
          (id, app_owner, app_name, resource, record_id, actor_id, operation_id, operation_kind, base_revision, next_revision, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          crypto.randomUUID(),
          userId,
          pageName,
          resource,
          recordId,
          actorId,
          operationId,
          operationKind,
          baseRevision,
          nextRevision,
          JSON.stringify({ params }),
          now,
        ],
      );

      return { revision: nextRevision, operationId, mutation: mutationResult };
    });

    publishCollaborationCommitted({
      type: "collab:operation_committed",
      data: {
        appOwner: userId,
        appName: pageName,
        resource,
        recordId,
        revision: result.revision,
        actorId,
        operationId,
        patch: params,
      },
    });

    return { success: true, data: result };
  } catch (err: any) {
    if (err?.code === "revision_conflict") {
      return reply.status(409).send({
        success: false,
        code: "revision_conflict",
        error: "Revision conflict",
        data: { serverRevision: err.serverRevision },
      });
    }
    const message = err?.message ?? "Collaboration commit failed";
    if (err instanceof LocalAppRuntimeError) {
      return reply.status(err.status).send({ success: false, error: message, code: err.code });
    }
    if (/access denied/i.test(message)) {
      if (!actorId) return reply.status(401).send({ success: false, error: "Authentication required" });
      return reply.status(403).send({ success: false, error: message });
    }
    return reply.status(400).send({ success: false, error: message });
  }
}

async function handleActionRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  dataDir: string,
  userId: string,
  pageName: string,
  actionName: string,
) {
  const pageDir = getPageDir(dataDir, userId, pageName);
  const meta = readPageMeta(dataDir, userId, pageName);
  if (!meta) return reply.status(404).send({ success: false, error: "Page not found" });

  return reply.status(410).send({
    success: false,
    error: "Hosted backend actions are disabled. Use named SQL, transaction mutation, or a platform primitive instead.",
    code: "hosted_actions_disabled",
  });
}

function visitorFromReq(req: FastifyRequest): VisitorContext {
  if (req.verificationSession) {
    return { id: req.verificationSession.actorId, name: req.verificationSession.actorName };
  }
  if (req.visitorId) {
    return { id: req.visitorId, name: req.visitorName ?? null };
  }
  // /serve 路径不挂 authPlugin；API Key 用户在此解析为 visitor 身份
  const apiKey = req.headers["x-api-key"] as string | undefined;
  if (apiKey) {
    const userId = validateApiKey(apiKey);
    if (userId) {
      const user = findUserById(userId);
      return { id: userId, name: user?.name ?? null };
    }
  }
  return { id: null, name: null };
}

function resolveVerification(
  app: FastifyInstance,
  req: FastifyRequest,
  owner: string,
  appName: string,
  cookieName: string,
): VerificationSessionContext | null {
  return app.verificationSessions?.resolve(req.cookies?.[cookieName], owner, appName) ?? null;
}

async function handleVerificationReport(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  owner: string,
  appName: string,
) {
  const context = req.verificationSession;
  if (!context || context.owner !== owner || context.app !== appName) {
    return reply.status(401).send({ success: false, error: "Active verification session required" });
  }
  const body = req.body as { status?: unknown; checks?: unknown } | undefined;
  if (!body || !["passed", "failed"].includes(String(body.status)) || !Array.isArray(body.checks)) {
    return reply.status(400).send({ success: false, error: "status and checks are required" });
  }
  const checks = body.checks.filter(isVerificationCheck);
  if (checks.length !== body.checks.length) {
    return reply.status(400).send({ success: false, error: "Invalid verification check" });
  }
  app.verificationSessions.report(context, {
    status: body.status as "passed" | "failed",
    checks,
  });
  reply.clearCookie(VERIFICATION_SHELL_COOKIE, { path: `/${owner}/${appName}` });
  reply.clearCookie(VERIFICATION_APP_COOKIE, { path: `/serve/${owner}/${appName}` });
  reply.clearCookie(VERIFICATION_ME_COOKIE, { path: "/api/me" });
  return { success: true, data: { id: context.id, status: body.status } };
}

function isVerificationCheck(value: unknown): value is VerificationCheck {
  if (!isRecord(value)) return false;
  return ["http", "api", "dom", "console", "interaction", "identity"].includes(String(value.phase))
    && ["passed", "failed", "pending"].includes(String(value.status))
    && typeof value.summary === "string"
    && (value.suggestion === undefined || typeof value.suggestion === "string");
}
