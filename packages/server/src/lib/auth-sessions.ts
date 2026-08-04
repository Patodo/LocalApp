import { createHash, randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  deleteAuthSession,
  deleteAuthSessionsForUser,
  deleteExpiredAuthSessions,
  findAuthSession,
  insertAuthSession,
  insertAuthSessionForUserVersion,
  updateAuthSessionActivity,
} from "./meta-sqlite.js";

export const AUTH_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const AUTH_SESSION_MAX_AGE_MS = AUTH_SESSION_MAX_AGE_SECONDS * 1000;
export const AUTH_SESSION_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface CreatedAuthSession {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export interface ResolvedAuthSession {
  tokenHash: string;
  userId: string;
  expiresAt: Date;
  shouldRefresh: boolean;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createAuthSession(userId: string, now = new Date()): CreatedAuthSession {
  const session = prepareAuthSession(userId, now);
  deleteExpiredAuthSessions(now.toISOString());
  insertAuthSession(toRecord(session, userId, now));
  return session;
}

export function createAuthSessionForUserVersion(
  userId: string,
  authVersion: number,
  authGeneration: string,
  now = new Date(),
): CreatedAuthSession | null {
  const session = prepareAuthSession(userId, now);
  deleteExpiredAuthSessions(now.toISOString());
  return insertAuthSessionForUserVersion(toRecord(session, userId, now), authVersion, authGeneration)
    ? session
    : null;
}

function prepareAuthSession(userId: string, now: Date): CreatedAuthSession {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + AUTH_SESSION_MAX_AGE_MS);
  return { token, tokenHash, expiresAt };
}

function toRecord(session: CreatedAuthSession, userId: string, now: Date) {
  const timestamp = now.toISOString();
  return {
    tokenHash: session.tokenHash,
    userId,
    createdAt: timestamp,
    lastSeenAt: timestamp,
    expiresAt: session.expiresAt.toISOString(),
  };
}

export function resolveAuthSession(token: string, now = new Date()): ResolvedAuthSession | null {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const session = findAuthSession(tokenHash);
  if (!session) return null;

  const expiresAt = new Date(session.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    deleteAuthSession(tokenHash);
    return null;
  }

  const lastSeenAt = new Date(session.lastSeenAt);
  return {
    tokenHash,
    userId: session.userId,
    expiresAt,
    shouldRefresh: now.getTime() - lastSeenAt.getTime() >= AUTH_SESSION_REFRESH_INTERVAL_MS,
  };
}

export function refreshAuthSession(tokenHash: string, now = new Date()): { expiresAt: Date } | null {
  const session = findAuthSession(tokenHash);
  if (!session || new Date(session.expiresAt).getTime() <= now.getTime()) {
    if (session) deleteAuthSession(tokenHash);
    return null;
  }

  const expiresAt = new Date(now.getTime() + AUTH_SESSION_MAX_AGE_MS);
  const updated = updateAuthSessionActivity(tokenHash, now.toISOString(), expiresAt.toISOString());
  return updated ? { expiresAt } : null;
}

export function revokeAuthSession(tokenHash: string): boolean {
  return deleteAuthSession(tokenHash);
}

export function revokeUserAuthSessions(userId: string): number {
  return deleteAuthSessionsForUser(userId);
}

function isSecureRequest(req: FastifyRequest): boolean {
  return process.env.NODE_ENV === "production"
    || (req.raw.socket as { encrypted?: boolean }).encrypted === true;
}

export function setAuthSessionCookie(
  req: FastifyRequest,
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
): void {
  reply.setCookie("token", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: isSecureRequest(req),
    maxAge: AUTH_SESSION_MAX_AGE_SECONDS,
    expires: expiresAt,
  });
}

export function clearAuthSessionCookie(req: FastifyRequest, reply: FastifyReply): void {
  reply.clearCookie("token", {
    path: "/",
    secure: isSecureRequest(req),
  });
}
