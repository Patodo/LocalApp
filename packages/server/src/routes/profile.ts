import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import bcrypt from "bcryptjs";
import {
  findUserById,
  updateUserProfile,
  updateUserPasswordAndRevokeSessions,
  updateUserAvatar,
  listAllUsersBasic,
  validateApiKey,
} from "../lib/meta-sqlite.js";
import { readPageMeta, getPageDir } from "../plugins/storage.js";
import { removeDirRecursive } from "../lib/file-utils.js";
import { deleteAppObjects } from "../lib/s3-client.js";
import { closeConnectionsForPage } from "../lib/app-db.js";
import { withAppDataMaintenance } from "../lib/app-data-maintenance.js";
import { getAppLifecycleStatus } from "../lib/app-lifecycle.js";
import {
  createAuthSessionForUserVersion,
  setAuthSessionCookie,
} from "../lib/auth-sessions.js";

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2MB
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function extFromMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

export async function profileRoutes(app: FastifyInstance) {
  const dataDir = () => app.config.dataDir;

  // Session-only guard: reject requests without visitorId (no API Key auth)
  function requireSession(visitorId: string | null | undefined, reply: any): visitorId is string {
    if (!visitorId) {
      reply.status(401).send({ success: false, error: "Authentication required" });
      return false;
    }
    return true;
  }

  // GET /api/users — public user list (authenticated users only)
  app.get("/api/users", async (req, reply) => {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    const userId = apiKey ? validateApiKey(apiKey) : req.visitorId;
    if (!userId) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }
    const users = listAllUsersBasic();
    return { success: true, data: users };
  });

  // PUT /api/me/profile — update display name and bio
  app.put("/api/me/profile", async (req, reply) => {
    if (!requireSession(req.visitorId, reply)) return;

    const { displayName, bio } = req.body as { displayName?: string; bio?: string };

    if (displayName !== undefined && (displayName.length < 1 || displayName.length > 32)) {
      return reply.status(400).send({ success: false, error: "Display name must be 1-32 characters" });
    }

    updateUserProfile(req.visitorId!, displayName, bio);

    const user = findUserById(req.visitorId!);
    return {
      success: true,
      data: {
        displayName: user?.displayName ?? null,
        bio: user?.bio ?? null,
      },
    };
  });

  // PUT /api/me/password — change password
  app.put("/api/me/password", async (req, reply) => {
    if (!requireSession(req.visitorId, reply)) return;

    const { oldPassword, newPassword } = req.body as { oldPassword?: string; newPassword?: string };

    const user = findUserById(req.visitorId!);
    if (!user) return reply.status(404).send({ success: false, error: "User not found" });

    // Get password hash
    const { findUserByName } = await import("../lib/meta-sqlite.js");
    const fullUser = findUserByName(user.name);
    if (!fullUser) return reply.status(404).send({ success: false, error: "User not found" });

    if (!oldPassword || !(await bcrypt.compare(oldPassword, fullUser.password))) {
      return reply.status(401).send({ success: false, error: "Incorrect current password" });
    }

    if (!newPassword || newPassword.length < 6) {
      return reply.status(400).send({ success: false, error: "New password must be at least 6 characters" });
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const authVersion = updateUserPasswordAndRevokeSessions(
      req.visitorId!,
      hash,
      false,
      fullUser.authVersion,
      fullUser.authGeneration,
    );
    if (authVersion === null) {
      return reply.status(409).send({ success: false, error: "Password changed concurrently; retry with the current password" });
    }
    const session = createAuthSessionForUserVersion(req.visitorId!, authVersion, fullUser.authGeneration);
    if (!session) {
      return reply.status(409).send({ success: false, error: "Password changed concurrently; sign in again" });
    }
    setAuthSessionCookie(req, reply, session.token, session.expiresAt);

    return { success: true };
  });

  // POST /api/me/avatar — upload avatar
  app.post("/api/me/avatar", async (req, reply) => {
    if (!requireSession(req.visitorId, reply)) return;

    const data = await req.file();
    if (!data) {
      return reply.status(400).send({ success: false, error: "No avatar file provided" });
    }

    if (!ALLOWED_MIME_TYPES.has(data.mimetype)) {
      return reply.status(400).send({ success: false, error: "Avatar must be JPG, PNG, or WebP" });
    }

    const buffer = await data.toBuffer();
    if (buffer.length > MAX_AVATAR_SIZE) {
      return reply.status(413).send({ success: false, error: "Avatar must be smaller than 2MB" });
    }

    const ext = extFromMime(data.mimetype);
    const avatarsDir = path.join(dataDir(), "avatars");
    fs.mkdirSync(avatarsDir, { recursive: true });

    // Remove old avatar files for this user
    const existingFiles = fs.readdirSync(avatarsDir).filter((f) => f.startsWith(req.visitorId! + "."));
    for (const f of existingFiles) {
      fs.unlinkSync(path.join(avatarsDir, f));
    }

    const filename = `${req.visitorId!}.${ext}`;
    fs.writeFileSync(path.join(avatarsDir, filename), buffer);

    const avatarUrl = `/api/avatar/${req.visitorId!}`;
    updateUserAvatar(req.visitorId!, avatarUrl);

    return { success: true, data: { avatarUrl } };
  });

  // GET /api/me/avatar — current user's avatar
  app.get("/api/me/avatar", async (req, reply) => {
    if (!req.visitorId) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }

    const user = findUserById(req.visitorId);
    if (!user?.avatarUrl) {
      return reply.status(404).send({ success: false, error: "No avatar" });
    }

    const avatarsDir = path.join(dataDir(), "avatars");
    const files = fs.readdirSync(avatarsDir).filter((f) => f.startsWith(req.visitorId + "."));
    if (files.length === 0) {
      return reply.status(404).send({ success: false, error: "No avatar" });
    }

    const filePath = path.join(avatarsDir, files[0]);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
    reply.header("Content-Type", mimeMap[ext] || "application/octet-stream");
    return reply.send(fs.readFileSync(filePath));
  });

  // GET /api/avatar/:userId — public avatar access
  app.get<{ Params: { userId: string } }>("/api/avatar/:userId", async (req, reply) => {
    const { userId } = req.params;
    const avatarsDir = path.join(dataDir(), "avatars");

    if (!fs.existsSync(avatarsDir)) {
      return reply.status(404).send({ success: false, error: "No avatar" });
    }

    const files = fs.readdirSync(avatarsDir).filter((f) => f.startsWith(userId + "."));
    if (files.length === 0) {
      return reply.status(404).send({ success: false, error: "No avatar" });
    }

    const filePath = path.join(avatarsDir, files[0]);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
    reply.header("Content-Type", mimeMap[ext] || "application/octet-stream");
    reply.header("Cache-Control", "public, max-age=3600");
    return reply.send(fs.readFileSync(filePath));
  });

  // ── Session-auth page routes (/api/me/pages) ──

  // GET /api/me/pages — list current user's apps (session auth)
  app.get("/api/me/pages", async (req, reply) => {
    if (!requireSession(req.visitorId, reply)) return;
    const { limit } = req.query as { limit?: string };
    const userDir = path.join(dataDir(), req.visitorId!);
    if (!fs.existsSync(userDir)) return { success: true, data: [] };

    const entries = fs.readdirSync(userDir, { withFileTypes: true });
    const pages = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = readPageMeta(dataDir(), req.visitorId!, entry.name);
      if (meta) {
        pages.push({
          userId: meta.userId,
          name: meta.name,
          currentVersion: meta.currentVersion,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lifecycleStatus: getAppLifecycleStatus(meta),
        });
      }
    }
    if (limit) {
      const n = Math.min(parseInt(limit, 10) || 50, 100);
      return { success: true, data: pages.slice(0, n) };
    }
    return { success: true, data: pages };
  });

  // GET /api/me/pages/:name — get app detail (session auth)
  app.get<{ Params: { name: string } }>("/api/me/pages/:name", async (req, reply) => {
    if (!requireSession(req.visitorId, reply)) return;
    const { name } = req.params;
    const meta = readPageMeta(dataDir(), req.visitorId!, name);
    if (!meta) return reply.status(404).send({ success: false, error: "Page not found" });
    return {
      success: true,
      data: {
        name: meta.name,
        userId: meta.userId,
        currentVersion: meta.currentVersion,
        versionCount: meta.versions.length,
        versions: meta.versions,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        lifecycleStatus: getAppLifecycleStatus(meta),
      },
    };
  });

  // DELETE /api/me/pages/:name — delete app (session auth)
  app.delete<{ Params: { name: string } }>("/api/me/pages/:name", async (req, reply) => {
    if (!requireSession(req.visitorId, reply)) return;
    const { name } = req.params;
    const meta = readPageMeta(dataDir(), req.visitorId!, name);
    if (!meta) return reply.status(404).send({ success: false, error: "Page not found" });
    if (meta.userId !== req.visitorId!) return reply.status(403).send({ success: false, error: "Forbidden" });
    const pageDir = getPageDir(dataDir(), req.visitorId!, name);
    await withAppDataMaintenance(pageDir, async () => {
      closeConnectionsForPage(pageDir);
      await deleteAppObjects(req.visitorId!, name);
      removeDirRecursive(pageDir);
    });
    return { success: true, data: { deleted: true, name } };
  });

  // GET /api/pages/:userId/:name/meta — public page metadata
  app.get<{ Params: { userId: string; name: string } }>("/api/pages/:userId/:name/meta", async (req, reply) => {
    const { userId, name } = req.params;
    const meta = readPageMeta(dataDir(), userId, name);
    if (!meta) return reply.status(404).send({ success: false, error: "Page not found" });
    return {
      success: true,
      data: {
        name: meta.name,
        userId: meta.userId,
        description: meta.description,
        shell: meta.shell,
        notify: meta.notify,
        collaboration: meta.collaboration,
        lifecycleStatus: getAppLifecycleStatus(meta),
      },
    };
  });
}
