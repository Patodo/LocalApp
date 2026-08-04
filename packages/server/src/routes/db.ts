import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { getPageDir, readPageMeta } from "../plugins/storage.js";
import { closeConnectionsForPage, withDbQueue } from "../lib/app-db.js";
import { assertAppDataWritable } from "../lib/app-data-maintenance.js";

export async function dbRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { name?: string } }>("/api/db/snapshot", async (req, reply) => {
    const pageName = req.query.name;
    if (!pageName) {
      return reply.status(400).send({ success: false, error: "name is required" });
    }

    const pageDir = getPageDir(app.config.dataDir, req.userId, pageName);
    const meta = readPageMeta(app.config.dataDir, req.userId, pageName);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }

    const dbPath = path.join(pageDir, "app.db");
    const bytes = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : Buffer.alloc(0);
    return reply.type("application/octet-stream").send(bytes);
  });

  app.post<{ Body: { name?: string; backup?: string } }>("/api/db/restore", async (req, reply) => {
    const { name, backup } = req.body ?? {};
    if (!name || !backup) {
      return reply.status(400).send({ success: false, error: "name and backup are required" });
    }
    if (!/^v[12]$/.test(backup)) {
      return reply.status(400).send({ success: false, error: "Invalid backup" });
    }

    const pageDir = getPageDir(app.config.dataDir, req.userId, name);
    const meta = readPageMeta(app.config.dataDir, req.userId, name);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }

    const backupPath = path.join(pageDir, `app.db.backup.${backup}`);
    if (!fs.existsSync(backupPath)) {
      return reply.status(404).send({ success: false, error: `Backup ${backup} not found` });
    }

    const dbPath = path.join(pageDir, "app.db");
    await withDbQueue(dbPath, async () => {
      assertAppDataWritable(pageDir);
      closeConnectionsForPage(pageDir);
      fs.copyFileSync(backupPath, dbPath);
    });
    return { success: true, data: { name, backup } };
  });
}
