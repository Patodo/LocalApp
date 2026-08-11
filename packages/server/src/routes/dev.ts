import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import path from "node:path";
import {
  createAppBackup,
  getAppBackup,
  resetAppDatabase,
  restoreAppBackup,
  type AppDataIdentity,
} from "../lib/app-backups.js";
import { listRecentRequestLogs } from "../lib/request-logger.js";
import { findUserById, listAllUsersBasic, validateApiKey } from "../lib/meta-sqlite.js";
import { isLoopbackAddress } from "../lib/loopback.js";
import { validateName } from "../lib/validate-name.js";
import { getPageDir, readPageMeta, type PageMeta } from "../plugins/storage.js";

declare module "fastify" {
  interface FastifyRequest {
    devNow?: string;
  }
}

type DevContextUser = {
  id: string;
  name: string;
  role: string;
  displayName?: string | null;
  avatarUrl?: string | null;
};

type DevContext = {
  user: DevContextUser | null;
  timeMode: "real" | "fixed";
  now: string | null;
  pageName: string;
  pageOwnerId: string;
  recentUsers: DevContextUser[];
};

const contexts = new Map<string, DevContext>();

export async function installDevRequestContext(app: FastifyInstance): Promise<void> {
  app.addHook("onRequest", async (req) => {
    if (!isLoopbackAddress(req.ip)) return;
    const pageName = devPageName(req);
    const requestPath = req.url.split("?", 1)[0];
    if (!pageName || requestPath === "/api/dev" || requestPath.startsWith("/api/dev/")) return;
    if (requestPath.includes("/api/device-actions") || requestPath.includes("/api/desktop-actions")) return;
    if (validateName(pageName)) return;

    const apiKey = req.headers["x-api-key"];
    const ownerId = typeof apiKey === "string" ? validateApiKey(apiKey) : null;
    if (!ownerId) return;

    const context = getContextFor(app, ownerId, pageName);
    delete req.headers["x-api-key"];
    if (context.user) {
      const user = findUserById(context.user.id);
      req.visitorId = context.user.id;
      req.visitorName = user?.name ?? context.user.name;
      req.visitorRole = user?.role ?? "user";
      req.userId = context.user.id;
    } else {
      req.visitorId = null;
      req.visitorName = null;
      req.visitorRole = null;
      req.userId = "";
    }
    req.devNow = context.timeMode === "fixed" && context.now ? context.now : undefined;
  });
}

export async function devRoutes(app: FastifyInstance): Promise<void> {
  const contextPrefix = contextPrefixFor(app);
  app.addHook("onClose", async () => {
    for (const key of contexts.keys()) {
      if (key.startsWith(contextPrefix)) contexts.delete(key);
    }
  });
  app.addHook("onRequest", async (req, reply) => {
    if (!isLoopbackAddress(req.ip)) {
      return reply.status(403).send({ success: false, error: "Dev Toolkit is available only from loopback" });
    }
    const pageName = devPageName(req);
    const pageNameError = validateName(pageName);
    if (pageNameError) {
      return reply.status(400).send({ success: false, error: `Invalid dev application page name: ${pageNameError}` });
    }
  });

  app.get("/api/dev/context", async (req, reply) => {
    const context = getContext(app, req);
    return { success: true, data: cloneContext(context) };
  });

  app.put<{ Body: Record<string, unknown> }>("/api/dev/context", async (req, reply) => {
    const context = getContext(app, req);
    const next = updateContext(context, req.body);
    if (!next.ok) return reply.status(400).send({ success: false, error: next.error });
    contexts.set(contextKey(app, req.userId, devPageName(req)), next.data);
    return { success: true, data: cloneContext(next.data) };
  });

  app.get<{ Querystring: { search?: string } }>("/api/dev/users", async (req) => {
    const context = getContext(app, req);
    const search = req.query.search?.trim().toLowerCase() ?? "";
    const users = listAllUsersBasic()
      .map((user) => ({
        ...user,
        displayName: user.displayName ?? user.name,
        role: user.id === context.pageOwnerId ? "owner" : (findUserById(user.id)?.role ?? "user"),
      }))
      .filter((user) => !search || [user.id, user.name, user.displayName].some((value) => value.toLowerCase().includes(search)));
    const currentUser = context.user ? toBasicUser(context.user) : null;
    return {
      success: true,
      data: {
        currentUser,
        ownUser: users.find((user) => user.id === context.pageOwnerId) ?? null,
        recentUsers: context.recentUsers.map(toBasicUser),
        users,
        source: "server",
        error: null,
      },
    };
  });

  app.post("/api/dev/data/reset", async (req, reply) => {
    const target = resolveDevApp(app, req, reply);
    if (!target) return;
    try {
      await resetAppDatabase(target.pageDir, { application: target.application });
      return { success: true, data: { reset: true } };
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post("/api/dev/data/snapshots", async (req, reply) => {
    const target = resolveDevApp(app, req, reply);
    if (!target) return;
    try {
      const backup = await createAppBackup(target.pageDir, {
        name: "Dev snapshot",
        source: "manual",
        reason: "dev-snapshot",
        application: target.application,
      });
      return reply.status(201).send({ success: true, data: { id: backup.id, createdAt: backup.createdAt } });
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.post<{ Params: { id: string } }>("/api/dev/data/snapshots/:id/restore", async (req, reply) => {
    const target = resolveDevApp(app, req, reply);
    if (!target) return;
    try {
      getAppBackup(target.pageDir, req.params.id);
      await restoreAppBackup(target.pageDir, req.params.id, { application: target.application });
      return { success: true, data: { restored: true, id: req.params.id } };
    } catch (error) {
      return sendDataError(reply, error);
    }
  });

  app.get("/api/dev/diagnostics/requests", async (req) => {
    const context = getContext(app, req);
    const diagnosticUserId = context.user?.id ?? req.userId;
    return {
      success: true,
      data: listRecentRequestLogs(app.config.dataDir).filter((entry) => entry.userId === diagnosticUserId),
    };
  });

  app.get("/api/dev/business", async (req, reply) => {
    const target = resolveDevApp(app, req, reply);
    if (!target) return;
    return { success: true, data: target.meta.business ?? {} };
  });
}

function getContext(app: FastifyInstance, req: FastifyRequest): DevContext {
  return getContextFor(app, req.userId, devPageName(req));
}

function getContextFor(app: FastifyInstance, ownerId: string, pageName: string): DevContext {
  const key = contextKey(app, ownerId, pageName);
  const existing = contexts.get(key);
  if (existing) return existing;
  const user = findUserById(ownerId);
  const context: DevContext = {
    user: user ? userToContextUser(user, ownerId) : { id: ownerId, name: ownerId, role: "owner" },
    timeMode: "real",
    now: null,
    pageName,
    pageOwnerId: ownerId,
    recentUsers: [],
  };
  contexts.set(key, context);
  return context;
}

function updateContext(context: DevContext, body: Record<string, unknown> | undefined):
  | { ok: true; data: DevContext }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Invalid dev context payload" };
  const next = cloneContext(context);
  if ("user" in body) {
    if (body.user === null) {
      next.user = null;
    } else if (isRecord(body.user) && typeof body.user.id === "string" && body.user.id.trim()) {
      const user = findUserById(body.user.id);
      if (!user) return { ok: false, error: "Dev context user must be a Server user" };
      next.user = userToContextUser(user, next.pageOwnerId);
      next.recentUsers = [next.user, ...next.recentUsers.filter((recent) => recent.id !== next.user?.id)].slice(0, 2) as DevContextUser[];
    } else {
      return { ok: false, error: "Invalid dev context user" };
    }
  }
  if ("timeMode" in body) {
    if (body.timeMode !== "real" && body.timeMode !== "fixed") return { ok: false, error: "Invalid dev context timeMode" };
    next.timeMode = body.timeMode;
    if (next.timeMode === "real") next.now = null;
  }
  if ("now" in body) {
    if (body.now === null) {
      next.now = null;
      if (!("timeMode" in body)) next.timeMode = "real";
    } else if (typeof body.now === "string" && !Number.isNaN(Date.parse(body.now))) {
      next.now = new Date(body.now).toISOString();
      if (!("timeMode" in body)) next.timeMode = "fixed";
    } else {
      return { ok: false, error: "Invalid dev context now" };
    }
  }
  if (next.timeMode === "fixed" && !next.now) return { ok: false, error: "Fixed dev time requires now" };
  return { ok: true, data: next };
}

function resolveDevApp(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
): { meta: PageMeta; pageDir: string; application: AppDataIdentity } | null {
  const pageName = devPageName(req);
  const pageNameError = validateName(pageName);
  if (pageNameError) {
    reply.status(400).send({ success: false, error: `Invalid dev application page name: ${pageNameError}` });
    return null;
  }
  const ownerDir = path.resolve(app.config.dataDir, req.userId);
  const pageDir = path.resolve(getPageDir(app.config.dataDir, req.userId, pageName));
  if (!pageDir.startsWith(ownerDir + path.sep)) {
    reply.status(400).send({ success: false, error: "Dev application path escapes its owner directory" });
    return null;
  }
  const meta = readPageMeta(app.config.dataDir, req.userId, pageName);
  if (!meta || meta.userId !== req.userId || meta.name !== pageName) {
    reply.status(404).send({ success: false, error: "Dev application not found" });
    return null;
  }
  return {
    meta,
    pageDir,
    application: { owner: req.userId, name: pageName, version: meta.currentVersion },
  };
}

function sendDataError(reply: FastifyReply, error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "APP_DATA_OPERATION_FAILED";
  const message = error instanceof Error ? error.message : String(error);
  const status = code.endsWith("NOT_FOUND")
    ? 404
    : code === "APP_DATA_OPERATION_BUSY" || code === "APP_DATA_MAINTENANCE" || code === "APP_MIGRATIONS_UNAVAILABLE"
      ? 409
      : 400;
  return reply.status(status).send({ success: false, code, error: message });
}

function contextPrefixFor(app: FastifyInstance): string {
  return `${app.config.dataDir}\0`;
}

function contextKey(app: FastifyInstance, ownerId: string, pageName: string): string {
  return `${contextPrefixFor(app)}${ownerId}:${pageName}`;
}

function devPageName(req: FastifyRequest): string {
  const header = req.headers["x-localapp-dev-page"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const query = req.query as { pageName?: unknown } | undefined;
  return typeof query?.pageName === "string" ? query.pageName.trim() : "";
}

function cloneContext(context: DevContext): DevContext {
  return {
    ...context,
    user: context.user ? { ...context.user } : null,
    recentUsers: context.recentUsers.map((user) => ({ ...user })),
  };
}

function userToContextUser(user: ReturnType<typeof findUserById>, ownerId: string): DevContextUser {
  return {
    id: user!.id,
    name: user!.displayName ?? user!.name,
    role: user!.id === ownerId ? "owner" : user!.role,
    displayName: user!.displayName,
    avatarUrl: user!.avatarUrl,
  };
}

function toBasicUser(user: DevContextUser) {
  return {
    id: user.id,
    name: user.id,
    displayName: user.displayName ?? user.name,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
