import { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { VERIFICATION_ME_COOKIE } from "../lib/verification-sessions.js";
import { findUserByName, findUserById, updateUserPasswordAndRevokeSessions } from "../lib/meta-sqlite.js";
import {
  clearAuthSessionCookie,
  createAuthSessionForUserVersion,
  revokeAuthSession,
  setAuthSessionCookie,
} from "../lib/auth-sessions.js";

const MIN_PASSWORD_LENGTH = 6;

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/cli-register", async (_req, reply) => {
    return reply.status(410).send({
      success: false,
      code: "CLI_AUTO_REGISTRATION_REMOVED",
      error: "CLI automatic registration has been removed. Ask an administrator for an API Key.",
    });
  });

  app.post<{
    Body: { username: string; password: string };
  }>("/api/auth/login", async (req, reply) => {
    const { username, password } = req.body;

    const user = findUserByName(username);
    if (!user) {
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }

    if (user.mustChangePassword) {
      return reply.status(403).send({ success: false, error: "Password reset required", code: "MUST_CHANGE_PASSWORD" });
    }

    const session = createAuthSessionForUserVersion(user.id, user.authVersion, user.authGeneration);
    if (!session) {
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }
    setAuthSessionCookie(req, reply, session.token, session.expiresAt);

    return { success: true, data: { id: user.id, name: user.name, role: user.role } };
  });

  app.post("/api/auth/logout", async (req, reply) => {
    if (req.authSessionTokenHash) revokeAuthSession(req.authSessionTokenHash);
    clearAuthSessionCookie(req, reply);
    return { success: true };
  });

  app.post<{
    Body: { userId: string; oldPassword: string; newPassword: string };
  }>("/api/auth/force-change-password", async (req, reply) => {
    const { userId, oldPassword, newPassword } = req.body;

    const user = findUserById(userId);
    if (!user) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    // Need password hash for verification — fetch from name lookup
    const userWithPassword = findUserByName(user.name);
    if (!userWithPassword) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    const valid = await bcrypt.compare(oldPassword, userWithPassword.password);
    if (!valid) {
      return reply.status(401).send({ success: false, error: "Invalid credentials" });
    }

    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return reply.status(400).send({ success: false, error: "Password too short" });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    const authVersion = updateUserPasswordAndRevokeSessions(
      userId,
      passwordHash,
      false,
      userWithPassword.authVersion,
      userWithPassword.authGeneration,
    );
    if (authVersion === null) {
      return reply.status(409).send({ success: false, error: "Password changed concurrently; retry with the current password" });
    }
    const session = createAuthSessionForUserVersion(user.id, authVersion, userWithPassword.authGeneration);
    if (!session) {
      return reply.status(409).send({ success: false, error: "Password changed concurrently; sign in again" });
    }
    setAuthSessionCookie(req, reply, session.token, session.expiresAt);

    return { success: true, data: { id: user.id, name: user.name, role: user.role } };
  });

  app.get("/api/me", async (req) => {
    const userData = (user: import("../types/models.js").User) => ({
      id: user.id,
      name: user.name,
      role: user.role,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      bio: user.bio,
    });

    // Verification identity is accepted only for this read-only endpoint and only
    // when the browser came from the bound formal application path. It takes
    // precedence so a pre-existing login cannot change the requested test role.
    const verification = app.verificationSessions?.resolveFromFormalReferer(
      req.cookies?.[VERIFICATION_ME_COOKIE],
      req.headers.referer,
    );
    if (verification) {
      return {
        success: true,
        data: {
          id: verification.actorId,
          name: verification.actorName,
          role: "user",
          verificationIdentity: verification.identity,
          displayName: verification.actorName,
          avatarUrl: null,
          bio: null,
        },
      };
    }

    // Try cookie session after the app-scoped verification identity.
    if (req.visitorId) {
      const user = findUserById(req.visitorId);
      if (user) {
        return { success: true, data: userData(user) };
      }
    }

    // Try API Key
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (apiKey) {
      const { validateApiKey } = await import("../lib/meta-sqlite.js");
      const userId = validateApiKey(apiKey);
      if (userId) {
        const user = findUserById(userId);
        if (user) {
          return { success: true, data: userData(user) };
        }
      }
    }

    return { success: true, data: null };
  });
}
