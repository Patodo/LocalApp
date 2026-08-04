import { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { adminAuth } from "../plugins/auth.js";
import bcrypt from "bcryptjs";
import { listUsers, findUserById, deleteUserById, getDb, updateUserPasswordAndRevokeSessions, createGroup, listSystemGroups, findGroupById, updateGroup, addGroupMembers, removeGroupMembers, getGroupMembers, provisionUserWithApiKey, BOOTSTRAP_USER_ID, isProtectedUserId, updateUserRole } from "../lib/meta-sqlite.js";
import { generateTemporaryPassword } from "../lib/credentials.js";
import { readPageMeta, getPageDir, getUserTotalSize } from "../plugins/storage.js";
import { removeDirRecursive, getDirectorySize } from "../lib/file-utils.js";
import { closeConnectionsForPage } from "../lib/app-db.js";
import { deleteAppObjects } from "../lib/s3-client.js";
import { withAppDataMaintenance } from "../lib/app-data-maintenance.js";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]{2,32}$/;

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

export async function adminRoutes(app: FastifyInstance) {
  const dataDir = app.config.dataDir;

  adminAuth(app);

  // GET /api/admin/users — paginated user list
  app.get("/api/admin/users", async (req) => {
    const page = Math.max(1, parseInt((req.query as any).page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query as any).limit || "20", 10)));

    const { data, total } = listUsers(page, limit);
    const users = data.map((u) => {
      const userDir = path.join(dataDir, u.id);
      let pages = 0;
      let storageUsed = 0;
      if (fs.existsSync(userDir)) {
        const entries = fs.readdirSync(userDir, { withFileTypes: true });
        pages = entries.filter((e) => e.isDirectory() && fs.existsSync(path.join(userDir, e.name, "meta.json"))).length;
        storageUsed = getUserTotalSize(dataDir, u.id);
      }
      return {
        id: u.id,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt,
        pages,
        storageUsed: formatSize(storageUsed),
        storageBytes: storageUsed,
        mustChangePassword: u.mustChangePassword,
      };
    });

    return { success: true, data: users, pagination: { page, limit, total } };
  });

  // POST /api/admin/users — admin provisions a user and one-time credentials.
  app.post<{ Body: { username?: string } }>("/api/admin/users", async (req, reply) => {
    const { username } = req.body || {};

    if (!username || !USERNAME_REGEX.test(username)) {
      return reply.status(400).send({ success: false, error: "Invalid username format" });
    }

    const temporaryPassword = generateTemporaryPassword();
    const apiKey = randomBytes(24).toString("hex");
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    try {
      const user = provisionUserWithApiKey(username, username, passwordHash, apiKey);
      return {
        success: true,
        data: {
          id: user.id,
          name: user.name,
          role: user.role,
          mustChangePassword: true,
          credentials: { temporaryPassword, apiKey },
        },
      };
    } catch (err: any) {
      if (err.message === "USER_EXISTS") {
        return reply.status(409).send({ success: false, error: "Username already exists" });
      }
      throw err;
    }
  });

  // POST /api/admin/reset-password — issue a one-time random password.
  app.post<{ Body: { userId: string } }>("/api/admin/reset-password", async (req, reply) => {
    const { userId } = req.body;

    if (!userId) {
      return reply.status(400).send({ success: false, error: "userId is required" });
    }

    const user = findUserById(userId);
    if (!user) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);
    updateUserPasswordAndRevokeSessions(userId, passwordHash, true);

    return {
      success: true,
      data: { temporaryPassword, mustChangePassword: true },
    };
  });

  // PATCH /api/admin/users/:id/role — change a user's role
  app.patch<{ Params: { id: string }; Body: { role?: string } }>("/api/admin/users/:id/role", async (req, reply) => {
    const { id } = req.params;
    const { role } = req.body || {};

    if (role !== "admin" && role !== "user") {
      return reply.status(400).send({ success: false, error: "Invalid role" });
    }

    const user = findUserById(id);
    if (!user) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    if (role === "user" && user.role === "admin") {
      if (isProtectedUserId(id)) {
        return reply.status(400).send({ success: false, error: "Cannot demote protected user" });
      }
      if (id === req.userId) {
        return reply.status(400).send({ success: false, error: "Cannot demote yourself" });
      }
      const stmt = getDb().prepare("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'");
      stmt.step();
      const adminCount = (stmt.getAsObject() as { cnt: number }).cnt;
      stmt.free();
      if (adminCount <= 1) {
        return reply.status(400).send({ success: false, error: "Cannot demote the last admin" });
      }
    }

    updateUserRole(id, role);
    return { success: true, data: { id, role } };
  });

  // GET /api/admin/users/:id — user detail
  app.get<{ Params: { id: string } }>("/api/admin/users/:id", async (req, reply) => {
    const { id } = req.params;
    const user = findUserById(id);
    if (!user) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    const userDir = path.join(dataDir, id);
    const pageList: Array<{ name: string; currentVersion: number; updatedAt: string }> = [];
    if (fs.existsSync(userDir)) {
      const entries = fs.readdirSync(userDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const meta = readPageMeta(dataDir, id, entry.name);
        if (meta) {
          pageList.push({ name: meta.name, currentVersion: meta.currentVersion, updatedAt: meta.updatedAt });
        }
      }
    }

    return {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        storageUsed: formatSize(getUserTotalSize(dataDir, id)),
        pages: pageList,
      },
    };
  });

  // DELETE /api/admin/users/:id — delete user
  app.delete<{ Params: { id: string } }>("/api/admin/users/:id", async (req, reply) => {
    const { id } = req.params;

    if (isProtectedUserId(id)) {
      return reply.status(400).send({ success: false, error: "Cannot delete protected user" });
    }

    if (id === req.userId) {
      return reply.status(400).send({ success: false, error: "Cannot delete yourself" });
    }

    const user = findUserById(id);
    if (!user) {
      return reply.status(404).send({ success: false, error: "User not found" });
    }

    // Close all DB connections for user's pages
    const userDir = path.join(dataDir, id);
    if (fs.existsSync(userDir)) {
      const appNames = fs.readdirSync(userDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const deleteWithReservations = async (index: number): Promise<void> => {
        if (index >= appNames.length) {
          removeDirRecursive(userDir);
          deleteUserById(id);
          return;
        }
        const appName = appNames[index];
        const pageDir = path.join(userDir, appName);
        await withAppDataMaintenance(pageDir, async () => {
          closeConnectionsForPage(pageDir);
          await deleteAppObjects(id, appName);
          await deleteWithReservations(index + 1);
        });
      };
      await deleteWithReservations(0);
    } else {
      deleteUserById(id);
    }

    return { success: true, data: { deleted: true, id } };
  });

  // GET /api/admin/pages — global page list
  app.get("/api/admin/pages", async (req) => {
    const filterUserId = (req.query as any).userId as string | undefined;
    const page = Math.max(1, parseInt((req.query as any).page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query as any).limit || "20", 10)));

    const allPages: Array<{
      name: string;
      userId: string;
      description: string;
      currentVersion: number;
      totalSize: number;
      createdAt: string;
      updatedAt: string;
    }> = [];

    if (!fs.existsSync(dataDir)) {
      return { success: true, data: [], pagination: { page, limit, total: 0 } };
    }

    const userDirs = fs.readdirSync(dataDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && (!filterUserId || e.name === filterUserId));

    for (const userDir of userDirs) {
      const userPath = path.join(dataDir, userDir.name);
      const pageDirs = fs.readdirSync(userPath, { withFileTypes: true });
      for (const pageDir of pageDirs) {
        if (!pageDir.isDirectory()) continue;
        const meta = readPageMeta(dataDir, userDir.name, pageDir.name);
        if (meta) {
          const totalSize = meta.versions.reduce((sum, v) => sum + v.totalSize, 0);
          allPages.push({
            name: meta.name,
            userId: meta.userId,
            description: meta.description,
            currentVersion: meta.currentVersion,
            totalSize,
            createdAt: meta.createdAt,
            updatedAt: meta.updatedAt,
          });
        }
      }
    }

    allPages.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const total = allPages.length;
    const offset = (page - 1) * limit;
    const data = allPages.slice(offset, offset + limit);

    return { success: true, data, pagination: { page, limit, total } };
  });

  // GET /api/admin/pages/:userId/:name — page detail
  app.get<{ Params: { userId: string; name: string } }>("/api/admin/pages/:userId/:name", async (req, reply) => {
    const { userId, name } = req.params;
    const meta = readPageMeta(dataDir, userId, name);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }

    const pageDir = getPageDir(dataDir, userId, name);
    const storageUsed = fs.existsSync(pageDir) ? getDirectorySize(pageDir) : 0;

    return {
      success: true,
      data: {
        ...meta,
        storageBytes: storageUsed,
        storageUsed: formatSize(storageUsed),
      },
    };
  });

  // DELETE /api/admin/pages/:userId/:name — delete page
  app.delete<{ Params: { userId: string; name: string } }>("/api/admin/pages/:userId/:name", async (req, reply) => {
    const { userId, name } = req.params;
    const meta = readPageMeta(dataDir, userId, name);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }

    const pageDir = getPageDir(dataDir, userId, name);
    await withAppDataMaintenance(pageDir, async () => {
      closeConnectionsForPage(pageDir);
      await deleteAppObjects(userId, name);
      removeDirRecursive(pageDir);
    });

    return { success: true, data: { deleted: true, userId, name } };
  });

  // GET /api/admin/stats — system overview
  app.get("/api/admin/stats", async () => {
    let totalUsers = 0;
    let totalPages = 0;
    let totalStorage = 0;
    let totalSchemas = 0;
    const recentDeploys: Array<{ pageName: string; userId: string; version: number; createdAt: string }> = [];

    totalUsers = listUsers(1, 1).total;

    if (fs.existsSync(dataDir)) {
      const userDirs = fs.readdirSync(dataDir, { withFileTypes: true });

      for (const userDir of userDirs) {
        if (!userDir.isDirectory()) continue;
        totalStorage += getUserTotalSize(dataDir, userDir.name);
        const userPath = path.join(dataDir, userDir.name);
        const pageDirs = fs.readdirSync(userPath, { withFileTypes: true });
        for (const pageDir of pageDirs) {
          if (!pageDir.isDirectory()) continue;
          const meta = readPageMeta(dataDir, userDir.name, pageDir.name);
          if (meta) {
            totalPages++;
            if (meta.schemas) totalSchemas += meta.schemas.length;
            // Collect latest version as recent deploy
            const latestVersion = meta.versions[meta.versions.length - 1];
            if (latestVersion) {
              recentDeploys.push({
                pageName: meta.name,
                userId: meta.userId,
                version: latestVersion.version,
                createdAt: latestVersion.createdAt,
              });
            }
          }
        }
      }
    }

    recentDeploys.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      success: true,
      data: {
        users: { total: totalUsers },
        pages: { total: totalPages, totalSize: formatSize(totalStorage), totalBytes: totalStorage },
        schemas: { total: totalSchemas },
        recentDeploys: recentDeploys.slice(0, 10),
      },
    };
  });

  // --- Analytics routes ---

  function parsePeriod(period: string): string {
    if (period === "1d") return "-1 days";
    if (period === "30d") return "-30 days";
    return "-7 days";
  }

  function queryScalar(sql: string, params?: (string | number | null | Uint8Array)[]): Record<string, unknown> {
    const d = getDb();
    const stmt = d.prepare(sql);
    if (params) stmt.bind(params);
    stmt.step();
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }

  // GET /api/admin/analytics/overview?period=7d
  app.get("/api/admin/analytics/overview", async (req) => {
    const period = (req.query as any).period || "7d";
    const interval = parsePeriod(period);

    const totalRequests = (queryScalar("SELECT COUNT(*) as c FROM request_logs WHERE created_at >= datetime('now', ?)", [interval]) as { c: number }).c;
    const uniqueVisitors = (queryScalar("SELECT COUNT(DISTINCT COALESCE(visitor_id, user_id)) as c FROM request_logs WHERE created_at >= datetime('now', ?)", [interval]) as { c: number }).c;
    const pageViews = (queryScalar("SELECT COUNT(*) as c FROM page_views WHERE created_at >= datetime('now', ?)", [interval]) as { c: number }).c;
    const avgRow = queryScalar("SELECT AVG(duration_ms) as avg FROM request_logs WHERE created_at >= datetime('now', ?)", [interval]) as { avg: number | null };
    const errors = (queryScalar("SELECT COUNT(*) as c FROM request_logs WHERE status >= 400 AND created_at >= datetime('now', ?)", [interval]) as { c: number }).c;

    return {
      success: true,
      data: {
        period,
        totalRequests,
        uniqueVisitors,
        pageViews,
        avgResponseMs: avgRow.avg ? Math.round(avgRow.avg) : 0,
        errorRate: totalRequests > 0 ? Number(((errors / totalRequests) * 100).toFixed(1)) : 0,
      },
    };
  });

  // GET /api/admin/analytics/trends?range=7d
  app.get("/api/admin/analytics/trends", async (req) => {
    const range = (req.query as any).range || "7d";
    const interval = parsePeriod(range);
    const d = getDb();

    // Get dates with requests
    const reqStmt = d.prepare("SELECT DATE(created_at) as date, COUNT(*) as requests FROM request_logs WHERE created_at >= datetime('now', ?) GROUP BY DATE(created_at) ORDER BY date");
    reqStmt.bind([interval]);
    const reqByDate: Record<string, number> = {};
    while (reqStmt.step()) {
      const row = reqStmt.getAsObject() as { date: string; requests: number };
      reqByDate[row.date] = row.requests;
    }
    reqStmt.free();

    // Get page views by date
    const pvStmt = d.prepare("SELECT DATE(created_at) as date, COUNT(*) as views FROM page_views WHERE created_at >= datetime('now', ?) GROUP BY DATE(created_at)");
    pvStmt.bind([interval]);
    const pvByDate: Record<string, number> = {};
    while (pvStmt.step()) {
      const row = pvStmt.getAsObject() as { date: string; views: number };
      pvByDate[row.date] = row.views;
    }
    pvStmt.free();

    // Get new users by date
    const userStmt = d.prepare("SELECT DATE(created_at) as date, COUNT(*) as cnt FROM users WHERE created_at >= datetime('now', ?) AND provider = 'local' GROUP BY DATE(created_at)");
    userStmt.bind([interval]);
    const usersByDate: Record<string, number> = {};
    while (userStmt.step()) {
      const row = userStmt.getAsObject() as { date: string; cnt: number };
      usersByDate[row.date] = row.cnt;
    }
    userStmt.free();

    // Merge all dates
    const allDates = new Set([...Object.keys(reqByDate), ...Object.keys(pvByDate), ...Object.keys(usersByDate)]);
    const trends = [...allDates].sort().map((date) => ({
      date,
      requests: reqByDate[date] || 0,
      pageViews: pvByDate[date] || 0,
      newUsers: usersByDate[date] || 0,
    }));

    return { success: true, data: trends };
  });

  // GET /api/admin/analytics/pages?period=7d&limit=20
  app.get("/api/admin/analytics/pages", async (req) => {
    const period = (req.query as any).period || "7d";
    const limit = Math.min(100, Math.max(1, parseInt((req.query as any).limit || "20", 10)));
    const interval = parsePeriod(period);
    const d = getDb();

    const stmt = d.prepare("SELECT page_path as pagePath, COUNT(*) as views, COUNT(DISTINCT visitor_id) as uniqueVisitors FROM page_views WHERE created_at >= datetime('now', ?) GROUP BY page_path ORDER BY views DESC LIMIT ?");
    stmt.bind([interval, limit]);

    const pages: Array<{ pagePath: string; pageName: string; userId: string; views: number; uniqueVisitors: number }> = [];
    while (stmt.step()) {
      const row = stmt.getAsObject() as { pagePath: string; views: number; uniqueVisitors: number };
      const parts = row.pagePath.split("/").filter(Boolean);
      pages.push({
        pagePath: row.pagePath,
        pageName: parts[1] || row.pagePath,
        userId: parts[0] || "",
        views: row.views,
        uniqueVisitors: row.uniqueVisitors,
      });
    }
    stmt.free();

    return { success: true, data: pages };
  });

  // --- System Group Management ---

  // GET /api/admin/groups — list system groups
  app.get("/api/admin/groups", async () => {
    const groups = listSystemGroups();
    return { success: true, data: groups };
  });

  // POST /api/admin/groups — create system group
  app.post("/api/admin/groups", async (req, reply) => {
    const { name, description } = req.body as { name?: string; description?: string };
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return reply.status(400).send({ success: false, error: "Group name is required" });
    }
    try {
      const group = createGroup(name.trim(), description, BOOTSTRAP_USER_ID, true);
      return reply.status(201).send({ success: true, data: group });
    } catch (e: any) {
      if (e.message === "GROUP_NAME_EXISTS") {
        return reply.status(409).send({ success: false, error: "Group name already exists" });
      }
      throw e;
    }
  });

  // PUT /api/admin/groups/:id — update system group
  app.put<{ Params: { id: string } }>("/api/admin/groups/:id", async (req, reply) => {
    const group = findGroupById(req.params.id);
    if (!group) return reply.status(404).send({ success: false, error: "Group not found" });
    if (!group.system) return reply.status(400).send({ success: false, error: "Not a system group" });

    const { name, description } = req.body as { name?: string; description?: string };
    try {
      updateGroup(group.id, name, description);
    } catch (e: any) {
      if (e.message === "GROUP_NAME_EXISTS") {
        return reply.status(409).send({ success: false, error: "Group name already exists" });
      }
      throw e;
    }
    const updated = findGroupById(group.id);
    return { success: true, data: updated };
  });

  // POST /api/admin/groups/:id/members — add members to system group
  app.post<{ Params: { id: string } }>("/api/admin/groups/:id/members", async (req, reply) => {
    const group = findGroupById(req.params.id);
    if (!group) return reply.status(404).send({ success: false, error: "Group not found" });
    if (!group.system) return reply.status(400).send({ success: false, error: "Not a system group" });

    const { userIds } = req.body as { userIds?: string[] };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return reply.status(400).send({ success: false, error: "userIds array is required" });
    }

    addGroupMembers(group.id, userIds);
    const members = getGroupMembers(group.id);
    return { success: true, data: members };
  });

  // POST /api/admin/groups/:id/members/remove — remove members from system group
  app.post<{ Params: { id: string } }>("/api/admin/groups/:id/members/remove", async (req, reply) => {
    const group = findGroupById(req.params.id);
    if (!group) return reply.status(404).send({ success: false, error: "Group not found" });
    if (!group.system) return reply.status(400).send({ success: false, error: "Not a system group" });

    const { userIds } = req.body as { userIds?: string[] };
    if (!Array.isArray(userIds) || userIds.length === 0) {
      return reply.status(400).send({ success: false, error: "userIds array is required" });
    }

    removeGroupMembers(group.id, userIds);
    const members = getGroupMembers(group.id);
    return { success: true, data: members };
  });
}
