import { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { BusinessMetadata, ManifestDb, RouteAccess, ShellConfig, NotifyConfig, CollaborationConfig } from "../types/models.js";
import {
  applyPendingMigrations,
  execRawSql,
  getConnection,
  loadActionManifest,
  loadBackendContract,
  validateActionManifest,
  validateBackendContract,
  parseIssueTemplatesConfig,
  IssueTemplateConfigError,
  MigrationApplyError,
  PLATFORM_CAPABILITIES,
  type IssueTemplateConfig,
} from "@localapp/server-core";
import { closeConnectionsForPage, withDbQueue } from "../lib/app-db.js";
import { assertAppDataWritable } from "../lib/app-data-maintenance.js";
import { countFiles, getDirectorySize, removeDirRecursive } from "../lib/file-utils.js";
import {
  getPageDir,
  readPageMeta,
  writePageMeta,
  getUserTotalSize,
} from "../plugins/storage.js";
import { validateNotifyConfig } from "../lib/notify-config.js";
import { CURRENT_PLATFORM_VERSION } from "../lib/platform-version.js";
import { findUserById } from "../lib/meta-sqlite.js";
import { requestPublicOrigin } from "../lib/request-origin.js";
import {
  materializeManifest,
  mergeManifests,
  PlatformManifestValidationError,
  readManifestState,
  writeSourceManifest,
} from "../lib/app-manifest.js";

const MAX_UPLOAD_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_USER_STORAGE = 500 * 1024 * 1024; // 500MB
const MAX_VERSIONS = 10;

function shellPageUrl(baseUrl: string, userId: string, pageName: string): string {
  return `${baseUrl}/${userId}/${pageName}/`;
}

function rawAppResourceUrl(baseUrl: string, userId: string, pageName: string): string {
  return `${baseUrl}/serve/${userId}/${pageName}/`;
}

export async function uploadRoutes(app: FastifyInstance) {
  app.post("/api/upload", async (req, reply) => {
    const dataDir = app.config.dataDir;
    const userId = req.userId;
    const uploaderDisplayName = findUserById(userId)?.displayName ?? undefined;

    let pageName: string | undefined;
    let dbConfig: ManifestDb | undefined;
    let shellConfig: ShellConfig | undefined;
    let notifyConfig: NotifyConfig | undefined;
    let collaborationConfig: CollaborationConfig | undefined;
    let backendConfig: { root?: string; include?: string[] } | undefined;
    let businessConfig: Record<string, BusinessMetadata & { routeAccess?: RouteAccess }> | undefined;
    const files: Array<{ filename: string; buffer: Buffer }> = [];
    const backendFiles: Array<{ filename: string; buffer: Buffer }> = [];
    const migrations: Array<{ filename: string; buffer: Buffer }> = [];
    const migrationChecksums = new Map<string, string>();
    let manifestBundle: Record<string, unknown> | undefined;
    let issueTemplates: IssueTemplateConfig[] | undefined;
    let multipartFieldError: { path: string; error: string } | undefined;
    const filePaths = new Map<number, string>();
    const backendFilePaths = new Map<number, string>();

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "pageId") {
        pageName = String(part.value).trim();
      } else if (part.type === "field" && part.fieldname === "name") {
        pageName = String(part.value).trim();
      } else if (part.type === "field" && part.fieldname === "dbConfig") {
        try {
          dbConfig = parseMultipartObjectField(String(part.value), "dbConfig") as unknown as ManifestDb;
        } catch (error) {
          multipartFieldError ??= { path: "dbConfig", error: error instanceof Error ? error.message : String(error) };
        }
      } else if (part.type === "field" && part.fieldname === "shellConfig") {
        try {
          shellConfig = parseMultipartObjectField(String(part.value), "shellConfig") as ShellConfig;
        } catch (error) {
          multipartFieldError ??= { path: "shellConfig", error: error instanceof Error ? error.message : String(error) };
        }
      } else if (part.type === "field" && part.fieldname === "notifyConfig") {
        try {
          const parsed = parseMultipartObjectField(String(part.value), "notifyConfig");
          const validated = validateNotifyConfig(parsed);
          if (validated) {
            notifyConfig = validated;
          } else {
            multipartFieldError ??= { path: "notifyConfig", error: "notifyConfig contains invalid configuration" };
          }
        } catch (error) {
          multipartFieldError ??= { path: "notifyConfig", error: error instanceof Error ? error.message : String(error) };
        }
      } else if (part.type === "field" && part.fieldname.startsWith("filepath_")) {
        const index = parseInt(part.fieldname.slice("filepath_".length), 10);
        if (!isNaN(index)) filePaths.set(index, String(part.value).trim());
      } else if (part.type === "field" && part.fieldname.startsWith("backendFilepath_")) {
        const index = parseInt(part.fieldname.slice("backendFilepath_".length), 10);
        if (!isNaN(index)) backendFilePaths.set(index, String(part.value).trim());
      } else if (part.type === "field" && part.fieldname.startsWith("migrationChecksum_")) {
        const filename = part.fieldname.slice("migrationChecksum_".length);
        migrationChecksums.set(filename, String(part.value).trim());
      } else if (part.type === "file") {
        const buffer = await part.toBuffer();
        if (part.fieldname.startsWith("migration_")) {
          migrations.push({ filename: part.filename, buffer });
        } else if (part.fieldname === "manifest") {
          try {
            const parsed: unknown = JSON.parse(buffer.toString("utf8"));
            if (!isRecord(parsed)) throw new Error("manifest.json must contain an object");
            manifestBundle = parsed;
          } catch (error) {
            multipartFieldError ??= { path: "manifest", error: error instanceof Error ? error.message : "Invalid manifest.json" };
          }
        } else if (part.fieldname === "backendFiles") {
          backendFiles.push({ filename: part.filename, buffer });
        } else {
          files.push({ filename: part.filename, buffer });
        }
      }
    }

    if (multipartFieldError) {
      return reply.status(400).send({
        success: false,
        code: "UPLOAD_MULTIPART_FIELD_INVALID",
        path: multipartFieldError.path,
        error: multipartFieldError.error,
      });
    }

    if (files.length === 0) {
      return reply.status(400).send({ success: false, error: "No files provided" });
    }

    if (!pageName) {
      return reply.status(400).send({ success: false, error: "Page name is required" });
    }

    if (manifestBundle) {
      const platformError = validateManifestPlatformVersion(manifestBundle);
      if (platformError) {
        return reply.status(400).send({ success: false, error: platformError });
      }
      businessConfig = parseBusinessConfig(manifestBundle);
      backendConfig = parseBackendConfig(manifestBundle);
      try {
        issueTemplates = parseIssueTemplatesConfig(manifestBundle);
      } catch (error) {
        if (error instanceof IssueTemplateConfigError) {
          return reply.status(400).send({ success: false, code: error.code, path: error.path, error: error.message });
        }
        throw error;
      }
      const collaborationResult = parseCollaborationConfig(manifestBundle);
      if (collaborationResult.error) {
        return reply.status(400).send({ success: false, error: collaborationResult.error });
      }
      collaborationConfig = collaborationResult.config;
    }

    // Calculate total upload size
    let totalUploadSize = 0;
    for (const f of files) {
      totalUploadSize += f.buffer.length;
    }

    if (totalUploadSize > MAX_UPLOAD_SIZE) {
      return reply.status(413).send({ success: false, error: "Upload exceeds 50MB limit" });
    }

    // Check user storage limit
    const userStorage = getUserTotalSize(dataDir, userId);
    if (userStorage + totalUploadSize > MAX_USER_STORAGE) {
      return reply.status(413).send({ success: false, error: "User storage limit exceeded" });
    }

    // Read existing page meta
    const meta = readPageMeta(dataDir, userId, pageName);
    if (!meta) {
      return reply.status(404).send({ success: false, error: "Page not found" });
    }
    if (meta.status === "needs-migration-repair") {
      return reply.status(409).send({
        success: false,
        error: "App is marked needs-migration-repair. Repair platform migrations before uploading.",
      });
    }

    const pageDir = getPageDir(dataDir, userId, pageName);
    const existingManifestState = readManifestState(pageDir, meta);
    const sourceRuntimeManifest = manifestBundle
      ? { ...manifestBundle }
      : { ...existingManifestState.sourceManifest };
    if (sourceRuntimeManifest.db === undefined && dbConfig) sourceRuntimeManifest.db = dbConfig;
    if (sourceRuntimeManifest.shell === undefined && shellConfig) sourceRuntimeManifest.shell = shellConfig;
    if (sourceRuntimeManifest.notify === undefined && notifyConfig) sourceRuntimeManifest.notify = notifyConfig;
    const effectiveManifest = mergeManifests(
      sourceRuntimeManifest,
      existingManifestState.platformManifest,
    );
    let materializedMeta: ReturnType<typeof materializeManifest>;
    try {
      materializedMeta = materializeManifest(meta, effectiveManifest);
    } catch (error) {
      if (error instanceof PlatformManifestValidationError) {
        return reply.status(400).send({
          success: false,
          code: "UPLOAD_MANIFEST_INVALID",
          path: error.field,
          error: error.message,
        });
      }
      throw error;
    }

    // Create new version directory
    const newVersion = meta.currentVersion + 1;
    const versionsDir = path.join(pageDir, "versions");
    const versionDir = path.join(versionsDir, `v${newVersion}`);
    const stagingDir = path.join(versionsDir, `.staging-v${newVersion}`);
    fs.rmSync(stagingDir, { recursive: true, force: true });
    fs.mkdirSync(stagingDir, { recursive: true });

    // Write files to staging. The version becomes visible only after migrations succeed.
    for (let i = 0; i < files.length; i++) {
      const storePath = filePaths.get(i) || files[i].filename;
      const filePath = path.join(stagingDir, storePath);
      const fileDir = path.dirname(filePath);
      fs.mkdirSync(fileDir, { recursive: true });
      fs.writeFileSync(filePath, files[i].buffer);
    }
    for (let i = 0; i < backendFiles.length; i++) {
      const storePath = backendFilePaths.get(i) || backendFiles[i].filename;
      if (isHostedActionPath(storePath)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        return reply.status(400).send({
          success: false,
          error: `Hosted actions are disabled in stable LocalApp backend contracts: ${storePath}. Use named SQL, transaction mutation, or a platform primitive instead.`,
        });
      }
      if (!isSafeBackendPath(storePath, backendConfig)) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        return reply.status(400).send({ success: false, error: `Invalid backend contract path: ${storePath}` });
      }
      const filePath = path.join(stagingDir, storePath);
      const fileDir = path.dirname(filePath);
      fs.mkdirSync(fileDir, { recursive: true });
      fs.writeFileSync(filePath, backendFiles[i].buffer);
    }

    if (backendConfig) {
      try {
        const contract = validateUploadedBackendContract(
          stagingDir,
          backendConfig,
          requiresBackendSecurity(manifestBundle?.platformVersion),
        );
        const collaborationError = validateCollaborationMutations(collaborationConfig, contract.mutations);
        if (collaborationError) {
          fs.rmSync(stagingDir, { recursive: true, force: true });
          return reply.status(400).send({ success: false, error: collaborationError });
        }
      } catch (error) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        const message = error instanceof Error ? error.message : String(error);
        return reply.status(400).send({ success: false, error: message });
      }
    } else {
      const collaborationError = validateCollaborationMutations(collaborationConfig, {});
      if (collaborationError) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        return reply.status(400).send({ success: false, error: collaborationError });
      }
    }

    try {
      const migrationsApplied = await applyUploadMigrations(pageDir, migrations, migrationChecksums, reply);
      if (!migrationsApplied) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        return;
      }
    } catch (error) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
      if (error instanceof MigrationApplyError) {
        return reply.status(422).send({
          success: false,
          code: "UPLOAD_MIGRATION_APPLY_FAILED",
          path: error.filename,
          error: error.message,
        });
      }
      throw error;
    }

    fs.rmSync(versionDir, { recursive: true, force: true });
    fs.renameSync(stagingDir, versionDir);

    // Update meta
    const now = new Date().toISOString();
    const versionSize = getDirectorySize(versionDir);
    const fileCount = countFiles(versionDir);

    const updatedMeta = materializedMeta;
    updatedMeta.currentVersion = newVersion;
    updatedMeta.updatedAt = now;
    if (backendConfig) updatedMeta.backend = backendConfig;
    if (collaborationConfig) updatedMeta.collaboration = collaborationConfig;
    else delete updatedMeta.collaboration;
    if (businessConfig) updatedMeta.business = businessConfig;
    if (issueTemplates) updatedMeta.issues = { templates: issueTemplates };
    updatedMeta.versions.push({
      version: newVersion,
      createdAt: now,
      fileCount,
      totalSize: versionSize,
      uploaderId: userId,
      ...(uploaderDisplayName ? { uploaderDisplayName } : {}),
      ...(issueTemplates ? { issues: { templates: issueTemplates } } : {}),
    });

    if (manifestBundle) writeSourceManifest(pageDir, manifestBundle);
    writePageMeta(dataDir, userId, pageName, updatedMeta);

    // Cleanup old versions
    if (updatedMeta.versions.length > MAX_VERSIONS) {
      const toRemove = updatedMeta.versions.slice(0, updatedMeta.versions.length - MAX_VERSIONS);
      for (const v of toRemove) {
        const oldDir = path.join(pageDir, "versions", `v${v.version}`);
        removeDirRecursive(oldDir);
      }
      updatedMeta.versions = updatedMeta.versions.slice(-MAX_VERSIONS);
      writePageMeta(dataDir, userId, pageName, updatedMeta);
    }

    const baseUrl = requestPublicOrigin(req) ?? "";
    return {
      success: true,
      data: {
        name: pageName,
        url: shellPageUrl(baseUrl, userId, pageName),
        rawUrl: rawAppResourceUrl(baseUrl, userId, pageName),
        version: newVersion,
      },
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseMultipartObjectField(value: string, field: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${field} must contain valid JSON`);
  }
  if (!isRecord(parsed)) throw new Error(`${field} must contain an object`);
  return parsed;
}

function validateUploadedBackendContract(
  versionDir: string,
  backendConfig: { root?: string; include?: string[] },
  requireSecurity: boolean,
) {
  const contract = loadBackendContract(versionDir, backendConfig);
  validateBackendContract(contract, { requireSecurity });
  const actionManifest = loadActionManifest(versionDir, backendConfig);
  if (actionManifest) {
    validateActionManifest(actionManifest, contract);
  }
  return contract;
}

function requiresBackendSecurity(platformVersion: unknown): boolean {
  if (!PLATFORM_CAPABILITIES.backend.securityContracts.enabled) return false;
  if (typeof platformVersion !== "string") return false;
  const required = parseVersionTuple(
    PLATFORM_CAPABILITIES.backend.securityContracts.requiredFromPlatformVersion,
  );
  if (!required) return false;
  const range = platformVersion.trim();
  const caret = range.match(/^\^(\d+)(?:\.(\d+))?/);
  if (caret) {
    const major = Number(caret[1]);
    const minor = Number(caret[2] ?? 0);
    return compareVersionTuple([major, minor, 0], required) >= 0;
  }
  const bounded = range.match(/^>=\s*(\d+)(?:\.(\d+))?/);
  if (!bounded) return false;
  const major = Number(bounded[1]);
  const minor = Number(bounded[2] ?? 0);
  return compareVersionTuple([major, minor, 0], required) >= 0;
}

function parseVersionTuple(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersionTuple(
  left: [number, number, number],
  right: [number, number, number],
): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function parseBusinessConfig(manifest: Record<string, unknown>): Record<string, BusinessMetadata & { routeAccess?: RouteAccess }> | undefined {
  const business = manifest.business;
  if (!business || typeof business !== "object" || Array.isArray(business)) return undefined;
  return business as Record<string, BusinessMetadata & { routeAccess?: RouteAccess }>;
}

function parseBackendConfig(manifest: Record<string, unknown>): { root?: string; include?: string[] } | undefined {
  const backend = manifest.backend;
  if (!backend || typeof backend !== "object" || Array.isArray(backend)) return undefined;
  const root = typeof (backend as Record<string, unknown>).root === "string"
    ? String((backend as Record<string, unknown>).root)
    : undefined;
  const include = Array.isArray((backend as Record<string, unknown>).include)
    ? ((backend as Record<string, unknown>).include as unknown[]).filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return { root, include };
}

function parseCollaborationConfig(manifest: Record<string, unknown>): { config?: CollaborationConfig; error?: string } {
  const collaboration = manifest.collaboration;
  if (!collaboration || typeof collaboration !== "object" || Array.isArray(collaboration)) return {};
  const record = collaboration as Record<string, unknown>;
  if (typeof record.enabled !== "boolean") {
    return { error: "collaboration.enabled must be a boolean" };
  }
  if (!record.enabled) return { config: { enabled: false } };
  const resources = record.resources;
  if (!resources || typeof resources !== "object" || Array.isArray(resources)) {
    return { error: "collaboration.resources must declare at least one resource when collaboration.enabled is true" };
  }
  const parsedResources: NonNullable<CollaborationConfig["resources"]> = {};
  for (const [resourceName, value] of Object.entries(resources as Record<string, unknown>)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { error: `collaboration.resources.${resourceName} must be an object` };
    }
    const resource = value as Record<string, unknown>;
    const mode = resource.mode ?? "record-versioned";
    if (mode !== "record-versioned") {
      return { error: `collaboration.resources.${resourceName}.mode only supports record-versioned` };
    }
    if (typeof resource.mutation !== "string" || !resource.mutation.trim()) {
      return { error: `collaboration.resources.${resourceName}.mutation is required` };
    }
    if (resource.history !== undefined && typeof resource.history !== "boolean") {
      return { error: `collaboration.resources.${resourceName}.history must be a boolean` };
    }
    parsedResources[resourceName] = {
      mode,
      mutation: resource.mutation,
      ...(typeof resource.history === "boolean" ? { history: resource.history } : {}),
    };
  }
  if (Object.keys(parsedResources).length === 0) {
    return { error: "collaboration.resources must declare at least one resource when collaboration.enabled is true" };
  }
  return { config: { enabled: true, resources: parsedResources } };
}

function validateCollaborationMutations(
  collaboration: CollaborationConfig | undefined,
  mutations: Record<string, unknown>,
): string | null {
  if (!collaboration?.enabled) return null;
  for (const [resourceName, resource] of Object.entries(collaboration.resources ?? {})) {
    if (!mutations[resource.mutation]) {
      return `collaboration.resources.${resourceName}.mutation references unknown backend mutation: ${resource.mutation}`;
    }
  }
  return null;
}

function isSafeBackendPath(relativePath: string, backendConfig?: { root?: string; include?: string[] }): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.includes("..") || path.isAbsolute(normalized)) {
    return false;
  }
  if (!isBackendContractPath(normalized)) return false;
  const include = backendConfig?.include ?? [];
  if (include.length > 0) {
    return include.some((pattern) => globMatches(pattern, normalized));
  }
  const root = (backendConfig?.root ?? "backend").replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized.startsWith(`${root}/`);
}

function isBackendContractPath(relativePath: string): boolean {
  return relativePath.endsWith("/schema.json")
    || relativePath.endsWith("/queries.json")
    || relativePath.endsWith("/mutations.json")
    || ["schema.json", "queries.json", "mutations.json"].includes(relativePath);
}

function isHostedActionPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.endsWith("/actions.manifest.json")
    || normalized.endsWith("/actions.bundle.mjs")
    || normalized === "actions.manifest.json"
    || normalized === "actions.bundle.mjs"
    || /(^|\/)actions\/.+\.(?:ts|tsx|js|mjs)$/.test(normalized);
}

function globMatches(pattern: string, candidate: string): boolean {
  const source = pattern.replace(/\\/g, "/").split("/");
  const target = candidate.replace(/\\/g, "/").split("/");
  return globPartsMatch(source, target);
}

function globPartsMatch(pattern: string[], candidate: string[]): boolean {
  if (pattern.length === 0) return candidate.length === 0;
  if (pattern[0] === "**") {
    return globPartsMatch(pattern.slice(1), candidate)
      || (candidate.length > 0 && globPartsMatch(pattern, candidate.slice(1)));
  }
  if (candidate.length === 0) return false;
  return segmentMatches(pattern[0], candidate[0]) && globPartsMatch(pattern.slice(1), candidate.slice(1));
}

function segmentMatches(pattern: string, candidate: string): boolean {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`).test(candidate);
}

async function applyUploadMigrations(
  pageDir: string,
  migrations: Array<{ filename: string; buffer: Buffer }>,
  migrationChecksums: Map<string, string>,
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
): Promise<boolean> {
  const historyValid = await validateUploadedMigrationHistory(pageDir, migrationChecksums, reply);
  if (!historyValid) return false;
  if (migrations.length === 0) return true;

  for (const migration of migrations) {
    const declaredChecksum = migrationChecksums.get(migration.filename);
    if (!declaredChecksum) {
      reply.status(400).send({
        success: false,
        code: "UPLOAD_MIGRATION_INVALID",
        path: migration.filename,
        error: `Migration ${migration.filename} checksum missing`,
      });
      return false;
    }
    const actualChecksum = crypto.createHash("sha256").update(migration.buffer).digest("hex");
    if (declaredChecksum !== actualChecksum) {
      reply.status(400).send({
        success: false,
        code: "UPLOAD_MIGRATION_INVALID",
        path: migration.filename,
        error: `Migration ${migration.filename} checksum mismatch`,
      });
      return false;
    }
  }

  const migrationsDir = path.join(pageDir, ".upload-migrations");
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  fs.mkdirSync(migrationsDir, { recursive: true });
  for (const migration of migrations) {
    fs.writeFileSync(path.join(migrationsDir, migration.filename), migration.buffer);
  }
  try {
    const dbPath = path.join(pageDir, "app.db");
    await withDbQueue(dbPath, async () => {
      assertAppDataWritable(pageDir);
      closeConnectionsForPage(pageDir);
      await applyPendingMigrations({
        dbPath,
        migrationsDir,
        beforeApply: () => rotateAppDbBackups(pageDir),
      });
      closeConnectionsForPage(pageDir);
    });
  } finally {
    fs.rmSync(migrationsDir, { recursive: true, force: true });
  }
  return true;
}

async function validateUploadedMigrationHistory(
  pageDir: string,
  migrationChecksums: Map<string, string>,
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
): Promise<boolean> {
  const appDb = path.join(pageDir, "app.db");
  if (!fs.existsSync(appDb)) return true;
  await getConnection(appDb);

  const table = execRawSql(
    appDb,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_localapp_applied_migrations'",
  );
  if ((table.rows ?? []).length === 0) return true;

  const applied = execRawSql(
    appDb,
    "SELECT filename, checksum FROM _localapp_applied_migrations ORDER BY filename",
  );
  for (const row of applied.rows ?? []) {
    const filename = String(row.filename);
    const checksum = String(row.checksum);
    const uploadedChecksum = migrationChecksums.get(filename);
    if (!uploadedChecksum) {
      reply.status(409).send({
        success: false,
        code: "UPLOAD_MIGRATION_CONFLICT",
        path: filename,
        error: `Migration ${filename} has already been applied in production but is missing from this upload. Restore the migration file instead of deleting it.`,
      });
      return false;
    }
    if (uploadedChecksum !== checksum) {
      reply.status(409).send({
        success: false,
        code: "UPLOAD_MIGRATION_CONFLICT",
        path: filename,
        error: `Migration ${filename} has already been applied in production with a different checksum. Restore the original file or create a new migration.`,
      });
      return false;
    }
  }
  return true;
}

function rotateAppDbBackups(pageDir: string): void {
  const appDb = path.join(pageDir, "app.db");
  if (!fs.existsSync(appDb)) return;

  const backupV1 = path.join(pageDir, "app.db.backup.v1");
  const backupV2 = path.join(pageDir, "app.db.backup.v2");
  if (fs.existsSync(backupV2)) fs.rmSync(backupV2, { force: true });
  if (fs.existsSync(backupV1)) fs.renameSync(backupV1, backupV2);
  fs.copyFileSync(appDb, backupV1);
}

function validateManifestPlatformVersion(manifest: Record<string, unknown>): string | null {
  const required = manifest.platformVersion;
  if (required === undefined) return null;
  if (typeof required !== "string") return "Invalid platformVersion range";

  const serverVersion = readServerVersion();
  if (!isCompatiblePlatformVersion(required, serverVersion)) {
    return `Platform version mismatch. App requires ${required}, server is ${serverVersion}. Please upgrade your app to support platform ${serverVersion}.`;
  }
  return null;
}

function isCompatiblePlatformVersion(range: string, version: string): boolean {
  const trimmed = range.trim();
  if (trimmed.startsWith("^")) {
    const requiredMajor = parseMajor(trimmed.slice(1));
    return requiredMajor !== null && requiredMajor === parseMajor(version);
  }
  const boundedRange = trimmed.match(/^>=\s*(\d+(?:\.\d+)*)\s+<\s*(\d+(?:\.\d+)*)$/);
  if (boundedRange) {
    const currentMajor = parseMajor(version);
    const minMajor = parseMajor(boundedRange[1]);
    const maxMajor = parseMajor(boundedRange[2]);
    return currentMajor !== null && minMajor !== null && maxMajor !== null && currentMajor >= minMajor && currentMajor < maxMajor;
  }
  return false;
}

function parseMajor(version: string): number | null {
  const value = Number(version.split(".")[0]);
  return Number.isInteger(value) ? value : null;
}

function readServerVersion(): string {
  return CURRENT_PLATFORM_VERSION;
}
