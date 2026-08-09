import { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import fs from "node:fs";
import path from "node:path";
import { BusinessMetadata, DataSchema, PageAccess, ManifestDb, RouteAccess, ShellConfig, NotifyConfig, CollaborationConfig, AppLifecycle } from "../types/models.js";
import { getDirectorySize } from "../lib/file-utils.js";
import { initMetaDb } from "../lib/meta-sqlite.js";
import { loadConfig, type ServerConfig } from "../lib/config.js";
import type { IssueTemplateConfig } from "@localapp/server-core";

declare module "fastify" {
  interface FastifyInstance {
    config: ServerConfig;
  }
}

export interface PageMeta {
  name: string;
  userId: string;
  description: string;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  versions: Array<{
    version: number;
    createdAt: string;
    fileCount: number;
    totalSize: number;
    uploaderId?: string;
    uploaderDisplayName?: string;
    issues?: { templates: IssueTemplateConfig[] };
  }>;
  metadata: Record<string, unknown>;
  pageAccess?: PageAccess;
  schemas?: DataSchema[];
  business?: Record<string, BusinessMetadata & { routeAccess?: RouteAccess }>;
  db?: ManifestDb;
  backend?: {
    root?: string;
    include?: string[];
  };
  shell?: ShellConfig;
  notify?: NotifyConfig;
  collaboration?: CollaborationConfig;
  issues?: { templates: IssueTemplateConfig[] };
  lifecycle?: AppLifecycle;
  status?: "needs-migration-repair";
}

async function storage(app: FastifyInstance) {
  const config = app.hasDecorator("config") ? app.config : await loadConfig();
  if (!app.hasDecorator("config")) app.decorate("config", config);
  fs.mkdirSync(config.dataDir, { recursive: true });
  await initMetaDb(config.dataDir);
}

export const storagePlugin = fp(storage, { name: "storage" });

export function getPageDir(dataDir: string, userId: string, name: string): string {
  return path.join(dataDir, userId, name);
}

export function getPageMetaPath(dataDir: string, userId: string, name: string): string {
  return path.join(getPageDir(dataDir, userId, name), "meta.json");
}

export function readPageMeta(dataDir: string, userId: string, name: string): PageMeta | null {
  const metaPath = getPageMetaPath(dataDir, userId, name);
  if (!fs.existsSync(metaPath)) return null;
  return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
}

export function writePageMeta(dataDir: string, userId: string, name: string, meta: PageMeta): void {
  const metaPath = getPageMetaPath(dataDir, userId, name);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf-8");
}

export function resolveVersionPublisher(
  meta: PageMeta,
  versionNumber = meta.currentVersion,
): { userId: string; displayName?: string } {
  const version = meta.versions.find((entry) => entry.version === versionNumber);
  if (!version?.uploaderId) return { userId: meta.userId };

  return {
    userId: version.uploaderId,
    ...(version.uploaderDisplayName ? { displayName: version.uploaderDisplayName } : {}),
  };
}

export function getUserTotalSize(dataDir: string, userId: string): number {
  const userDir = path.join(dataDir, userId);
  if (!fs.existsSync(userDir)) return 0;
  return getDirectorySize(userDir);
}

export function readDbConfig(dataDir: string, userId: string, name: string): ManifestDb {
  const meta = readPageMeta(dataDir, userId, name);
  return meta?.db ?? { mode: "crud", sqlAccess: "owner", defaultAccess: { read: "public", create: "public", update: "public", delete: "public" } };
}
