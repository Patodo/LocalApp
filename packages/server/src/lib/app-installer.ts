import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  applyPendingMigrations,
  execRawSql,
  getConnection,
  loadActionManifest,
  loadBackendContract,
  parseIssueTemplatesConfig,
  PLATFORM_CAPABILITIES,
  validateActionManifest,
  validateBackendContract,
  type IssueTemplateConfig,
} from "@localapp/server-core";
import { closeConnectionsForPage } from "./app-db.js";
import { withAppDataMaintenance } from "./app-data-maintenance.js";
import {
  AppPackageValidationError,
  extractAppPackage,
  inspectAppPackage,
  type InspectedAppPackage,
} from "./app-package.js";
import {
  materializeManifest,
  mergeManifests,
  PlatformManifestValidationError,
  commitSourceManifestAndMeta,
  readManifestState,
} from "./app-manifest.js";
import { CURRENT_PLATFORM_VERSION } from "./platform-version.js";
import { countFiles, getDirectorySize, removeDirRecursive } from "./file-utils.js";
import {
  getPageDir,
  getPageMetaPath,
  readPageMeta,
  writePageMeta,
  type PageMeta,
  type PageVersionMeta,
} from "../plugins/storage.js";
import type { BusinessMetadata, CollaborationConfig, RouteAccess } from "../types/models.js";

const MAX_RETAINED_VERSIONS = 10;

export interface InstallAppPackageInput {
  dataDir: string;
  ownerId: string;
  packagePath: string;
  uploaderDisplayName?: string;
  requireExisting?: boolean;
}

export interface InstallOutcome {
  name: string;
  ownerId: string;
  localVersion: number;
  appVersion: string;
  digest: string;
  created: boolean;
  upgraded: boolean;
  idempotent: boolean;
}

export interface ActivationOutcome {
  name: string;
  ownerId: string;
  localVersion: number;
  appVersion: string;
  digest: string;
}

export class AppInstallError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly path?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AppInstallError";
  }
}

export async function installAppPackage(input: InstallAppPackageInput): Promise<InstallOutcome> {
  let inspected: InspectedAppPackage;
  try {
    inspected = await inspectAppPackage(input.packagePath);
  } catch (error) {
    if (error instanceof AppPackageValidationError) {
      throw new AppInstallError(error.code, error.message, 400, error.path, { cause: error });
    }
    throw error;
  }
  assertPlatformCompatible(inspected.metadata.platformVersion);
  const pageDir = getPageDir(input.dataDir, input.ownerId, inspected.name);
  return withAppDataMaintenance(pageDir, async () => installInspectedPackage(input, inspected, pageDir));
}

export async function activateAppVersion(input: {
  dataDir: string;
  ownerId: string;
  name: string;
  localVersion: number;
}): Promise<ActivationOutcome> {
  const pageDir = getPageDir(input.dataDir, input.ownerId, input.name);
  return withAppDataMaintenance(pageDir, async () => {
    const meta = requiredMeta(input.dataDir, input.ownerId, input.name);
    return activateVersionLocked(input.dataDir, pageDir, meta, input.localVersion, true);
  });
}

export async function rollbackAppVersion(input: {
  dataDir: string;
  ownerId: string;
  name: string;
}): Promise<ActivationOutcome> {
  const pageDir = getPageDir(input.dataDir, input.ownerId, input.name);
  return withAppDataMaintenance(pageDir, async () => {
    const meta = requiredMeta(input.dataDir, input.ownerId, input.name);
    const target = meta.previousVersion
      ?? [...meta.versions].filter((entry) => entry.version < meta.currentVersion).sort((left, right) => right.version - left.version)[0]?.version;
    if (!target || target === meta.currentVersion) {
      throw new AppInstallError("APP_ROLLBACK_UNAVAILABLE", "No previous application version is available", 409);
    }
    return activateVersionLocked(input.dataDir, pageDir, meta, target, false);
  });
}

async function installInspectedPackage(
  input: InstallAppPackageInput,
  inspected: InspectedAppPackage,
  pageDir: string,
): Promise<InstallOutcome> {
  const existing = readPageMeta(input.dataDir, input.ownerId, inspected.name);
  if (!existing && input.requireExisting) {
    throw new AppInstallError("APP_NOT_FOUND", "Page not found", 404);
  }
  if (existing?.status === "needs-migration-repair") {
    throw new AppInstallError("APP_MIGRATION_REPAIR_REQUIRED", "App is marked needs-migration-repair. Repair platform migrations before installing.", 409);
  }
  const knownIdentity = existing?.packageIdentities?.[inspected.version];
  const matchingVersion = existing?.versions.find((entry) => entry.appVersion === inspected.version);
  const knownDigest = matchingVersion?.digest ?? knownIdentity?.digest;
  if (knownDigest && knownDigest !== inspected.digest) {
    throw new AppInstallError(
      "APP_VERSION_DIGEST_CONFLICT",
      `Application version ${inspected.version} already exists with another digest`,
      409,
    );
  }
  if (knownDigest === inspected.digest && matchingVersion
    && fs.existsSync(path.join(pageDir, "versions", `v${matchingVersion.version}`))) {
    return {
      name: inspected.name,
      ownerId: input.ownerId,
      localVersion: matchingVersion.version,
      appVersion: inspected.version,
      digest: inspected.digest,
      created: false,
      upgraded: false,
      idempotent: true,
    };
  }

  const jobDir = path.join(input.dataDir, ".staging", "apps", crypto.randomUUID());
  const sourceManifest = ownerIndependentManifest(inspected.manifest);
  const extractedDir = path.join(jobDir, "package");
  const stagedVersionDir = path.join(jobDir, "version");
  fs.mkdirSync(jobDir, { recursive: true });
  const pageExisted = fs.existsSync(pageDir);
  const dbPath = path.join(pageDir, "app.db");
  const dbBackupPath = path.join(jobDir, "app.db.before-install");
  const dbExisted = fs.existsSync(dbPath);
  const previousManifestPath = path.join(pageDir, "manifest.json");
  const previousManifest = fs.existsSync(previousManifestPath) ? fs.readFileSync(previousManifestPath) : null;
  let finalVersionDir: string | undefined;
  try {
    await extractAppPackage(inspected, extractedDir);
    materializeStagedVersion(extractedDir, stagedVersionDir, sourceManifest);
    const parsed = validateStagedApplication(stagedVersionDir, sourceManifest, inspected.metadata.platformVersion);
    const baseMeta = existing ?? createEmptyMeta(inspected.name, input.ownerId);
    const platformManifest = readManifestState(pageDir, baseMeta).platformManifest;
    const effectiveManifest = mergeManifests(sourceManifest, platformManifest);
    let updatedMeta: PageMeta;
    try {
      updatedMeta = materializeManifest(baseMeta, effectiveManifest);
    } catch (error) {
      if (error instanceof PlatformManifestValidationError) {
        throw new AppInstallError("APP_MANIFEST_INVALID", error.message, 400, error.field, { cause: error });
      }
      throw error;
    }
    applyManifestMetadata(updatedMeta, parsed);

    fs.mkdirSync(pageDir, { recursive: true });
    closeConnectionsForPage(pageDir);
    if (dbExisted) fs.copyFileSync(dbPath, dbBackupPath);
    await validateMigrationHistory(pageDir, inspected);
    const migrationsDir = path.join(extractedDir, "migrations");
    if (fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir).some((entry) => entry.endsWith(".sql"))) {
      try {
        await applyPendingMigrations({
          dbPath,
          migrationsDir,
          beforeApply: () => rotateAppDbBackups(pageDir),
        });
      } catch (error) {
        const filename = isMigrationError(error) ? error.filename : undefined;
        throw new AppInstallError(
          "APP_MIGRATION_APPLY_FAILED",
          error instanceof Error ? error.message : String(error),
          400,
          filename,
          { cause: error },
        );
      } finally {
        closeConnectionsForPage(pageDir);
      }
    }

    const newVersion = Math.max(0, ...baseMeta.versions.map((entry) => entry.version), baseMeta.currentVersion) + 1;
    finalVersionDir = path.join(pageDir, "versions", `v${newVersion}`);
    if (fs.existsSync(finalVersionDir)) {
      throw new AppInstallError("APP_VERSION_STORAGE_CONFLICT", `Version directory already exists: v${newVersion}`, 409);
    }
    fs.mkdirSync(path.dirname(finalVersionDir), { recursive: true });
    fs.renameSync(stagedVersionDir, finalVersionDir);
    assertVersionHealthy(finalVersionDir);

    const now = new Date().toISOString();
    const versionEntry: PageVersionMeta = {
      version: newVersion,
      appVersion: inspected.version,
      digest: inspected.digest,
      createdAt: now,
      fileCount: countFiles(finalVersionDir),
      totalSize: getDirectorySize(finalVersionDir),
      uploaderId: input.ownerId,
      ...(input.uploaderDisplayName ? { uploaderDisplayName: input.uploaderDisplayName } : {}),
      ...(parsed.issueTemplates ? { issues: { templates: parsed.issueTemplates } } : {}),
      manifest: sourceManifest,
    };
    updatedMeta.currentVersion = newVersion;
    updatedMeta.currentAppVersion = inspected.version;
    updatedMeta.previousVersion = baseMeta.currentVersion > 0 ? baseMeta.currentVersion : undefined;
    updatedMeta.updatedAt = now;
    updatedMeta.versions = [...baseMeta.versions, versionEntry];
    updatedMeta.packageIdentities = {
      ...(baseMeta.packageIdentities ?? {}),
      [inspected.version]: { digest: inspected.digest, version: newVersion },
    };
    const allVersions = updatedMeta.versions;
    updatedMeta.versions = retainedVersions(updatedMeta);
    commitSourceManifestAndMeta(
      pageDir,
      getPageMetaPath(input.dataDir, input.ownerId, inspected.name),
      sourceManifest,
      updatedMeta,
    );
    try {
      cleanupOldVersions(pageDir, allVersions, updatedMeta.versions);
    } catch {
      // Metadata is already durable and references only retained directories.
      // A later maintenance pass can reclaim an obsolete directory safely.
    }
    return {
      name: inspected.name,
      ownerId: input.ownerId,
      localVersion: newVersion,
      appVersion: inspected.version,
      digest: inspected.digest,
      created: !existing,
      upgraded: Boolean(existing?.currentVersion),
      idempotent: false,
    };
  } catch (error) {
    closeConnectionsForPage(pageDir);
    restoreDatabase(dbPath, dbBackupPath, dbExisted);
    if (finalVersionDir) removeDirRecursive(finalVersionDir);
    if (existing) {
      if (previousManifest) fs.writeFileSync(previousManifestPath, previousManifest);
      else fs.rmSync(previousManifestPath, { force: true });
      writePageMeta(input.dataDir, input.ownerId, inspected.name, existing);
    } else if (!pageExisted) {
      removeDirRecursive(pageDir);
    }
    throw error;
  } finally {
    removeDirRecursive(jobDir);
  }
}

function activateVersionLocked(
  dataDir: string,
  pageDir: string,
  meta: PageMeta,
  localVersion: number,
  recordPrevious: boolean,
): ActivationOutcome {
  const target = meta.versions.find((entry) => entry.version === localVersion);
  if (!target || !target.appVersion || !target.digest) {
    throw new AppInstallError("APP_VERSION_NOT_FOUND", `Application version ${localVersion} was not found`, 404);
  }
  const versionDir = path.join(pageDir, "versions", `v${localVersion}`);
  assertVersionHealthy(versionDir);
  const sourceManifest = target.manifest ?? readManifestState(pageDir, meta).sourceManifest;
  const effectiveManifest = mergeManifests(sourceManifest, readManifestState(pageDir, meta).platformManifest);
  const updated = materializeManifest(meta, effectiveManifest);
  updated.currentVersion = localVersion;
  updated.currentAppVersion = target.appVersion;
  updated.previousVersion = recordPrevious && meta.currentVersion !== localVersion ? meta.currentVersion : undefined;
  updated.updatedAt = new Date().toISOString();
  commitSourceManifestAndMeta(
    pageDir,
    getPageMetaPath(dataDir, meta.userId, meta.name),
    sourceManifest,
    updated,
  );
  return {
    name: meta.name,
    ownerId: meta.userId,
    localVersion,
    appVersion: target.appVersion,
    digest: target.digest,
  };
}

function materializeStagedVersion(extractedDir: string, stagedVersionDir: string, manifest: Record<string, unknown>): void {
  const distDir = path.join(extractedDir, "dist");
  assertVersionHealthy(distDir);
  fs.mkdirSync(stagedVersionDir, { recursive: true });
  fs.cpSync(distDir, stagedVersionDir, { recursive: true });
  const backend = parseBackendConfig(manifest);
  if (backend) {
    const root = backend.root ?? "backend";
    const source = path.join(extractedDir, root);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(stagedVersionDir, root), { recursive: true });
  }
  assertVersionHealthy(stagedVersionDir);
}

function validateStagedApplication(
  stagedVersionDir: string,
  manifest: Record<string, unknown>,
  platformVersion: string,
): {
  backend?: { root?: string; include?: string[] };
  business?: Record<string, BusinessMetadata & { routeAccess?: RouteAccess }>;
  collaboration?: CollaborationConfig;
  issueTemplates?: IssueTemplateConfig[];
} {
  assertPlatformCompatible(platformVersion);
  const backend = parseBackendConfig(manifest);
  const collaboration = parseCollaborationConfig(manifest);
  const business = parseBusinessConfig(manifest);
  const issueTemplates = parseIssueTemplatesConfig(manifest);
  const mutations: Record<string, unknown> = {};
  if (backend) {
    try {
      const contract = loadBackendContract(stagedVersionDir, backend);
      validateBackendContract(contract, { requireSecurity: requiresBackendSecurity(platformVersion) });
      const actionManifest = loadActionManifest(stagedVersionDir, backend);
      if (actionManifest) validateActionManifest(actionManifest, contract);
      Object.assign(mutations, contract.mutations);
    } catch (error) {
      throw new AppInstallError("APP_BACKEND_INVALID", error instanceof Error ? error.message : String(error), 400, undefined, { cause: error });
    }
  }
  const collaborationError = validateCollaborationMutations(collaboration, mutations);
  if (collaborationError) throw new AppInstallError("APP_BACKEND_INVALID", collaborationError, 400);
  return { backend, business, collaboration, issueTemplates };
}

function applyManifestMetadata(
  meta: PageMeta,
  parsed: ReturnType<typeof validateStagedApplication>,
): void {
  if (parsed.backend) meta.backend = parsed.backend;
  else delete meta.backend;
  if (parsed.business) meta.business = parsed.business;
  else delete meta.business;
  if (parsed.collaboration) meta.collaboration = parsed.collaboration;
  else delete meta.collaboration;
  if (parsed.issueTemplates) meta.issues = { templates: parsed.issueTemplates };
  else delete meta.issues;
}

async function validateMigrationHistory(pageDir: string, inspected: InspectedAppPackage): Promise<void> {
  const dbPath = path.join(pageDir, "app.db");
  if (!fs.existsSync(dbPath)) return;
  await getConnection(dbPath);
  const table = execRawSql(dbPath, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_localapp_applied_migrations'");
  if ((table.rows ?? []).length === 0) return;
  const packageChecksums = new Map(inspected.entries
    .filter((entry) => entry.path.startsWith("migrations/"))
    .map((entry) => [path.posix.basename(entry.path), entry.sha256]));
  const applied = execRawSql(dbPath, "SELECT filename, checksum FROM _localapp_applied_migrations ORDER BY filename");
  for (const row of applied.rows ?? []) {
    const filename = String(row.filename);
    const checksum = String(row.checksum);
    const packaged = packageChecksums.get(filename);
    if (!packaged) {
      throw new AppInstallError(
        "APP_MIGRATION_CONFLICT",
        `Migration ${filename} has already been applied in production but is missing from this package. Restore the migration file instead of deleting it.`,
        409,
        filename,
      );
    }
    if (packaged !== checksum) {
      throw new AppInstallError(
        "APP_MIGRATION_CONFLICT",
        `Migration ${filename} has already been applied in production with a different checksum. Restore the original file or create a new migration.`,
        409,
        filename,
      );
    }
  }
}

function restoreDatabase(dbPath: string, backupPath: string, existed: boolean): void {
  closeConnectionsForPage(path.dirname(dbPath));
  if (existed && fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, dbPath);
  } else if (!existed) {
    fs.rmSync(dbPath, { force: true });
  }
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

function retainedVersions(meta: PageMeta): PageVersionMeta[] {
  if (meta.versions.length <= MAX_RETAINED_VERSIONS) return meta.versions;
  const protectedVersions = new Set(
    [meta.currentVersion, meta.previousVersion].filter((version): version is number => Boolean(version)),
  );
  return meta.versions
    .filter((entry) => protectedVersions.has(entry.version))
    .concat(meta.versions
      .filter((entry) => !protectedVersions.has(entry.version))
      .slice(-(MAX_RETAINED_VERSIONS - protectedVersions.size)))
    .sort((left, right) => left.version - right.version);
}

function cleanupOldVersions(
  pageDir: string,
  allVersions: readonly PageVersionMeta[],
  retained: readonly PageVersionMeta[],
): void {
  const retainedNumbers = new Set(retained.map((entry) => entry.version));
  for (const entry of allVersions) {
    if (!retainedNumbers.has(entry.version)) removeDirRecursive(path.join(pageDir, "versions", `v${entry.version}`));
  }
}

function assertVersionHealthy(versionDir: string): void {
  const indexPath = path.join(versionDir, "index.html");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(indexPath);
  } catch {
    throw new AppInstallError("APP_HEALTH_CHECK_FAILED", "Staged application is missing index.html", 400, "dist/index.html");
  }
  if (!stat.isFile()) throw new AppInstallError("APP_HEALTH_CHECK_FAILED", "Staged application index.html is not a file", 400, "dist/index.html");
}

function requiredMeta(dataDir: string, ownerId: string, name: string): PageMeta {
  const meta = readPageMeta(dataDir, ownerId, name);
  if (!meta) throw new AppInstallError("APP_NOT_FOUND", "Application not found", 404);
  return meta;
}

function createEmptyMeta(name: string, userId: string): PageMeta {
  const now = new Date().toISOString();
  return {
    name,
    userId,
    description: "",
    currentVersion: 0,
    createdAt: now,
    updatedAt: now,
    versions: [],
    metadata: {},
  };
}

function ownerIndependentManifest(manifest: Record<string, unknown>): Record<string, unknown> {
  const source = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  delete source.owner;
  delete source.ownerId;
  delete source.userId;
  return source;
}

function parseBusinessConfig(manifest: Record<string, unknown>): Record<string, BusinessMetadata & { routeAccess?: RouteAccess }> | undefined {
  return isRecord(manifest.business)
    ? manifest.business as Record<string, BusinessMetadata & { routeAccess?: RouteAccess }>
    : undefined;
}

function parseBackendConfig(manifest: Record<string, unknown>): { root?: string; include?: string[] } | undefined {
  if (!isRecord(manifest.backend)) return undefined;
  const root = typeof manifest.backend.root === "string" ? manifest.backend.root : undefined;
  const include = Array.isArray(manifest.backend.include)
    ? manifest.backend.include.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  return { root, include };
}

function parseCollaborationConfig(manifest: Record<string, unknown>): CollaborationConfig | undefined {
  if (!isRecord(manifest.collaboration)) return undefined;
  const record = manifest.collaboration;
  if (typeof record.enabled !== "boolean") {
    throw new AppInstallError("APP_MANIFEST_INVALID", "collaboration.enabled must be a boolean", 400, "collaboration.enabled");
  }
  if (!record.enabled) return { enabled: false };
  if (!isRecord(record.resources) || Object.keys(record.resources).length === 0) {
    throw new AppInstallError("APP_MANIFEST_INVALID", "collaboration.resources must declare at least one resource when collaboration.enabled is true", 400, "collaboration.resources");
  }
  const resources: NonNullable<CollaborationConfig["resources"]> = {};
  for (const [name, value] of Object.entries(record.resources)) {
    if (!isRecord(value)) {
      throw new AppInstallError("APP_MANIFEST_INVALID", `collaboration.resources.${name} must be an object`, 400, `collaboration.resources.${name}`);
    }
    if (value.mode !== undefined && value.mode !== "record-versioned") {
      throw new AppInstallError("APP_MANIFEST_INVALID", `collaboration.resources.${name}.mode only supports record-versioned`, 400, `collaboration.resources.${name}.mode`);
    }
    if (typeof value.mutation !== "string" || !value.mutation.trim()) {
      throw new AppInstallError("APP_MANIFEST_INVALID", `collaboration.resources.${name}.mutation is required`, 400, `collaboration.resources.${name}.mutation`);
    }
    if (value.history !== undefined && typeof value.history !== "boolean") {
      throw new AppInstallError("APP_MANIFEST_INVALID", `collaboration.resources.${name}.history must be a boolean`, 400, `collaboration.resources.${name}.history`);
    }
    resources[name] = {
      mode: "record-versioned",
      mutation: value.mutation,
      ...(typeof value.history === "boolean" ? { history: value.history } : {}),
    };
  }
  return { enabled: true, resources };
}

function validateCollaborationMutations(collaboration: CollaborationConfig | undefined, mutations: Record<string, unknown>): string | null {
  if (!collaboration?.enabled) return null;
  for (const [resourceName, resource] of Object.entries(collaboration.resources ?? {})) {
    if (!mutations[resource.mutation]) {
      return `collaboration.resources.${resourceName}.mutation references unknown backend mutation: ${resource.mutation}`;
    }
  }
  return null;
}

function assertPlatformCompatible(range: string): void {
  if (!isCompatiblePlatformVersion(range, CURRENT_PLATFORM_VERSION)) {
    throw new AppInstallError(
      "APP_PLATFORM_VERSION_MISMATCH",
      `Platform version mismatch. App requires ${range}, server is ${CURRENT_PLATFORM_VERSION}.`,
      400,
      "platformVersion",
    );
  }
}

function isCompatiblePlatformVersion(range: string, version: string): boolean {
  const trimmed = range.trim();
  if (trimmed.startsWith("^")) {
    const requiredMajor = parseMajor(trimmed.slice(1));
    return requiredMajor !== null && requiredMajor === parseMajor(version);
  }
  const bounded = trimmed.match(/^>=\s*(\d+(?:\.\d+)*)\s+<\s*(\d+(?:\.\d+)*)$/);
  if (!bounded) return false;
  const currentMajor = parseMajor(version);
  const minMajor = parseMajor(bounded[1]);
  const maxMajor = parseMajor(bounded[2]);
  return currentMajor !== null && minMajor !== null && maxMajor !== null && currentMajor >= minMajor && currentMajor < maxMajor;
}

function requiresBackendSecurity(platformVersion: string): boolean {
  if (!PLATFORM_CAPABILITIES.backend.securityContracts.enabled) return false;
  const required = parseVersionTuple(PLATFORM_CAPABILITIES.backend.securityContracts.requiredFromPlatformVersion);
  if (!required) return false;
  const range = platformVersion.trim();
  const match = range.match(/^\^(\d+)(?:\.(\d+))?/) ?? range.match(/^>=\s*(\d+)(?:\.(\d+))?/);
  return Boolean(match && compareVersionTuple([Number(match[1]), Number(match[2] ?? 0), 0], required) >= 0);
}

function parseVersionTuple(value: string): [number, number, number] | null {
  const match = value.match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersionTuple(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function parseMajor(value: string): number | null {
  const major = Number(value.split(".")[0]);
  return Number.isInteger(major) ? major : null;
}

function isMigrationError(error: unknown): error is Error & { filename: string } {
  return error instanceof Error && typeof (error as { filename?: unknown }).filename === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
