import { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import type { PageAccess } from "../types/models.js";
import { removeDirRecursive } from "../lib/file-utils.js";
import { validateName } from "../lib/validate-name.js";
import { getPageDir, readPageMeta, writePageMeta } from "../plugins/storage.js";
import { deleteAppObjects } from "../lib/s3-client.js";
import { closeConnectionsForPage } from "../lib/app-db.js";
import { withAppDataMaintenance } from "../lib/app-data-maintenance.js";

function shellPagePath(userId: string, name: string): string {
  return `/${userId}/${name}/`;
}

function rawAppResourcePath(userId: string, name: string): string {
  return `/serve/${userId}/${name}/`;
}

export async function pagesRoutes(app: FastifyInstance) {
  const dataDir = app.config.dataDir;

  // Create empty page
  app.post("/api/pages", async (req, reply) => {
    const userId = req.userId;
    const body = req.body as { name?: string };
    const name = body?.name;

    if (!name) {
      return reply.status(400).send({ success: false, error: "Name is required" });
    }

    const nameError = validateName(name);
    if (nameError) {
      return reply.status(400).send({ success: false, error: nameError });
    }

    // Check user-level uniqueness
    const existingMeta = readPageMeta(dataDir, userId, name);
    if (existingMeta) {
      return reply.status(409).send({ success: false, error: "Page name already exists" });
    }

    const pageDir = getPageDir(dataDir, userId, name);
    fs.mkdirSync(pageDir, { recursive: true });

    const now = new Date().toISOString();
    const meta = {
      name,
      userId,
      description: "",
      currentVersion: 0,
      createdAt: now,
      updatedAt: now,
      versions: [],
      metadata: {},
    };
    writePageMeta(dataDir, userId, name, meta);

    return {
      success: true,
      data: {
        name,
        url: shellPagePath(userId, name),
        rawUrl: rawAppResourcePath(userId, name),
        createdAt: now,
      },
    };
  });

  // List all pages for current user
  app.get("/api/pages", async (req) => {
    const userId = req.userId;
    const userDir = path.join(dataDir, userId);

    if (!fs.existsSync(userDir)) {
      return { success: true, data: [] };
    }

    const entries = fs.readdirSync(userDir, { withFileTypes: true });
    const pages = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const meta = readPageMeta(dataDir, userId, entry.name);
      if (meta) {
        pages.push({
          name: meta.name,
          currentVersion: meta.currentVersion,
          currentAppVersion: meta.currentAppVersion,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        });
      }
    }

    return { success: true, data: pages };
  });

  // Get page details
  app.get<{ Params: { name: string } }>("/api/pages/:name", async (req, reply) => {
    const { name } = req.params;
    const userId = req.userId;

    const meta = readPageMeta(dataDir, userId, name);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }

    return {
      success: true,
      data: {
        name: meta.name,
        userId: meta.userId,
        url: shellPagePath(meta.userId, meta.name),
        rawUrl: rawAppResourcePath(meta.userId, meta.name),
        currentVersion: meta.currentVersion,
        currentAppVersion: meta.currentAppVersion,
        versionCount: meta.versions.length,
        versions: meta.versions,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
      },
    };
  });

  // Update page (pageAccess)
  app.put<{ Params: { name: string } }>("/api/pages/:name", async (req, reply) => {
    const { name } = req.params;
    const userId = req.userId;
    const body = req.body as { pageAccess?: PageAccess };

    const meta = readPageMeta(dataDir, userId, name);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }

    if (meta.userId !== userId) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

    if (body.pageAccess !== undefined) {
      meta.pageAccess = body.pageAccess;
    }

    meta.updatedAt = new Date().toISOString();
    writePageMeta(dataDir, userId, name, meta);

    return { success: true, data: { name, pageAccess: meta.pageAccess } };
  });

  // Delete page
  app.delete<{ Params: { name: string } }>("/api/pages/:name", async (req, reply) => {
    const { name } = req.params;
    const userId = req.userId;

    const meta = readPageMeta(dataDir, userId, name);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }

    if (meta.userId !== userId) {
      return reply.status(403).send({ success: false, error: "Forbidden" });
    }

    const pageDir = getPageDir(dataDir, userId, name);
    await withAppDataMaintenance(pageDir, async () => {
      closeConnectionsForPage(pageDir);
      await deleteAppObjects(userId, name);
      removeDirRecursive(pageDir);
    });

    return { success: true, data: { deleted: true, name } };
  });
}
