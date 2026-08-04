import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import {
  AUTH_SESSION_MAX_AGE_MS,
  AUTH_SESSION_REFRESH_INTERVAL_MS,
  createAuthSession,
  createAuthSessionForUserVersion,
  refreshAuthSession,
  resolveAuthSession,
  revokeAuthSession,
  revokeUserAuthSessions,
  setAuthSessionCookie,
} from "../src/lib/auth-sessions.js";
import {
  closeMetaDb,
  createUser,
  deleteUserById,
  findUserByName,
  getDb,
  initMetaDb,
  updateUserPasswordAndRevokeSessions,
} from "../src/lib/meta-sqlite.js";

describe("auth sessions", () => {
  let dataDir: string;
  const startedAt = new Date("2026-07-24T00:00:00.000Z");

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-auth-session-"));
    await initMetaDb(dataDir);
  });

  afterEach(() => {
    closeMetaDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("stores only the token hash and resolves an active session", () => {
    const created = createAuthSession("alice", startedAt);
    const rows = getDb().exec("SELECT token_hash, user_id FROM auth_sessions");

    expect(created.token).toBeTruthy();
    expect(created.token).not.toContain(".");
    expect(rows[0].values).toHaveLength(1);
    expect(rows[0].values[0][0]).not.toBe(created.token);
    expect(rows[0].values[0][1]).toBe("alice");

    expect(resolveAuthSession(created.token, startedAt)).toMatchObject({
      tokenHash: created.tokenHash,
      userId: "alice",
      shouldRefresh: false,
    });
  });

  it("expires after 30 days without activity", () => {
    const created = createAuthSession("alice", startedAt);
    const expiredAt = new Date(startedAt.getTime() + AUTH_SESSION_MAX_AGE_MS + 1);

    expect(resolveAuthSession(created.token, expiredAt)).toBeNull();
  });

  it("survives a metadata database restart", async () => {
    const created = createAuthSession("alice", startedAt);

    closeMetaDb();
    await initMetaDb(dataDir);

    expect(resolveAuthSession(created.token, startedAt)?.userId).toBe("alice");
  });

  it("refreshes at most once per 24 hours", () => {
    const created = createAuthSession("alice", startedAt);
    const beforeThreshold = new Date(startedAt.getTime() + AUTH_SESSION_REFRESH_INTERVAL_MS - 1);
    const atThreshold = new Date(startedAt.getTime() + AUTH_SESSION_REFRESH_INTERVAL_MS);

    expect(resolveAuthSession(created.token, beforeThreshold)?.shouldRefresh).toBe(false);
    expect(resolveAuthSession(created.token, atThreshold)?.shouldRefresh).toBe(true);

    const refreshed = refreshAuthSession(created.tokenHash, atThreshold);
    expect(refreshed?.expiresAt.getTime()).toBe(atThreshold.getTime() + AUTH_SESSION_MAX_AGE_MS);
    expect(resolveAuthSession(created.token, atThreshold)?.shouldRefresh).toBe(false);
  });

  it("revokes one session without affecting another", () => {
    const first = createAuthSession("alice", startedAt);
    const second = createAuthSession("alice", startedAt);

    revokeAuthSession(first.tokenHash);

    expect(resolveAuthSession(first.token, startedAt)).toBeNull();
    expect(resolveAuthSession(second.token, startedAt)?.userId).toBe("alice");
  });

  it("revokes every session for a user", () => {
    const aliceFirst = createAuthSession("alice", startedAt);
    const aliceSecond = createAuthSession("alice", startedAt);
    const bob = createAuthSession("bob", startedAt);

    revokeUserAuthSessions("alice");

    expect(resolveAuthSession(aliceFirst.token, startedAt)).toBeNull();
    expect(resolveAuthSession(aliceSecond.token, startedAt)).toBeNull();
    expect(resolveAuthSession(bob.token, startedAt)?.userId).toBe("bob");
  });

  it("rejects stale authentication versions after a password change", () => {
    createUser("versioned-user", "versioned-user", "old-hash");
    const original = findUserByName("versioned-user")!;
    expect(
      createAuthSessionForUserVersion(
        "versioned-user",
        original.authVersion,
        original.authGeneration,
        startedAt,
      ),
    ).not.toBeNull();

    const nextVersion = updateUserPasswordAndRevokeSessions(
      "versioned-user",
      "new-hash",
      false,
      original.authVersion,
      original.authGeneration,
    );
    expect(nextVersion).toBe(1);
    expect(
      createAuthSessionForUserVersion(
        "versioned-user",
        original.authVersion,
        original.authGeneration,
        startedAt,
      ),
    ).toBeNull();
    expect(
      createAuthSessionForUserVersion(
        "versioned-user",
        1,
        original.authGeneration,
        startedAt,
      ),
    ).not.toBeNull();
    expect(
      updateUserPasswordAndRevokeSessions(
        "versioned-user",
        "stale-hash",
        false,
        original.authVersion,
        original.authGeneration,
      ),
    ).toBeNull();
  });

  it("rejects authentication state from a deleted and recreated account", () => {
    createUser("recreated-user", "recreated-user", "old-hash");
    const original = findUserByName("recreated-user")!;

    expect(deleteUserById("recreated-user")).toBe(true);
    createUser("recreated-user", "recreated-user", "new-hash");
    const recreated = findUserByName("recreated-user")!;
    expect(recreated.authGeneration).not.toBe(original.authGeneration);

    expect(
      createAuthSessionForUserVersion(
        "recreated-user",
        original.authVersion,
        original.authGeneration,
        startedAt,
      ),
    ).toBeNull();
    expect(
      updateUserPasswordAndRevokeSessions(
        "recreated-user",
        "stale-hash",
        false,
        original.authVersion,
        original.authGeneration,
      ),
    ).toBeNull();
  });

  it("ignores forwarded protocol headers and forces secure cookies in production", async () => {
    const app = Fastify();
    await app.register(cookie);
    app.get("/", async (req, reply) => {
      setAuthSessionCookie(req, reply, "test-token", new Date("2026-08-23T00:00:00.000Z"));
      return { success: true };
    });

    const previousNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      const spoofed = await app.inject({
        method: "GET",
        url: "/",
        headers: { "x-forwarded-proto": "https" },
      });
      expect(spoofed.headers["set-cookie"]).not.toContain("Secure");

      process.env.NODE_ENV = "production";
      const production = await app.inject({ method: "GET", url: "/" });
      expect(production.headers["set-cookie"]).toContain("Secure");
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
      await app.close();
    }
  });
});
