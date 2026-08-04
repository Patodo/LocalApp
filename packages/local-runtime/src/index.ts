import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  applyPendingMigrations,
  buildContentReadResponse,
  classifyAppRuntimeError,
  closeConnectionsForPage,
  createAppNamedSqlRuntime,
  loadDefaultBackendContract,
  matchAppApiRoute,
  validateContentUpload,
  validateBackendContract,
} from "@localapp/server-core";
import {
  LOCAL_SHELL_SCRIPT,
  LOCAL_SHELL_STYLES,
} from "./shell-assets.js";

const APP_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const CONTENT_KEY_PATTERN = /^[a-zA-Z0-9._-]+$/;
const TICKET_TTL_MS = 30_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export interface LocalAppRegistration {
  id: string;
  version: string;
  versionRoot: string;
  dataRoot: string;
}

export interface LocalRuntimeOptions {
  apps: LocalAppRegistration[];
  controlToken: string;
  ticketTtlMs?: number;
  sessionTtlMs?: number;
  bodyLimit?: number;
}

export interface LocalRuntimeStats {
  registeredApps: number;
  initializedApps: number;
  failedApps: number;
}

export type LocalAppRuntimeStatus = {
  appId: string;
  status: "ready" | "unavailable" | "error";
  error?: string;
};

export type LocalRuntime = FastifyInstance & {
  runtimeStats(): LocalRuntimeStats;
};

type AppState = {
  registration: LocalAppRegistration;
  initialized: boolean;
  initializing?: Promise<void>;
  error?: string;
  dbFile: string;
  filesRoot: string;
};

type Ticket = {
  appId: string;
  expiresAt: number;
};

type Session = {
  appId: string;
  expiresAt: number;
};

export async function createLocalRuntime(
  options: LocalRuntimeOptions,
): Promise<LocalRuntime> {
  if (!options.controlToken.trim()) {
    throw new Error("Local Runtime control token is required");
  }
  const apps = new Map<string, AppState>();
  for (const registration of options.apps) {
    validateRegistration(registration);
    if (apps.has(registration.id)) {
      throw new Error(`Duplicate local application: ${registration.id}`);
    }
    apps.set(registration.id, {
      registration,
      initialized: false,
      dbFile: path.join(registration.dataRoot, "app.db"),
      filesRoot: path.join(registration.dataRoot, "files"),
    });
  }

  const tickets = new Map<string, Ticket>();
  const sessions = new Map<string, Session>();
  const server = Fastify({
    logger: false,
    bodyLimit: options.bodyLimit ?? 2 * 1024 * 1024,
    trustProxy: false,
  }) as unknown as LocalRuntime;
  server.runtimeStats = () => ({
    registeredApps: apps.size,
    initializedApps: [...apps.values()].filter((app) => app.initialized).length,
    failedApps: [...apps.values()].filter((app) => app.error).length,
  });
  server.addHook("onClose", async () => {
    for (const state of apps.values()) {
      if (state.initialized) {
        closeConnectionsForPage(state.registration.dataRoot);
      }
    }
  });

  server.addContentTypeParser(
    /^multipart\/form-data(?:;.*)?$/i,
    { parseAs: "buffer" },
    (_request, body, done) => done(null, body),
  );

  server.addHook("onRequest", async (request, reply) => {
    pruneExpired(tickets);
    pruneExpired(sessions);
    const host = parseHost(request.headers.host);
    if (!host) {
      return reply.status(421).send({ success: false, error: "Invalid local application host" });
    }
    if (host === "control.localhost") {
      if (!request.url.startsWith("/control/") && request.url !== "/health") {
        return reply.status(404).send({ success: false, error: "Not found" });
      }
      return;
    }
    if (!apps.has(host)) {
      return reply.status(421).send({ success: false, error: "Invalid local application host" });
    }
  });

  server.get("/health", async (request, reply) => {
    if (parseHost(request.headers.host) !== "control.localhost") {
      return reply.status(421).send({ success: false, error: "Invalid control host" });
    }
    if (!authorizeControl(request, options.controlToken)) {
      return reply.status(401).send({ success: false, error: "Invalid control token" });
    }
    return { success: true, data: server.runtimeStats() };
  });

  server.get("/control/apps", async (request, reply) => {
    if (!authorizeControl(request, options.controlToken)) {
      return reply.status(401).send({ success: false, error: "Invalid control token" });
    }
    return {
      success: true,
      data: {
        apps: [...apps.values()].map(appRuntimeStatus),
      },
    };
  });

  server.post("/control/apps/:appId/health", async (request, reply) => {
    if (!authorizeControl(request, options.controlToken)) {
      return reply.status(401).send({ success: false, error: "Invalid control token" });
    }
    const appId =
      isRecord(request.params) && typeof request.params.appId === "string"
        ? request.params.appId
        : undefined;
    const state = appId ? apps.get(appId) : undefined;
    if (!state) {
      return reply.status(404).send({ success: false, error: "Local application not found" });
    }
    await initializeAppState(state);
    const status = appRuntimeStatus(state);
    return reply
      .status(status.status === "ready" ? 200 : 503)
      .send({ success: status.status === "ready", data: status });
  });

  server.post("/control/tickets", async (request, reply) => {
    if (!authorizeControl(request, options.controlToken)) {
      return reply.status(401).send({ success: false, error: "Invalid control token" });
    }
    const appId = isRecord(request.body) ? request.body.appId : undefined;
    if (typeof appId !== "string" || !apps.has(appId)) {
      return reply.status(404).send({ success: false, error: "Local application not found" });
    }
    const ticket = crypto.randomBytes(32).toString("base64url");
    tickets.set(ticket, {
      appId,
      expiresAt: Date.now() + (options.ticketTtlMs ?? TICKET_TTL_MS),
    });
    const authority = parseControlAuthority(request.headers.host);
    if (!authority) {
      return reply.status(421).send({ success: false, error: "Invalid control host" });
    }
    return {
      success: true,
      data: {
        ticket,
        appId,
        url: `http://${appId}.localhost${authority.port ? `:${authority.port}` : ""}/?ticket=${encodeURIComponent(ticket)}`,
      },
    };
  });

  server.post("/control/apps/:appId/evict", async (request, reply) => {
    if (!authorizeControl(request, options.controlToken)) {
      return reply.status(401).send({ success: false, error: "Invalid control token" });
    }
    const appId =
      isRecord(request.params) && typeof request.params.appId === "string"
        ? request.params.appId
        : undefined;
    const state = appId ? apps.get(appId) : undefined;
    if (!state) {
      return reply.status(404).send({ success: false, error: "Local application not found" });
    }
    if (state.initializing) await state.initializing;
    closeConnectionsForPage(state.registration.dataRoot);
    state.initialized = false;
    state.error = undefined;
    return { success: true, data: { appId, status: "evicted" } };
  });

  server.get("/*", async (request, reply) => {
    const appId = parseAppHost(request.headers.host, apps);
    if (!appId) return reply.status(421).send({ success: false, error: "Invalid host" });
    const ticket =
      isRecord(request.query) && typeof request.query.ticket === "string"
        ? request.query.ticket
        : undefined;
    if (ticket) {
      const candidate = tickets.get(ticket);
      tickets.delete(ticket);
      if (!candidate || candidate.appId !== appId || candidate.expiresAt <= Date.now()) {
        return reply.status(401).send({ success: false, error: "Invalid or expired ticket" });
      }
      const sessionId = crypto.randomBytes(32).toString("base64url");
      sessions.set(sessionId, {
        appId,
        expiresAt: Date.now() + (options.sessionTtlMs ?? SESSION_TTL_MS),
      });
      return reply
        .header(
          "set-cookie",
          `localapp_local_session=${sessionId}; Path=/; HttpOnly; SameSite=Strict`,
        )
        .redirect("/");
    }
    if (!authenticateAppSession(request, appId, sessions)) {
      return reply.status(401).send({ success: false, error: "Local application session required" });
    }
    const state = apps.get(appId)!;
    if (!(await ensureInitialized(state, reply))) return;
    return serveStaticOrShell(state, request, reply);
  });

  server.all("/api/*", async (request, reply) => {
    const appId = parseAppHost(request.headers.host, apps);
    if (!appId) return reply.status(421).send({ success: false, error: "Invalid host" });
    if (!authenticateAppSession(request, appId, sessions)) {
      return reply.status(401).send({ success: false, error: "Local application session required" });
    }
    if (request.method !== "GET" && !hasExpectedOrigin(request, appId)) {
      return reply.status(403).send({ success: false, error: "Origin does not match application" });
    }
    const state = apps.get(appId)!;
    if (!(await ensureInitialized(state, reply))) return;
    return handleAppApi(state, request, reply);
  });

  return server;
}

async function ensureInitialized(state: AppState, reply: FastifyReply): Promise<boolean> {
  await initializeAppState(state);
  if (state.initialized) return true;
  reply.status(503).send({ success: false, error: state.error, code: "app_unavailable" });
  return false;
}

async function initializeAppState(state: AppState): Promise<void> {
  if (state.error || state.initialized) return;
  if (!state.initializing) {
    state.initializing = initializeApp(state)
      .then(() => {
        state.initialized = true;
      })
      .catch((error: unknown) => {
        state.error = error instanceof Error ? error.message : String(error);
      })
      .finally(() => {
        state.initializing = undefined;
      });
  }
  await state.initializing;
}

function appRuntimeStatus(state: AppState): LocalAppRuntimeStatus {
  if (state.error) {
    return {
      appId: state.registration.id,
      status: "error",
      error: state.error,
    };
  }
  return {
    appId: state.registration.id,
    status: state.initialized ? "ready" : "unavailable",
  };
}

async function initializeApp(state: AppState): Promise<void> {
  const indexPath = path.join(state.registration.versionRoot, "dist", "index.html");
  if (!fs.existsSync(indexPath) || !fs.statSync(indexPath).isFile()) {
    throw new Error(`Local application entry point is missing: ${indexPath}`);
  }
  fs.readFileSync(indexPath, "utf8");
  fs.mkdirSync(state.registration.dataRoot, { recursive: true });
  fs.mkdirSync(state.filesRoot, { recursive: true });
  fs.mkdirSync(path.join(state.registration.dataRoot, "backups"), { recursive: true });
  await applyPendingMigrations({
    dbPath: state.dbFile,
    migrationsDir: path.join(state.registration.versionRoot, "migrations"),
  });
  const contract = loadDefaultBackendContract(state.registration.versionRoot, {
    allowDisabledHostedActions: true,
  });
  validateBackendContract(contract);
}

async function handleAppApi(
  state: AppState,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const route = matchAppApiRoute(request.method, pathname);
  if (route.kind === "time") {
    return { success: true, data: { now: new Date().toISOString() } };
  }
  if (route.kind === "me") {
    return {
      success: true,
      data: { id: "local-user", name: "Local User", role: "owner" },
    };
  }
  if (route.kind === "action") {
    return reply.status(410).send({
      success: false,
      error:
        "Hosted backend actions are disabled. Use named SQL, transaction mutation, or a platform primitive instead.",
      code: "hosted_actions_disabled",
    });
  }
  if (
    route.kind === "named-query" ||
    route.kind === "named-mutation" ||
    route.kind === "named-mutation-transaction"
  ) {
    try {
      const contract = loadDefaultBackendContract(state.registration.versionRoot, {
        allowDisabledHostedActions: true,
      });
      const runtime = createAppNamedSqlRuntime({
        contract,
        dbPath: state.dbFile,
        context: () => ({
          visitorId: "local-user",
          ownerId: "local-user",
          now: new Date(),
        }),
      });
      const data = await runtime.execute(route, request.body);
      return { success: true, data };
    } catch (error) {
      const response = classifyAppRuntimeError(error, true);
      return reply.status(response.status).send(response.body);
    }
  }
  if (route.kind === "content-upload") {
    return handleContentUpload(state, request, reply);
  }
  if (route.kind === "content-read") {
    return handleContentRead(state, route.key, request, reply);
  }
  return reply.status(404).send({ success: false, error: "Not found" });
}

async function handleContentUpload(
  state: AppState,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!Buffer.isBuffer(request.body)) {
    return reply.status(400).send({ success: false, error: "No file provided" });
  }
  try {
    const formRequest = new Request("http://localhost/api/content/upload", {
      method: "POST",
      headers: request.headers as HeadersInit,
      body: Uint8Array.from(request.body).buffer,
    });
    const form = await formRequest.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return reply.status(400).send({ success: false, error: "No file provided" });
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const validation = validateContentUpload({
      filename: file.name || "upload.bin",
      declaredMimeType: file.type,
      bytes,
    });
    if (!validation.ok) {
      return reply.status(validation.status).send({
        success: false,
        error: validation.message,
        code: validation.code,
      });
    }
    const key = `${Date.now()}-${crypto.randomUUID()}.${validation.extension}`;
    fs.writeFileSync(path.join(state.filesRoot, key), bytes);
    return reply.status(201).send({
      success: true,
      data: { key, url: `/api/content/${encodeURIComponent(key)}` },
    });
  } catch (error) {
    return reply.status(400).send({
      success: false,
      error: error instanceof Error ? error.message : "Invalid multipart body",
    });
  }
}

function handleContentRead(
  state: AppState,
  key: string,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (!CONTENT_KEY_PATTERN.test(key)) {
    return reply.status(400).send({ success: false, error: "Invalid content key" });
  }
  const filePath = path.resolve(state.filesRoot, key);
  if (!filePath.startsWith(`${path.resolve(state.filesRoot)}${path.sep}`)) {
    return reply.status(400).send({ success: false, error: "Invalid content key" });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return reply.status(404).send({ success: false, error: "Content not found" });
  }
  const bytes = fs.readFileSync(filePath);
  const response = buildContentReadResponse({
    filename: key,
    size: bytes.length,
    rangeHeader:
      typeof request.headers.range === "string" ? request.headers.range : undefined,
  });
  reply.status(response.status).headers(response.headers);
  if (response.status === 416) return reply.send();
  return reply.send(
    response.start === null || response.end === null
      ? bytes
      : bytes.subarray(response.start, response.end + 1),
  );
}

function serveStaticOrShell(
  state: AppState,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (pathname === "/.localapp/local-shell.js") {
    return reply
      .type("text/javascript; charset=utf-8")
      .header("cache-control", "no-cache")
      .send(LOCAL_SHELL_SCRIPT);
  }
  if (pathname === "/.localapp/local-shell.css") {
    return reply
      .type("text/css; charset=utf-8")
      .header("cache-control", "no-cache")
      .send(LOCAL_SHELL_STYLES);
  }
  if (pathname === "/") {
    return serveShell(state, reply);
  }
  const distRoot = path.resolve(state.registration.versionRoot, "dist");
  const relative = pathname.replace(/^\/+/, "");
  const filePath = path.resolve(distRoot, relative);
  if (!filePath.startsWith(`${distRoot}${path.sep}`)) {
    return reply.status(400).send({ success: false, error: "Invalid asset path" });
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (path.extname(relative) === "") {
      return serveShell(state, reply);
    }
    return reply.status(404).send({ success: false, error: "Asset not found" });
  }
  return reply.type(contentType(filePath)).send(fs.createReadStream(filePath));
}

function serveShell(state: AppState, reply: FastifyReply) {
  const indexPath = path.join(state.registration.versionRoot, "dist", "index.html");
  const index = fs.readFileSync(indexPath, "utf8");
  return reply
    .type("text/html; charset=utf-8")
    .header(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    )
    .send(injectLocalShell(index, state.registration.id));
}

function injectLocalShell(index: string, appId: string): string {
  if (index.includes("data-localapp-local-shell")) return index;
  const stylesheet =
    '<link rel="stylesheet" href="/.localapp/local-shell.css">';
  const navigation =
    `<script src="/.localapp/local-shell.js"></script>` +
    `<nav data-localapp-local-shell="true" aria-label="LocalApp"><strong>${escapeHtml(
      appId,
    )}</strong><span>Local</span></nav><main data-localapp-app-container="true">`;
  const platformUi =
    '</main>' +
    '<div data-localapp-local-confirm hidden role="dialog" aria-modal="true" aria-labelledby="localapp-local-confirm-title">' +
    '<section class="localapp-local-confirm-panel">' +
    '<h2 id="localapp-local-confirm-title" data-localapp-local-confirm-title></h2>' +
    '<p data-localapp-local-confirm-message></p>' +
    '<div class="localapp-local-confirm-actions">' +
    '<button class="localapp-local-button" type="button" data-localapp-local-confirm-cancel>Cancel</button>' +
    '<button class="localapp-local-button" type="button" data-localapp-local-confirm-accept>Confirm</button>' +
    '</div></section></div>' +
    '<aside data-localapp-local-ai hidden aria-hidden="true" role="complementary" aria-label="LocalApp local AI">' +
    '<div class="localapp-local-ai-header"><h2>AI</h2>' +
    '<button class="localapp-local-ai-close" type="button" aria-label="Close AI" title="Close AI" data-localapp-local-ai-close>' +
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>' +
    '</button>' +
    '</div></aside>' +
    '<template data-localapp-native-shell="true" data-localapp-app-root="root" data-localapp-app-resource-base="/"></template>';
  return index
    .replace(/<\/head>/i, `${stylesheet}</head>`)
    .replace(/<body([^>]*)>/i, `<body$1>${navigation}`)
    .replace(/<\/body>/i, `${platformUi}</body>`);
}

function parseHost(value: string | undefined): string | null {
  if (!value) return null;
  const host = value.trim().toLowerCase();
  const hostname = host.startsWith("[")
    ? host.slice(1, host.indexOf("]"))
    : host.split(":")[0];
  if (hostname === "control.localhost") return hostname;
  const suffix = ".localhost";
  if (!hostname.endsWith(suffix)) return null;
  const appId = hostname.slice(0, -suffix.length);
  return APP_ID_PATTERN.test(appId) ? appId : null;
}

function parseAppHost(
  value: string | undefined,
  apps: Map<string, AppState>,
): string | null {
  const host = parseHost(value);
  return host && apps.has(host) ? host : null;
}

function authorizeControl(request: FastifyRequest, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`;
}

function authenticateAppSession(
  request: FastifyRequest,
  appId: string,
  sessions: Map<string, Session>,
): boolean {
  const sessionId = parseCookies(request.headers.cookie).localapp_local_session;
  if (!sessionId) return false;
  const session = sessions.get(sessionId);
  return !!session && session.appId === appId && session.expiresAt > Date.now();
}

function hasExpectedOrigin(request: FastifyRequest, appId: string): boolean {
  const origin = request.headers.origin;
  if (typeof origin !== "string") return false;
  try {
    const parsed = new URL(origin);
    return (
      parsed.protocol === "http:" &&
      parsed.hostname === `${appId}.localhost` &&
      parsed.port === parseRequestPort(request.headers.host) &&
      parsed.username === "" &&
      parsed.password === ""
    );
  } catch {
    return false;
  }
}

function parseControlAuthority(
  value: string | undefined,
): { hostname: "control.localhost"; port: string } | null {
  if (!value) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.hostname !== "control.localhost" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      (parsed.port !== "" && !/^\d+$/.test(parsed.port))
    ) {
      return null;
    }
    return { hostname: "control.localhost", port: parsed.port };
  } catch {
    return null;
  }
}

function parseRequestPort(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(`http://${value}`).port;
  } catch {
    return "";
  }
}

function pruneExpired<T extends { expiresAt: number }>(values: Map<string, T>): void {
  const now = Date.now();
  for (const [key, value] of values) {
    if (value.expiresAt <= now) values.delete(key);
  }
}

function parseCookies(value: string | undefined): Record<string, string> {
  if (!value) return {};
  return Object.fromEntries(
    value.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      return separator < 1
        ? []
        : [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
    }),
  );
}

function validateRegistration(registration: LocalAppRegistration): void {
  if (!APP_ID_PATTERN.test(registration.id)) {
    throw new Error(`Invalid local application id: ${registration.id}`);
  }
  for (const [label, value] of [
    ["versionRoot", registration.versionRoot],
    ["dataRoot", registration.dataRoot],
  ]) {
    if (!path.isAbsolute(value)) {
      throw new Error(`Local application ${label} must be absolute: ${registration.id}`);
    }
  }
  const manifestPath = path.join(registration.versionRoot, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    name?: unknown;
  };
  if (manifest.name !== registration.id) {
    throw new Error(`Local application manifest name mismatch: ${registration.id}`);
  }
}

function contentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
