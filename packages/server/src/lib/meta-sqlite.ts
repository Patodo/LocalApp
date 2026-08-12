import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { ISSUE_SAVED_REPLY_LIMIT, normalizeIssueSavedReplyInput, type IssueSavedReplyInput } from "@localapp/server-core";

export const BOOTSTRAP_USER_ID = "localadmin";
export const MAX_NOTIFICATION_DELIVERY_SEQUENCE = Number.MAX_SAFE_INTEGER;

export const PROTECTED_USER_IDS = [BOOTSTRAP_USER_ID] as const;

export function isProtectedUserId(id: string): boolean {
  return (PROTECTED_USER_IDS as readonly string[]).includes(id);
}

export interface ApiKeyRecord {
  key: string;
  userId: string;
  createdAt: string;
}

export interface PeerRow {
  id: string;
  name: string;
  baseUrl: string;
  credential: string;
  acceptInsecureHttp: boolean;
  connectionVersion: number;
  verifiedUserId: string | null;
  verifiedUserName: string | null;
  verifiedUserDisplayName: string | null;
  protocolVersion: number | null;
  transferLimits: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const API_KEY_HASH_PREFIX = "sha256:";

export function apiKeyStorageValue(key: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return `${API_KEY_HASH_PREFIX}${digest}:${key.slice(-8)}`;
}

function maskStoredApiKey(storedKey: string): string {
  const suffix = storedKey.startsWith(API_KEY_HASH_PREFIX)
    ? storedKey.slice(storedKey.lastIndexOf(":") + 1)
    : storedKey.slice(-8);
  return `••••${suffix}`;
}

export interface UserRecord {
  id: string;
  name: string;
  provider: string;
  role: "admin" | "user";
  createdAt: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  mustChangePassword: boolean;
}

export interface UserRow {
  id: string;
  name: string;
  password: string;
  provider: string;
  role: string;
  created_at: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  must_change_password: number;
  auth_version: number;
  auth_generation: string;
}

export interface AuthSessionRecord {
  tokenHash: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface SavedReplyRecord {
  id: number;
  userId: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

let db: SqlJsDatabase | null = null;
let dbPath: string = "";
let SqlJs: initSqlJs.SqlJsStatic | null = null;
let publishing = false;
let commitStateUnknown: MetaDatabaseCommitStateUnknownError | null = null;

export class MetaDatabaseCommitStateUnknownError extends Error {
  readonly code = "META_DATABASE_COMMIT_STATE_UNKNOWN";

  constructor(cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Meta database commit state unknown after atomic rename: ${detail}`, { cause });
    this.name = "MetaDatabaseCommitStateUnknownError";
  }
}

export interface MetaAtomicFileOperations {
  mkdirSync: typeof fs.mkdirSync;
  openSync: typeof fs.openSync;
  writeFileSync: typeof fs.writeFileSync;
  fsyncSync: typeof fs.fsyncSync;
  closeSync: typeof fs.closeSync;
  renameSync: typeof fs.renameSync;
  rmSync: typeof fs.rmSync;
}

let atomicFileOperations: MetaAtomicFileOperations = fs;

function isWasmRuntimeError(err: unknown): boolean {
  if (typeof WebAssembly !== "undefined" && err instanceof WebAssembly.RuntimeError) return true;
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/memory access out of bounds|wasm|webassembly/i.test(message)) return true;
  const stack = err instanceof Error ? err.stack ?? "" : "";
  return /sql-wasm\.js/i.test(stack) && (message.trim() === "" || message.includes("\uFFFD"));
}

function evictMetaDbAfterRuntimeError(err: unknown): void {
  if (!isWasmRuntimeError(err)) return;
  const current = db;
  db = null;
  try {
    current?.close();
  } catch {
    // The sql.js instance may already be poisoned; recovery happens by reopening from disk.
  }
}

function guardSqlJsCall<T>(fn: () => T): T {
  try {
    return fn();
  } catch (err) {
    evictMetaDbAfterRuntimeError(err);
    throw err;
  }
}

function assertMetaDatabaseAvailable(): void {
  if (commitStateUnknown) throw commitStateUnknown;
}

function guardStatement<T extends Record<string, unknown>>(stmt: T): T {
  const target = stmt as Record<string, unknown>;
  for (const method of ["bind", "step", "get", "getAsObject", "run", "free"]) {
    const original = target[method];
    if (typeof original !== "function") continue;
    target[method] = (...args: unknown[]) => guardSqlJsCall(() => original.apply(stmt, args));
  }
  return stmt;
}

function guardDatabase(database: SqlJsDatabase): SqlJsDatabase {
  const target = database as unknown as Record<string, unknown>;
  if (target.__localappMetaGuarded) return database;
  Object.defineProperty(target, "__localappMetaGuarded", { value: true });

  for (const method of ["run", "exec", "export"]) {
    const original = target[method];
    if (typeof original !== "function") continue;
    target[method] = (...args: unknown[]) => guardSqlJsCall(() => {
      if (publishing && method !== "export") throw new Error("Meta database publication is already in progress");
      return original.apply(database, args);
    });
  }

  const originalPrepare = target.prepare;
  if (typeof originalPrepare === "function") {
    target.prepare = (...args: unknown[]) => guardStatement(guardSqlJsCall(() => {
      if (publishing) throw new Error("Meta database publication is already in progress");
      return originalPrepare.apply(database, args);
    }));
  }

  return database;
}

function openMetaDbFromDisk(): SqlJsDatabase {
  assertMetaDatabaseAvailable();
  if (!SqlJs || !dbPath) throw new Error("Meta database not initialized. Call initMetaDb first.");
  const nextDb = fs.existsSync(dbPath)
    ? new SqlJs.Database(fs.readFileSync(dbPath))
    : new SqlJs.Database();
  db = guardDatabase(nextDb);
  return db;
}

function saveDb(): void {
  assertMetaDatabaseAvailable();
  if (!db || !dbPath) return;
  if (publishing) throw new Error("Meta database publication is already in progress");
  publishing = true;
  const directory = path.dirname(dbPath);
  const temporaryPath = path.join(directory, `.${path.basename(dbPath)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let renamed = false;
  try {
    const buffer = Buffer.from(db.export());
    atomicFileOperations.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const descriptor = atomicFileOperations.openSync(temporaryPath, "wx", 0o600);
    try {
      atomicFileOperations.writeFileSync(descriptor, buffer);
      atomicFileOperations.fsyncSync(descriptor);
    } finally {
      atomicFileOperations.closeSync(descriptor);
    }
    atomicFileOperations.renameSync(temporaryPath, dbPath);
    renamed = true;
    syncMetaDirectory(directory);
  } catch (error) {
    try { atomicFileOperations.rmSync(temporaryPath, { force: true }); } catch { /* retain publication error */ }
    publishing = false;
    if (renamed) {
      const uncertain = new MetaDatabaseCommitStateUnknownError(error);
      commitStateUnknown = uncertain;
      const current = db;
      db = null;
      try { current?.close(); } catch { /* the process remains fail-stopped */ }
      throw uncertain;
    }
    reloadMetaDbFromVisibleDisk();
    throw error;
  } finally {
    publishing = false;
    try { atomicFileOperations.rmSync(temporaryPath, { force: true }); } catch { /* publication already completed */ }
  }
}

function syncMetaDirectory(directory: string): void {
  let descriptor: number | undefined;
  try {
    descriptor = atomicFileOperations.openSync(directory, "r");
    atomicFileOperations.fsyncSync(descriptor);
  } catch (error) {
    const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
    if (["EINVAL", "EPERM", "EISDIR"].includes(code ?? "")) return;
    throw error;
  } finally {
    if (descriptor !== undefined) atomicFileOperations.closeSync(descriptor);
  }
}

function reloadMetaDbFromVisibleDisk(): void {
  const current = db;
  db = null;
  try { current?.close(); } catch { /* failed publication already fails closed */ }
  if (SqlJs && dbPath) openMetaDbFromDisk();
}

export function flushMetaDb(): void {
  saveDb();
}

export function mutateMetaDbAtomically<T>(mutation: (database: SqlJsDatabase) => T): T {
  const database = getDb();
  database.run("BEGIN IMMEDIATE");
  try {
    const result = mutation(database);
    database.run("COMMIT");
    saveDb();
    return result;
  } catch (error) {
    try { database.run("ROLLBACK"); } catch { /* publication failure reloads the visible database */ }
    throw error;
  }
}

function migrateNotificationDeliverySchema(database: SqlJsDatabase): void {
  const columns = new Set(
    (database.exec("PRAGMA table_info(notifications)")[0]?.values ?? []).map((row) => String(row[1])),
  );
  if (!columns.has("delivery_seq")) {
    database.run(`
      ALTER TABLE notifications ADD COLUMN delivery_seq INTEGER CHECK (
        delivery_seq IS NULL OR
        (delivery_seq > 0 AND delivery_seq <= ${MAX_NOTIFICATION_DELIVERY_SEQUENCE})
      )
    `);
  }
  if (!columns.has("delivery_eligible")) {
    database.run(`
      ALTER TABLE notifications ADD COLUMN delivery_eligible INTEGER CHECK (
        delivery_eligible IS NULL OR delivery_eligible IN (0, 1)
      )
    `);
  }

  database.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_delivery_seq
    ON notifications(delivery_seq)
    WHERE delivery_seq IS NOT NULL
  `);
  database.run(`
    CREATE INDEX IF NOT EXISTS idx_notifications_user_delivery
    ON notifications(user_id, delivery_eligible, delivery_seq)
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS notification_delivery_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      high_water INTEGER NOT NULL CHECK (
        high_water >= 0 AND high_water <= ${MAX_NOTIFICATION_DELIVERY_SEQUENCE}
      )
    )
  `);

  const stateRows = database.exec(
    "SELECT singleton, high_water FROM notification_delivery_state ORDER BY singleton",
  )[0]?.values ?? [];
  if (stateRows.length === 0) {
    const assigned = database.exec(`
      SELECT 1 FROM notifications
      WHERE delivery_seq IS NOT NULL OR delivery_eligible IS NOT NULL
      LIMIT 1
    `)[0]?.values.length ?? 0;
    if (assigned > 0) {
      throw new Error("Notification delivery state is missing for a partial migration with assigned rows");
    }
    database.run("INSERT INTO notification_delivery_state (singleton, high_water) VALUES (1, 0)");
    return;
  }

  if (stateRows.length !== 1 || Number(stateRows[0][0]) !== 1) {
    throw new Error("Notification delivery state must contain exactly the singleton row");
  }
  const highWater = Number(stateRows[0][1]);
  if (!Number.isSafeInteger(highWater) || highWater < 0) {
    throw new Error("Notification delivery high-water is not a non-negative safe integer");
  }
  const invalidRow = database.exec(`
    SELECT 1 FROM notifications
    WHERE
      (delivery_seq IS NULL AND delivery_eligible IS NOT NULL)
      OR (delivery_seq IS NOT NULL AND delivery_eligible IS NULL)
      OR (delivery_seq IS NOT NULL AND (
        typeof(delivery_seq) != 'integer'
        OR delivery_seq <= 0
        OR delivery_seq > ${MAX_NOTIFICATION_DELIVERY_SEQUENCE}
        OR delivery_seq > ${highWater}
      ))
      OR (delivery_eligible IS NOT NULL AND delivery_eligible NOT IN (0, 1))
    LIMIT 1
  `)[0]?.values.length ?? 0;
  if (invalidRow > 0) {
    throw new Error("Notification delivery rows are inconsistent with the durable high-water");
  }
}

export async function initMetaDb(
  dataDir: string,
  options: { atomicFileOperations?: MetaAtomicFileOperations } = {},
): Promise<void> {
  assertMetaDatabaseAvailable();
  if (db) return;

  atomicFileOperations = options.atomicFileOperations ?? fs;

  if (!SqlJs) {
    SqlJs = await initSqlJs();
  }

  dbPath = path.join(dataDir, "meta.sqlite");

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = guardDatabase(new SqlJs.Database(fileBuffer));
  } else {
    db = guardDatabase(new SqlJs.Database());
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS peers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      base_url TEXT NOT NULL,
      credential TEXT NOT NULL,
      accept_insecure_http INTEGER NOT NULL DEFAULT 0,
      connection_version INTEGER NOT NULL DEFAULT 1,
      verified_user_id TEXT,
      verified_user_name TEXT,
      verified_user_display_name TEXT,
      protocol_version INTEGER,
      transfer_limits TEXT,
      verified_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  {
    const columns = db.prepare("PRAGMA table_info(peers)");
    const names: string[] = [];
    while (columns.step()) names.push(String((columns.getAsObject() as { name: string }).name));
    columns.free();
    if (!names.includes("connection_version")) db.run("ALTER TABLE peers ADD COLUMN connection_version INTEGER NOT NULL DEFAULT 1");
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS device_notification_state (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      generation INTEGER NOT NULL CHECK (generation >= 0 AND generation <= ${Number.MAX_SAFE_INTEGER})
    )
  `);
  db.run("INSERT OR IGNORE INTO device_notification_state (singleton, generation) VALUES (1, 0)");
  db.run(`
    CREATE TABLE IF NOT EXISTS device_notification_sources (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('local', 'peer')),
      target_user_id TEXT NOT NULL,
      peer_id TEXT,
      peer_connection_version INTEGER,
      source_origin TEXT NOT NULL,
      source_label TEXT NOT NULL CHECK (length(source_label) BETWEEN 1 AND 80),
      account_label TEXT NOT NULL CHECK (length(account_label) BETWEEN 1 AND 80),
      desired_enabled INTEGER NOT NULL CHECK (desired_enabled IN (0, 1)),
      encrypted_credential TEXT,
      revocation_key TEXT,
      config_generation INTEGER NOT NULL CHECK (config_generation > 0),
      status_generation INTEGER,
      status_state TEXT NOT NULL CHECK (status_state IN ('disabled', 'pending', 'connecting', 'connected', 'error')),
      status_cursor INTEGER CHECK (status_cursor IS NULL OR (status_cursor >= 0 AND status_cursor <= ${Number.MAX_SAFE_INTEGER})),
      status_last_event_at TEXT,
      status_error_code TEXT,
      status_error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (kind = 'local' AND peer_id IS NULL AND peer_connection_version IS NULL)
        OR (kind = 'peer' AND peer_id IS NOT NULL AND peer_connection_version IS NOT NULL)
      )
    )
  `);
  db.run("DROP INDEX IF EXISTS idx_device_notification_source_singleton");
  db.run(`
    DELETE FROM device_notification_sources AS duplicate
    WHERE EXISTS (
      SELECT 1 FROM device_notification_sources AS canonical
      WHERE canonical.owner_user_id = duplicate.owner_user_id
        AND canonical.kind = duplicate.kind
        AND canonical.target_user_id = duplicate.target_user_id
        AND (
          canonical.desired_enabled > duplicate.desired_enabled
          OR (canonical.desired_enabled = duplicate.desired_enabled AND canonical.created_at < duplicate.created_at)
          OR (canonical.desired_enabled = duplicate.desired_enabled AND canonical.created_at = duplicate.created_at AND canonical.id < duplicate.id)
        )
    )
  `);
  if (db.getRowsModified() > 0) {
    db.run("UPDATE device_notification_state SET generation = generation + 1 WHERE singleton = 1");
  }
  db.run(`
    CREATE UNIQUE INDEX idx_device_notification_source_singleton
    ON device_notification_sources(owner_user_id, kind, target_user_id)
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_device_notification_sources_owner ON device_notification_sources(owner_user_id, created_at, id)");

  db.run(`
    CREATE TABLE IF NOT EXISTS request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      method TEXT NOT NULL,
      status INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      user_id TEXT,
      visitor_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_request_logs_created ON request_logs(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_request_logs_path ON request_logs(path)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      page_path TEXT NOT NULL,
      visitor_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(page_path)`);

  // Add user_id column to page_views if missing
  {
    const cols = db.prepare("PRAGMA table_info(page_views)");
    const colNames: string[] = [];
    while (cols.step()) {
      const row = cols.getAsObject() as { name: string };
      colNames.push(row.name);
    }
    cols.free();
    if (!colNames.includes("user_id")) {
      db.run("ALTER TABLE page_views ADD COLUMN user_id TEXT");
    }
  }

  db.run(`CREATE INDEX IF NOT EXISTS idx_page_views_user ON page_views(user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      page_path TEXT NOT NULL,
      page_name TEXT,
      owner_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, page_path)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_favorites_user ON favorites(user_id)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      creator_id TEXT NOT NULL,
      system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (group_id, user_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      user_id TEXT NOT NULL,
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      level TEXT NOT NULL DEFAULT 'normal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, app_owner, app_name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      url TEXT,
      priority TEXT NOT NULL DEFAULT 'normal',
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT,
      deleted_at TEXT,
      delivery_seq INTEGER CHECK (
        delivery_seq IS NULL OR
        (delivery_seq > 0 AND delivery_seq <= ${MAX_NOTIFICATION_DELIVERY_SEQUENCE})
      ),
      delivery_eligible INTEGER CHECK (
        delivery_eligible IS NULL OR delivery_eligible IN (0, 1)
      )
    )
  `);
  migrateNotificationDeliverySchema(db);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_notifications_app ON notifications(app_owner, app_name)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS saved_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(user_id, title)
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_saved_replies_user ON saved_replies(user_id, updated_at DESC, id DESC)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS desktop_actions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      server_origin TEXT NOT NULL,
      app_owner TEXT NOT NULL,
      app_name TEXT NOT NULL,
      app_version TEXT,
      publisher_user_id TEXT NOT NULL,
      publisher_display_name TEXT,
      title TEXT NOT NULL,
      description TEXT,
      script TEXT NOT NULL,
      dependencies_json TEXT NOT NULL,
      input_json TEXT NOT NULL,
      timeout_seconds INTEGER NOT NULL,
      nonce TEXT NOT NULL,
      installation_id TEXT,
      status TEXT NOT NULL,
      result_json TEXT,
      error_message TEXT,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT,
      completed_at TEXT
    )
  `);
  const desktopActionColumns = new Set(
    (db.exec("PRAGMA table_info(desktop_actions)")[0]?.values ?? []).map((row) => String(row[1])),
  );
  if (!desktopActionColumns.has("permissions_json")) {
    db.run("ALTER TABLE desktop_actions ADD COLUMN permissions_json TEXT NOT NULL DEFAULT '{}'");
  }
  if (!desktopActionColumns.has("permissions_digest")) {
    db.run("ALTER TABLE desktop_actions ADD COLUMN permissions_digest TEXT NOT NULL DEFAULT ''");
  }
  db.run(`CREATE INDEX IF NOT EXISTS idx_desktop_actions_user_pending ON desktop_actions(user_id, status, created_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_desktop_actions_expiry ON desktop_actions(status, expires_at)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces(owner_id, created_at DESC)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      executable TEXT NOT NULL,
      args_json TEXT NOT NULL,
      timeout_ms INTEGER NOT NULL,
      requested_by TEXT NOT NULL,
      output_path TEXT NOT NULL,
      status TEXT NOT NULL,
      pid INTEGER,
      process_identity TEXT,
      exit_code INTEGER,
      error TEXT,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    )
  `);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_requester ON tasks(requested_by, created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace ON tasks(workspace_id, created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
  const taskColumns = db.exec("PRAGMA table_info(tasks)")[0]?.values.map((row) => String(row[1])) ?? [];
  if (!taskColumns.includes("process_identity")) db.run("ALTER TABLE tasks ADD COLUMN process_identity TEXT");

  db.run(`
    CREATE TABLE IF NOT EXISTS sync_jobs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      app_name TEXT NOT NULL,
      peer_id TEXT NOT NULL,
      sync_id TEXT NOT NULL,
      with_data INTEGER NOT NULL DEFAULT 0,
      app_version TEXT,
      package_digest TEXT,
      package_size INTEGER,
      status TEXT NOT NULL,
      history_json TEXT NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      completed_at TEXT
    )
  `);
  const syncJobColumns = db.exec("PRAGMA table_info(sync_jobs)")[0]?.values.map((row) => String(row[1])) ?? [];
  if (!syncJobColumns.includes("data_digest")) db.run("ALTER TABLE sync_jobs ADD COLUMN data_digest TEXT");
  if (!syncJobColumns.includes("data_size")) db.run("ALTER TABLE sync_jobs ADD COLUMN data_size INTEGER");
  db.run(`CREATE INDEX IF NOT EXISTS idx_sync_jobs_owner ON sync_jobs(owner_id, created_at DESC)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sync_jobs_status ON sync_jobs(status)`);

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      password TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'local',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    )
  `);
  db.run("CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id)");
  db.run("CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at)");

  db.run(`
    CREATE TRIGGER IF NOT EXISTS invalidate_device_notification_peer_update
    AFTER UPDATE OF base_url, credential, accept_insecure_http, connection_version, verified_user_id, verified_at ON peers
    WHEN EXISTS (
      SELECT 1 FROM device_notification_sources
      WHERE peer_id = OLD.id AND desired_enabled = 1
        AND (peer_connection_version != NEW.connection_version OR NEW.verified_user_id IS NULL OR target_user_id != NEW.verified_user_id)
    )
    BEGIN
      UPDATE device_notification_state SET generation = generation + 1 WHERE singleton = 1;
      UPDATE device_notification_sources
      SET desired_enabled = 0,
          config_generation = (SELECT generation FROM device_notification_state WHERE singleton = 1),
          status_generation = NULL,
          status_state = 'disabled',
          status_cursor = NULL,
          status_last_event_at = NULL,
          status_error_code = 'PEER_CONFIGURATION_CHANGED',
          status_error_message = 'Peer configuration changed',
          updated_at = NEW.updated_at
      WHERE peer_id = OLD.id AND desired_enabled = 1
        AND (peer_connection_version != NEW.connection_version OR NEW.verified_user_id IS NULL OR target_user_id != NEW.verified_user_id);
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS invalidate_device_notification_peer_delete
    BEFORE DELETE ON peers
    WHEN EXISTS (SELECT 1 FROM device_notification_sources WHERE peer_id = OLD.id)
    BEGIN
      UPDATE device_notification_state SET generation = generation + 1 WHERE singleton = 1;
      UPDATE device_notification_sources
      SET desired_enabled = 0,
          config_generation = (SELECT generation FROM device_notification_state WHERE singleton = 1),
          status_generation = NULL,
          status_state = 'disabled',
          status_cursor = NULL,
          status_last_event_at = NULL,
          status_error_code = 'PEER_DELETED',
          status_error_message = 'Peer was deleted',
          updated_at = datetime('now')
      WHERE peer_id = OLD.id;
    END
  `);
  db.run(`
    CREATE TRIGGER IF NOT EXISTS delete_device_notification_sources_with_user
    BEFORE DELETE ON users
    WHEN EXISTS (SELECT 1 FROM device_notification_sources WHERE owner_user_id = OLD.id)
    BEGIN
      UPDATE device_notification_state SET generation = generation + 1 WHERE singleton = 1;
      DELETE FROM device_notification_sources WHERE owner_user_id = OLD.id;
    END
  `);

  // Add role column if missing (migrate existing databases)
  {
    const cols = db.prepare("PRAGMA table_info(users)");
    const colNames: string[] = [];
    while (cols.step()) {
      const row = cols.getAsObject() as { name: string };
      colNames.push(row.name);
    }
    cols.free();
    if (!colNames.includes("role")) {
      db.run("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    }
    if (!colNames.includes("display_name")) {
      db.run("ALTER TABLE users ADD COLUMN display_name TEXT");
    }
    if (!colNames.includes("avatar_url")) {
      db.run("ALTER TABLE users ADD COLUMN avatar_url TEXT");
    }
    if (!colNames.includes("bio")) {
      db.run("ALTER TABLE users ADD COLUMN bio TEXT");
    }
    if (!colNames.includes("must_change_password")) {
      db.run("ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0");
    }
    if (!colNames.includes("auth_version")) {
      db.run("ALTER TABLE users ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0");
    }
    if (!colNames.includes("auth_generation")) {
      db.run("ALTER TABLE users ADD COLUMN auth_generation TEXT");
    }
    db.run("UPDATE users SET auth_generation = lower(hex(randomblob(16))) WHERE auth_generation IS NULL OR auth_generation = ''");
  }

  saveDb();

}

export function getDb(): SqlJsDatabase {
  assertMetaDatabaseAvailable();
  if (!db) return openMetaDbFromDisk();
  return db;
}

export function closeMetaDb(): void {
  if (commitStateUnknown) {
    const current = db;
    db = null;
    try { current?.close(); } catch { /* explicit shutdown clears the fail-stop latch */ }
    commitStateUnknown = null;
    publishing = false;
    return;
  }
  const current = db;
  if (current) {
    try {
      saveDb();
    } catch (err) {
      if (!isWasmRuntimeError(err)) throw err;
    }
    try {
      current.close();
    } finally {
      if (db === current) db = null;
    }
    db = null;
  }
}

function savedReplyFromRow(row: Record<string, unknown>): SavedReplyRecord {
  return {
    id: Number(row.id),
    userId: String(row.user_id),
    title: String(row.title),
    body: String(row.body),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function listSavedReplies(userId: string): SavedReplyRecord[] {
  const stmt = getDb().prepare("SELECT * FROM saved_replies WHERE user_id = ? ORDER BY updated_at DESC, id DESC");
  stmt.bind([userId]);
  const replies: SavedReplyRecord[] = [];
  while (stmt.step()) replies.push(savedReplyFromRow(stmt.getAsObject()));
  stmt.free();
  return replies;
}

export function createSavedReply(userId: string, value: IssueSavedReplyInput): SavedReplyRecord {
  const input = normalizeIssueSavedReplyInput(value);
  const d = getDb();
  const countStmt = d.prepare("SELECT COUNT(*) AS count FROM saved_replies WHERE user_id = ?");
  countStmt.bind([userId]);
  countStmt.step();
  const count = Number((countStmt.getAsObject() as { count: number }).count);
  countStmt.free();
  if (count >= ISSUE_SAVED_REPLY_LIMIT) throw new Error("SAVED_REPLY_LIMIT_EXCEEDED");
  const now = new Date().toISOString();
  try {
    d.run("INSERT INTO saved_replies (user_id, title, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [userId, input.title, input.body, now, now]);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) throw new Error("SAVED_REPLY_TITLE_CONFLICT");
    throw error;
  }
  saveDb();
  const stmt = d.prepare("SELECT * FROM saved_replies WHERE user_id = ? AND title = ?");
  stmt.bind([userId, input.title]);
  if (!stmt.step()) { stmt.free(); throw new Error("SAVED_REPLY_CREATE_FAILED"); }
  const reply = savedReplyFromRow(stmt.getAsObject());
  stmt.free();
  return reply;
}

export function updateSavedReply(userId: string, id: number, value: IssueSavedReplyInput): SavedReplyRecord | null {
  const input = normalizeIssueSavedReplyInput(value);
  const d = getDb();
  try {
    d.run("UPDATE saved_replies SET title = ?, body = ?, updated_at = ? WHERE id = ? AND user_id = ?", [input.title, input.body, new Date().toISOString(), id, userId]);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) throw new Error("SAVED_REPLY_TITLE_CONFLICT");
    throw error;
  }
  if (d.getRowsModified() === 0) return null;
  saveDb();
  const stmt = d.prepare("SELECT * FROM saved_replies WHERE id = ? AND user_id = ?");
  stmt.bind([id, userId]);
  const reply = stmt.step() ? savedReplyFromRow(stmt.getAsObject()) : null;
  stmt.free();
  return reply;
}

export function deleteSavedReply(userId: string, id: number): boolean {
  const d = getDb();
  d.run("DELETE FROM saved_replies WHERE id = ? AND user_id = ?", [id, userId]);
  const deleted = d.getRowsModified() > 0;
  if (deleted) saveDb();
  return deleted;
}

export function validateApiKey(key: string): string | null {
  const d = getDb();
  const stmt = d.prepare("SELECT user_id FROM api_keys WHERE key = ? OR key = ?");
  stmt.bind([key, apiKeyStorageValue(key)]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as { user_id: string };
    stmt.free();
    return row.user_id;
  }
  stmt.free();
  return null;
}

export function createApiKey(userId: string): ApiKeyRecord {
  const d = getDb();
  const key = randomBytes(24).toString("hex");
  const createdAt = new Date().toISOString();
  d.run("INSERT INTO api_keys (key, user_id, created_at) VALUES (?, ?, ?)", [
    apiKeyStorageValue(key),
    userId,
    createdAt,
  ]);
  saveDb();
  return { key, userId, createdAt };
}

export function listApiKeysByUser(userId: string): Array<{ key: string; createdAt: string }> {
  const d = getDb();
  const stmt = d.prepare("SELECT key, created_at FROM api_keys WHERE user_id = ?");
  stmt.bind([userId]);
  const results: Array<{ key: string; createdAt: string }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { key: string; created_at: string };
    results.push({
      key: maskStoredApiKey(row.key),
      createdAt: row.created_at,
    });
  }
  stmt.free();
  return results;
}

function peerFromRow(row: Record<string, unknown>): PeerRow {
  return {
    id: String(row.id),
    name: String(row.name),
    baseUrl: String(row.base_url),
    credential: String(row.credential),
    acceptInsecureHttp: Number(row.accept_insecure_http) === 1,
    connectionVersion: Number(row.connection_version),
    verifiedUserId: row.verified_user_id == null ? null : String(row.verified_user_id),
    verifiedUserName: row.verified_user_name == null ? null : String(row.verified_user_name),
    verifiedUserDisplayName: row.verified_user_display_name == null ? null : String(row.verified_user_display_name),
    protocolVersion: row.protocol_version == null ? null : Number(row.protocol_version),
    transferLimits: row.transfer_limits == null ? null : String(row.transfer_limits),
    verifiedAt: row.verified_at == null ? null : String(row.verified_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createPeerRecord(peer: PeerRow): PeerRow {
  const d = getDb();
  d.run(
    `INSERT INTO peers (id, name, base_url, credential, accept_insecure_http, connection_version, verified_user_id, verified_user_name, verified_user_display_name, protocol_version, transfer_limits, verified_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [peer.id, peer.name, peer.baseUrl, peer.credential, peer.acceptInsecureHttp ? 1 : 0, peer.connectionVersion, peer.verifiedUserId, peer.verifiedUserName, peer.verifiedUserDisplayName, peer.protocolVersion, peer.transferLimits, peer.verifiedAt, peer.createdAt, peer.updatedAt],
  );
  saveDb();
  return peer;
}

export function getPeerRecord(id: string): PeerRow | null {
  const stmt = getDb().prepare("SELECT * FROM peers WHERE id = ?");
  stmt.bind([id]);
  const peer = stmt.step() ? peerFromRow(stmt.getAsObject() as Record<string, unknown>) : null;
  stmt.free();
  return peer;
}

export function listPeerRecords(): PeerRow[] {
  const stmt = getDb().prepare("SELECT * FROM peers ORDER BY created_at ASC, id ASC");
  const peers: PeerRow[] = [];
  while (stmt.step()) peers.push(peerFromRow(stmt.getAsObject() as Record<string, unknown>));
  stmt.free();
  return peers;
}

export function updatePeerRecord(peer: PeerRow): PeerRow | null {
  const d = getDb();
  d.run(
    `UPDATE peers SET name = ?, base_url = ?, credential = ?, accept_insecure_http = ?, connection_version = ?, verified_user_id = ?, verified_user_name = ?, verified_user_display_name = ?, protocol_version = ?, transfer_limits = ?, verified_at = ?, updated_at = ? WHERE id = ?`,
    [peer.name, peer.baseUrl, peer.credential, peer.acceptInsecureHttp ? 1 : 0, peer.connectionVersion, peer.verifiedUserId, peer.verifiedUserName, peer.verifiedUserDisplayName, peer.protocolVersion, peer.transferLimits, peer.verifiedAt, peer.updatedAt, peer.id],
  );
  if (d.getRowsModified() === 0) return null;
  saveDb();
  return peer;
}

export function deletePeerRecord(id: string): boolean {
  const d = getDb();
  d.run("DELETE FROM peers WHERE id = ?", [id]);
  const deleted = d.getRowsModified() > 0;
  if (deleted) saveDb();
  return deleted;
}

export function updatePeerVerificationIfCurrent(input: {
  id: string;
  connectionVersion: number;
  verifiedUserId: string;
  verifiedUserName: string;
  verifiedUserDisplayName: string | null;
  protocolVersion: number;
  transferLimits: string;
  verifiedAt: string;
  updatedAt: string;
}): "updated" | "changed" | "missing" {
  const d = getDb();
  d.run(
    `UPDATE peers SET verified_user_id = ?, verified_user_name = ?, verified_user_display_name = ?, protocol_version = ?, transfer_limits = ?, verified_at = ?, updated_at = ? WHERE id = ? AND connection_version = ?`,
    [input.verifiedUserId, input.verifiedUserName, input.verifiedUserDisplayName, input.protocolVersion, input.transferLimits, input.verifiedAt, input.updatedAt, input.id, input.connectionVersion],
  );
  if (d.getRowsModified() > 0) {
    saveDb();
    return "updated";
  }
  return getPeerRecord(input.id) ? "changed" : "missing";
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    role: (row.role === "admin" ? "admin" : "user") as "admin" | "user",
    createdAt: row.created_at,
    displayName: row.display_name ?? null,
    avatarUrl: row.avatar_url ?? null,
    bio: row.bio ?? null,
    mustChangePassword: row.must_change_password === 1,
  };
}

export function createUser(id: string, name: string, passwordHash: string, provider = "local"): UserRecord {
  const d = getDb();
  const existing = d.prepare("SELECT id FROM users WHERE id = ?");
  existing.bind([id]);
  const exists = existing.step();
  existing.free();
  if (exists) throw new Error("USER_EXISTS");

  const createdAt = new Date().toISOString();
  d.run(
    "INSERT INTO users (id, name, password, provider, role, auth_generation, created_at) VALUES (?, ?, ?, ?, 'user', ?, ?)",
    [id, name, passwordHash, provider, randomBytes(16).toString("hex"), createdAt],
  );
  // Auto-join "everyone" group
  const everyoneStmt = d.prepare("SELECT id FROM groups WHERE name = 'everyone'");
  if (everyoneStmt.step()) {
    const groupRow = everyoneStmt.getAsObject() as { id: string };
    d.run("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)", [groupRow.id, id, createdAt]);
  }
  everyoneStmt.free();
  saveDb();
  return { id, name, provider, role: "user", createdAt, displayName: null, avatarUrl: null, bio: null, mustChangePassword: false };
}

export function createInitialAdmin(
  id: string,
  name: string,
  passwordHash: string,
  bootstrapApiKey?: string,
): UserRecord {
  const d = getDb();
  const createdAt = new Date().toISOString();
  let committed = false;
  d.run("BEGIN");
  try {
    const countStmt = d.prepare("SELECT COUNT(*) AS total FROM users");
    countStmt.step();
    const { total } = countStmt.getAsObject() as { total: number };
    countStmt.free();
    if (total !== 0) throw new Error("SETUP_ALREADY_COMPLETED");

    d.run(
      "INSERT INTO users (id, name, password, provider, role, auth_generation, created_at) VALUES (?, ?, ?, 'local', 'admin', ?, ?)",
      [id, name, passwordHash, randomBytes(16).toString("hex"), createdAt],
    );
    const groupId = randomBytes(10).toString("hex");
    d.run(
      "INSERT INTO groups (id, name, description, creator_id, system, created_at) VALUES (?, 'everyone', 'All users', ?, 1, ?)",
      [groupId, id, createdAt],
    );
    d.run("INSERT INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)", [groupId, id, createdAt]);
    if (bootstrapApiKey) {
      d.run("INSERT INTO api_keys (key, user_id, created_at) VALUES (?, ?, ?)", [
        apiKeyStorageValue(bootstrapApiKey),
        id,
        createdAt,
      ]);
    }
    d.run("COMMIT");
    committed = true;
    saveDb();
  } catch (error) {
    if (!committed) d.run("ROLLBACK");
    throw error;
  }

  return {
    id,
    name,
    provider: "local",
    role: "admin",
    createdAt,
    displayName: null,
    avatarUrl: null,
    bio: null,
    mustChangePassword: false,
  };
}

export function provisionUserWithApiKey(
  id: string,
  name: string,
  passwordHash: string,
  apiKey: string,
  provider = "local",
): UserRecord {
  const d = getDb();
  const existing = d.prepare("SELECT id FROM users WHERE id = ?");
  existing.bind([id]);
  const exists = existing.step();
  existing.free();
  if (exists) throw new Error("USER_EXISTS");

  const createdAt = new Date().toISOString();
  let committed = false;
  d.run("BEGIN");
  try {
    d.run(
      "INSERT INTO users (id, name, password, provider, role, must_change_password, auth_generation, created_at) VALUES (?, ?, ?, ?, 'user', 1, ?, ?)",
      [id, name, passwordHash, provider, randomBytes(16).toString("hex"), createdAt],
    );
    d.run("INSERT INTO api_keys (key, user_id, created_at) VALUES (?, ?, ?)", [
      apiKeyStorageValue(apiKey),
      id,
      createdAt,
    ]);

    const everyoneStmt = d.prepare("SELECT id FROM groups WHERE name = 'everyone'");
    if (everyoneStmt.step()) {
      const groupRow = everyoneStmt.getAsObject() as { id: string };
      d.run("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)", [
        groupRow.id,
        id,
        createdAt,
      ]);
    }
    everyoneStmt.free();

    d.run("COMMIT");
    committed = true;
    saveDb();
  } catch (error) {
    if (!committed) d.run("ROLLBACK");
    throw error;
  }

  return {
    id,
    name,
    provider,
    role: "user",
    createdAt,
    displayName: null,
    avatarUrl: null,
    bio: null,
    mustChangePassword: true,
  };
}

export function findUserById(id: string): UserRecord | null {
  const d = getDb();
  const stmt = d.prepare("SELECT id, name, password, provider, role, created_at, display_name, avatar_url, bio, must_change_password FROM users WHERE id = ?");
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as UserRow;
    stmt.free();
    return toUserRecord(row);
  }
  stmt.free();
  return null;
}

export function findUserByName(name: string): (UserRecord & { password: string; authVersion: number; authGeneration: string }) | null {
  const d = getDb();
  const stmt = d.prepare("SELECT id, name, password, provider, role, created_at, display_name, avatar_url, bio, must_change_password, auth_version, auth_generation FROM users WHERE name = ?");
  stmt.bind([name]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as unknown as UserRow;
    stmt.free();
    return {
      ...toUserRecord(row),
      password: row.password,
      authVersion: row.auth_version,
      authGeneration: row.auth_generation,
    };
  }
  stmt.free();
  return null;
}

export function getUserRole(id: string): "admin" | "user" | null {
  const user = findUserById(id);
  return user ? user.role : null;
}

export function listUsers(page: number, limit: number): { data: UserRecord[]; total: number } {
  const d = getDb();
  const countStmt = d.prepare("SELECT COUNT(*) as total FROM users");
  countStmt.step();
  const total = (countStmt.getAsObject() as { total: number }).total;
  countStmt.free();

  const offset = (page - 1) * limit;
  const stmt = d.prepare("SELECT id, name, password, provider, role, created_at, display_name, avatar_url, bio, must_change_password FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?");
  stmt.bind([limit, offset]);
  const data: UserRecord[] = [];
  while (stmt.step()) {
    data.push(toUserRecord(stmt.getAsObject() as unknown as UserRow));
  }
  stmt.free();
  return { data, total };
}

export function listAllUsersBasic(): Array<{
  id: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
}> {
  const d = getDb();
  const stmt = d.prepare("SELECT id, name, display_name, avatar_url FROM users ORDER BY created_at ASC");
  const result: Array<{ id: string; name: string; displayName: string | null; avatarUrl: string | null }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: string;
      name: string;
      display_name: string | null;
      avatar_url: string | null;
    };
    result.push({ id: row.id, name: row.name, displayName: row.display_name, avatarUrl: row.avatar_url });
  }
  stmt.free();
  return result;
}

export function listAllUsersPlatform(): Array<{
  id: string;
  name: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: "admin" | "user";
}> {
  const d = getDb();
  const stmt = d.prepare("SELECT id, name, display_name, avatar_url, role FROM users ORDER BY created_at ASC");
  const result: Array<{
    id: string;
    name: string;
    displayName: string | null;
    avatarUrl: string | null;
    role: "admin" | "user";
  }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      id: string;
      name: string;
      display_name: string | null;
      avatar_url: string | null;
      role: string;
    };
    result.push({
      id: row.id,
      name: row.name,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      role: row.role === "admin" ? "admin" : "user",
    });
  }
  stmt.free();
  return result;
}

export function updateUserProfile(id: string, displayName: string | undefined, bio: string | undefined): void {
  const d = getDb();
  if (displayName !== undefined) d.run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, id]);
  if (bio !== undefined) d.run("UPDATE users SET bio = ? WHERE id = ?", [bio, id]);
  saveDb();
}

export function updateUserPassword(id: string, passwordHash: string): void {
  updateUserPasswordAndRevokeSessions(id, passwordHash, false);
}

export function updateUserPasswordAndRevokeSessions(
  id: string,
  passwordHash: string,
  mustChangePassword: boolean,
  expectedAuthVersion?: number,
  expectedAuthGeneration?: string,
): number | null {
  const d = getDb();
  let committed = false;
  d.run("BEGIN");
  try {
    if (expectedAuthVersion === undefined || expectedAuthGeneration === undefined) {
      d.run(
        "UPDATE users SET password = ?, must_change_password = ?, auth_version = auth_version + 1 WHERE id = ?",
        [passwordHash, mustChangePassword ? 1 : 0, id],
      );
    } else {
      d.run(
        "UPDATE users SET password = ?, must_change_password = ?, auth_version = auth_version + 1 WHERE id = ? AND auth_version = ? AND auth_generation = ?",
        [passwordHash, mustChangePassword ? 1 : 0, id, expectedAuthVersion, expectedAuthGeneration],
      );
    }
    if (d.getRowsModified() === 0) {
      d.run("ROLLBACK");
      return null;
    }
    d.run("DELETE FROM auth_sessions WHERE user_id = ?", [id]);
    const versionStmt = d.prepare("SELECT auth_version FROM users WHERE id = ?");
    versionStmt.bind([id]);
    versionStmt.step();
    const authVersion = Number((versionStmt.getAsObject() as { auth_version: number }).auth_version);
    versionStmt.free();
    d.run("COMMIT");
    committed = true;
    saveDb();
    return authVersion;
  } catch (error) {
    if (!committed) d.run("ROLLBACK");
    throw error;
  }
}

function authSessionFromRow(row: Record<string, unknown>): AuthSessionRecord {
  return {
    tokenHash: String(row.token_hash),
    userId: String(row.user_id),
    createdAt: String(row.created_at),
    lastSeenAt: String(row.last_seen_at),
    expiresAt: String(row.expires_at),
  };
}

export function insertAuthSession(session: AuthSessionRecord): void {
  const d = getDb();
  d.run(
    "INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)",
    [session.tokenHash, session.userId, session.createdAt, session.lastSeenAt, session.expiresAt],
  );
  saveDb();
}

export function insertAuthSessionForUserVersion(
  session: AuthSessionRecord,
  authVersion: number,
  authGeneration: string,
): boolean {
  const d = getDb();
  d.run(
    `INSERT INTO auth_sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
     SELECT ?, id, ?, ?, ? FROM users WHERE id = ? AND auth_version = ? AND auth_generation = ?`,
    [
      session.tokenHash,
      session.createdAt,
      session.lastSeenAt,
      session.expiresAt,
      session.userId,
      authVersion,
      authGeneration,
    ],
  );
  const changed = d.getRowsModified() > 0;
  if (changed) saveDb();
  return changed;
}

export function findAuthSession(tokenHash: string): AuthSessionRecord | null {
  const stmt = getDb().prepare(
    "SELECT token_hash, user_id, created_at, last_seen_at, expires_at FROM auth_sessions WHERE token_hash = ?",
  );
  stmt.bind([tokenHash]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const session = authSessionFromRow(stmt.getAsObject());
  stmt.free();
  return session;
}

export function updateAuthSessionActivity(tokenHash: string, lastSeenAt: string, expiresAt: string): boolean {
  const d = getDb();
  d.run(
    "UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?",
    [lastSeenAt, expiresAt, tokenHash],
  );
  const changed = d.getRowsModified() > 0;
  if (changed) saveDb();
  return changed;
}

export function deleteAuthSession(tokenHash: string): boolean {
  const d = getDb();
  d.run("DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
  const changed = d.getRowsModified() > 0;
  if (changed) saveDb();
  return changed;
}

export function deleteAuthSessionsForUser(userId: string): number {
  const d = getDb();
  d.run("DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
  const changed = d.getRowsModified();
  if (changed > 0) saveDb();
  return changed;
}

export function deleteExpiredAuthSessions(now: string): number {
  const d = getDb();
  d.run("DELETE FROM auth_sessions WHERE expires_at <= ?", [now]);
  const changed = d.getRowsModified();
  if (changed > 0) saveDb();
  return changed;
}

export function updateUserAvatar(id: string, avatarUrl: string | null): void {
  const d = getDb();
  d.run("UPDATE users SET avatar_url = ? WHERE id = ?", [avatarUrl, id]);
  saveDb();
}

export function updateUserRole(id: string, role: "admin" | "user"): void {
  const d = getDb();
  d.run("UPDATE users SET role = ? WHERE id = ?", [role, id]);
  saveDb();
}

export function findUserProvider(id: string): string | null {
  const d = getDb();
  const stmt = d.prepare("SELECT provider FROM users WHERE id = ?");
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as { provider: string };
    stmt.free();
    return row.provider;
  }
  stmt.free();
  return null;
}

export function resetUserPassword(userId: string, passwordHash: string): void {
  updateUserPasswordAndRevokeSessions(userId, passwordHash, true);
}

export function clearMustChangePassword(userId: string): void {
  const d = getDb();
  d.run("UPDATE users SET must_change_password = 0 WHERE id = ?", [userId]);
  saveDb();
}

export function setMustChangePassword(userId: string): void {
  const d = getDb();
  d.run("UPDATE users SET must_change_password = 1 WHERE id = ?", [userId]);
  saveDb();
}

export function deleteUserById(id: string): boolean {
  const d = getDb();
  const stmt = d.prepare("SELECT id FROM users WHERE id = ?");
  stmt.bind([id]);
  const exists = stmt.step();
  stmt.free();
  if (!exists) return false;

  mutateMetaDbAtomically((database) => {
    database.run("DELETE FROM api_keys WHERE user_id = ?", [id]);
    database.run("DELETE FROM auth_sessions WHERE user_id = ?", [id]);
    database.run("DELETE FROM group_members WHERE user_id = ?", [id]);
    database.run("DELETE FROM users WHERE id = ?", [id]);
  });
  return true;
}

export interface RequestLogEntry {
  path: string;
  method: string;
  status: number;
  durationMs: number;
  userId: string | null;
  visitorId: string | null;
}

export interface PageViewEntry {
  pagePath: string;
  visitorId: string | null;
  userId?: string | null;
}

export function insertRequestLogs(entries: RequestLogEntry[]): void {
  if (entries.length === 0) return;
  const d = getDb();
  const stmt = d.prepare("INSERT INTO request_logs (path, method, status, duration_ms, user_id, visitor_id) VALUES (?, ?, ?, ?, ?, ?)");
  for (const e of entries) {
    stmt.run([e.path, e.method, e.status, e.durationMs, e.userId, e.visitorId]);
  }
  stmt.free();
  saveDb();
}

export function insertPageViews(entries: PageViewEntry[]): void {
  if (entries.length === 0) return;
  const d = getDb();
  const stmt = d.prepare("INSERT INTO page_views (page_path, visitor_id, user_id) VALUES (?, ?, ?)");
  for (const e of entries) {
    stmt.run([e.pagePath, e.visitorId, e.userId ?? null]);
  }
  stmt.free();
  saveDb();
}

export function cleanOldLogs(days = 30): void {
  const d = getDb();
  d.run(`DELETE FROM request_logs WHERE created_at < datetime('now', '-${days} days')`);
  d.run(`DELETE FROM page_views WHERE created_at < datetime('now', '-${days} days')`);
  saveDb();
}

// ── Group types ──

export interface GroupRecord {
  id: string;
  name: string;
  description: string | null;
  creatorId: string;
  system: boolean;
  createdAt: string;
}

export interface GroupWithMeta extends GroupRecord {
  memberCount: number;
  isCreator: boolean;
}

// ── Group CRUD ──

export function createGroup(name: string, description: string | undefined, creatorId: string, system = false): GroupRecord {
  const d = getDb();
  const existing = d.prepare("SELECT id FROM groups WHERE name = ?");
  existing.bind([name]);
  if (existing.step()) {
    existing.free();
    throw new Error("GROUP_NAME_EXISTS");
  }
  existing.free();

  const id = randomBytes(10).toString("hex");
  const createdAt = new Date().toISOString();
  d.run("INSERT INTO groups (id, name, description, creator_id, system, created_at) VALUES (?, ?, ?, ?, ?, ?)", [id, name, description ?? null, creatorId, system ? 1 : 0, createdAt]);
  // Creator auto-joins
  d.run("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)", [id, creatorId, createdAt]);
  saveDb();
  return { id, name, description: description ?? null, creatorId, system, createdAt };
}

export function findGroupById(id: string): GroupRecord | null {
  const d = getDb();
  const stmt = d.prepare("SELECT id, name, description, creator_id, system, created_at FROM groups WHERE id = ?");
  stmt.bind([id]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as { id: string; name: string; description: string | null; creator_id: string; system: number; created_at: string };
    stmt.free();
    return { id: row.id, name: row.name, description: row.description, creatorId: row.creator_id, system: row.system === 1, createdAt: row.created_at };
  }
  stmt.free();
  return null;
}

export function findGroupByName(name: string): GroupRecord | null {
  const d = getDb();
  const stmt = d.prepare("SELECT id, name, description, creator_id, system, created_at FROM groups WHERE name = ?");
  stmt.bind([name]);
  if (stmt.step()) {
    const row = stmt.getAsObject() as { id: string; name: string; description: string | null; creator_id: string; system: number; created_at: string };
    stmt.free();
    return { id: row.id, name: row.name, description: row.description, creatorId: row.creator_id, system: row.system === 1, createdAt: row.created_at };
  }
  stmt.free();
  return null;
}

export function listGroupsByUser(userId: string): GroupWithMeta[] {
  const d = getDb();
  const stmt = d.prepare(`
    SELECT g.id, g.name, g.description, g.creator_id, g.system, g.created_at,
           (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g
    WHERE g.id IN (SELECT group_id FROM group_members WHERE user_id = ?)
    ORDER BY g.system DESC, g.created_at ASC
  `);
  stmt.bind([userId]);
  const result: GroupWithMeta[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: string; name: string; description: string | null; creator_id: string; system: number; created_at: string; member_count: number };
    result.push({
      id: row.id, name: row.name, description: row.description,
      creatorId: row.creator_id, system: row.system === 1, createdAt: row.created_at,
      memberCount: row.member_count, isCreator: row.creator_id === userId,
    });
  }
  stmt.free();
  return result;
}

export function listSystemGroups(): GroupWithMeta[] {
  const d = getDb();
  const stmt = d.prepare(`
    SELECT g.id, g.name, g.description, g.creator_id, g.system, g.created_at,
           (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as member_count
    FROM groups g WHERE g.system = 1
    ORDER BY g.created_at ASC
  `);
  const result: GroupWithMeta[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: string; name: string; description: string | null; creator_id: string; system: number; created_at: string; member_count: number };
    result.push({
      id: row.id, name: row.name, description: row.description,
      creatorId: row.creator_id, system: true, createdAt: row.created_at,
      memberCount: row.member_count, isCreator: false,
    });
  }
  stmt.free();
  return result;
}

export function updateGroup(id: string, name?: string, description?: string): void {
  const d = getDb();
  if (name !== undefined) {
    const existing = d.prepare("SELECT id FROM groups WHERE name = ? AND id != ?");
    existing.bind([name, id]);
    if (existing.step()) {
      existing.free();
      throw new Error("GROUP_NAME_EXISTS");
    }
    existing.free();
    d.run("UPDATE groups SET name = ? WHERE id = ?", [name, id]);
  }
  if (description !== undefined) {
    d.run("UPDATE groups SET description = ? WHERE id = ?", [description, id]);
  }
  saveDb();
}

export function deleteGroup(id: string): void {
  const d = getDb();
  d.run("DELETE FROM group_members WHERE group_id = ?", [id]);
  d.run("DELETE FROM groups WHERE id = ?", [id]);
  saveDb();
}

// ── Group members ──

export function addGroupMembers(groupId: string, userIds: string[]): void {
  if (userIds.length === 0) return;
  const d = getDb();
  const now = new Date().toISOString();
  for (const uid of userIds) {
    d.run("INSERT OR IGNORE INTO group_members (group_id, user_id, joined_at) VALUES (?, ?, ?)", [groupId, uid, now]);
  }
  saveDb();
}

export function removeGroupMembers(groupId: string, userIds: string[]): void {
  if (userIds.length === 0) return;
  const d = getDb();
  for (const uid of userIds) {
    d.run("DELETE FROM group_members WHERE group_id = ? AND user_id = ?", [groupId, uid]);
  }
  saveDb();
}

export function getGroupMembers(groupId: string): Array<{ id: string; name: string; displayName: string | null }> {
  const d = getDb();
  const stmt = d.prepare(`
    SELECT u.id, u.name, u.display_name
    FROM group_members gm JOIN users u ON gm.user_id = u.id
    WHERE gm.group_id = ?
    ORDER BY u.name ASC
  `);
  stmt.bind([groupId]);
  const result: Array<{ id: string; name: string; displayName: string | null }> = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: string; name: string; display_name: string | null };
    result.push({ id: row.id, name: row.name, displayName: row.display_name });
  }
  stmt.free();
  return result;
}

export function isUserInGroup(userId: string, groupName: string): boolean {
  const d = getDb();
  const stmt = d.prepare(`
    SELECT 1 FROM group_members gm
    JOIN groups g ON gm.group_id = g.id
    WHERE g.name = ? AND gm.user_id = ?
  `);
  stmt.bind([groupName, userId]);
  const result = stmt.step();
  stmt.free();
  return result;
}

// ── Favorites ──

export interface FavoriteRecord {
  id: number;
  userId: string;
  pagePath: string;
  pageName: string | null;
  ownerName: string | null;
  createdAt: string;
}

export function addFavorite(userId: string, pagePath: string, pageName?: string, ownerName?: string): void {
  const d = getDb();
  d.run(
    "INSERT OR IGNORE INTO favorites (user_id, page_path, page_name, owner_name) VALUES (?, ?, ?, ?)",
    [userId, pagePath, pageName ?? null, ownerName ?? null]
  );
  saveDb();
}

export function removeFavorite(userId: string, pagePath: string): void {
  const d = getDb();
  d.run("DELETE FROM favorites WHERE user_id = ? AND page_path = ?", [userId, pagePath]);
  saveDb();
}

export function isFavorited(userId: string, pagePath: string): boolean {
  const d = getDb();
  const stmt = d.prepare("SELECT 1 FROM favorites WHERE user_id = ? AND page_path = ?");
  stmt.bind([userId, pagePath]);
  const result = stmt.step();
  stmt.free();
  return result;
}

export function getFavoriteCount(pagePath: string): number {
  const d = getDb();
  const stmt = d.prepare("SELECT COUNT(*) as cnt FROM favorites WHERE page_path = ?");
  stmt.bind([pagePath]);
  stmt.step();
  const count = (stmt.getAsObject() as { cnt: number }).cnt;
  stmt.free();
  return count;
}

export function listUserFavorites(userId: string, limit: number): FavoriteRecord[] {
  const d = getDb();
  const stmt = d.prepare(
    "SELECT id, user_id, page_path, page_name, owner_name, created_at FROM favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"
  );
  stmt.bind([userId, limit]);
  const result: FavoriteRecord[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { id: number; user_id: string; page_path: string; page_name: string | null; owner_name: string | null; created_at: string };
    result.push({
      id: row.id,
      userId: row.user_id,
      pagePath: row.page_path,
      pageName: row.page_name,
      ownerName: row.owner_name,
      createdAt: row.created_at,
    });
  }
  stmt.free();
  return result;
}

// ── Visit History ──

export interface RecentVisitRecord {
  pagePath: string;
  lastVisitedAt: string;
}

export function listRecentVisits(userId: string, limit: number): RecentVisitRecord[] {
  const d = getDb();
  const stmt = d.prepare(`
    SELECT page_path, MAX(created_at) as last_visited_at
    FROM page_views
    WHERE user_id = ?
    GROUP BY page_path
    ORDER BY last_visited_at DESC
    LIMIT ?
  `);
  stmt.bind([userId, limit]);
  const result: RecentVisitRecord[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as { page_path: string; last_visited_at: string };
    result.push({ pagePath: row.page_path, lastVisitedAt: row.last_visited_at });
  }
  stmt.free();
  return result;
}
