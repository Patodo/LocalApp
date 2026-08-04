import { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { findUserById } from "../lib/meta-sqlite.js";
import {
  clearAuthSessionCookie,
  refreshAuthSession,
  resolveAuthSession,
  revokeAuthSession,
  setAuthSessionCookie,
} from "../lib/auth-sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    visitorId?: string | null;
    visitorName?: string | null;
    visitorRole?: "admin" | "user" | null;
    authSessionTokenHash?: string | null;
  }
}

async function session(app: FastifyInstance) {
  app.addHook("onRequest", async (req: FastifyRequest, reply) => {
    const token = req.cookies?.token;
    if (!token) {
      req.visitorId = null;
      req.visitorName = null;
      req.visitorRole = null;
      req.authSessionTokenHash = null;
      return;
    }

    const resolved = resolveAuthSession(token);
    if (!resolved) {
      req.visitorId = null;
      req.visitorName = null;
      req.visitorRole = null;
      req.authSessionTokenHash = null;
      clearAuthSessionCookie(req, reply);
      return;
    }

    const user = findUserById(resolved.userId);
    if (!user) {
      revokeAuthSession(resolved.tokenHash);
      req.visitorId = null;
      req.visitorName = null;
      req.visitorRole = null;
      req.authSessionTokenHash = null;
      clearAuthSessionCookie(req, reply);
      return;
    }

    req.visitorId = user.id;
    req.visitorName = user.name;
    req.visitorRole = user.role;
    req.authSessionTokenHash = resolved.tokenHash;

    if (resolved.shouldRefresh) {
      const refreshed = refreshAuthSession(resolved.tokenHash);
      if (refreshed) setAuthSessionCookie(req, reply, token, refreshed.expiresAt);
    }
  });
}

export const sessionPlugin = fp(session, { name: "session" });
