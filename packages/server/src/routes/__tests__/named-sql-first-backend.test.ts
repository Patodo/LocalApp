import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadRoutes } from "../upload.js";
import { serveRoutes } from "../serve.js";
import { getConnection, getDbPath, execRawSql } from "../../lib/app-db.js";
import { closeMetaDb, initMetaDb } from "../../lib/meta-sqlite.js";
import { writePageMeta, type PageMeta } from "../../plugins/storage.js";
import type { ServerConfig } from "../../lib/config.js";

const RESOURCE_SCHEMA_URL = "https://localapp.dev/schemas/backend/resource-schema.schema.json";
const QUERIES_SCHEMA_URL = "https://localapp.dev/schemas/backend/queries.schema.json";
const MUTATIONS_SCHEMA_URL = "https://localapp.dev/schemas/backend/mutations.schema.json";

function testConfig(dataDir: string): ServerConfig {
  return {
    port: 0,
    dataDir,
    jwtSecret: "test-secret",
    bootstrapApiKey: "",
    templateRepoUrl: "",
    gitDownloadUrl: "",
    adminStaticDir: "",
    minCliVersion: "",
    releaseManifestUrl: "",
    llmApiKey: "",
    llmModel: "gpt-4o-mini",
    llmBaseUrl: "http://localhost",
    minioEndpoint: "localhost:9000",
    minioAccessKey: "minioadmin",
    minioSecretKey: "minioadmin",
    minioBucket: "localapp-content",
    adminDefaultPassword: "localadmin",
    appDataArchiveMaxBytes: 2 * 1024 * 1024 * 1024,
    appDataExpandedMaxBytes: 4 * 1024 * 1024 * 1024,
    appDataArchiveMaxFiles: 10_000,
  };
}

function pageMeta(overrides: Partial<PageMeta> = {}): PageMeta {
  const now = new Date("2026-06-25T00:00:00.000Z").toISOString();
  return {
    name: "team-workload",
    userId: "test-owner",
    description: "",
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
    versions: [{ version: 1, createdAt: now, fileCount: 1, totalSize: 1 }],
    metadata: {},
    backend: { root: "backend" },
    ...overrides,
  };
}

async function buildApp(dataDir: string): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate("config", testConfig(dataDir));
  app.decorateRequest("userId", "");
  app.decorateRequest("visitorId", null);
  app.decorateRequest("visitorName", null);
  app.decorateRequest("visitorRole", null);
  app.addHook("preHandler", async (req) => {
    (req as any).userId = "test-owner";
    (req as any).visitorId = "test-owner";
    (req as any).visitorName = "test-owner";
    (req as any).visitorRole = "user";
  });
  await app.register(multipart);
  await app.register(uploadRoutes);
  await app.register(serveRoutes);
  return app;
}

function writeContract(root: string): void {
  const resourceDir = path.join(root, "backend", "resources", "work_items");
  fs.mkdirSync(resourceDir, { recursive: true });
  fs.writeFileSync(path.join(resourceDir, "schema.json"), JSON.stringify({
    $schema: RESOURCE_SCHEMA_URL,
    name: "work_items",
    fields: {
      id: { type: "auto_increment" },
      title: { type: "string" },
    },
  }, null, 2));
  fs.writeFileSync(path.join(resourceDir, "queries.json"), JSON.stringify({
    $schema: QUERIES_SCHEMA_URL,
    queries: {
      "$work_items.list": {
        kind: "query",
        sql: "SELECT id, title FROM work_items ORDER BY id LIMIT :limit",
        params: { limit: { type: "number", required: true } },
        access: "authenticated",
        result: { mode: "page", maxRows: 100, maxBytes: 65536 },
      },
    },
  }, null, 2));
  fs.writeFileSync(path.join(resourceDir, "mutations.json"), JSON.stringify({
    $schema: MUTATIONS_SCHEMA_URL,
    mutations: {
      "$work_items.create": {
        kind: "mutation",
        sql: "INSERT INTO work_items (title) VALUES (:title)",
        params: { title: { type: "string", required: true } },
        access: "authenticated",
      },
    },
  }, null, 2));
}

function writeActionFiles(root: string): void {
  fs.writeFileSync(path.join(root, "backend", "actions.manifest.json"), JSON.stringify({
    version: 1,
    bundle: "backend/actions.bundle.mjs",
    actions: [{
      name: "workload.importWorkItems",
      exportName: "importWorkItems",
      access: "authenticated",
      input: { type: "object" },
      uses: { queries: ["$work_items.list"], mutations: ["$work_items.create"] },
    }],
  }, null, 2));
  fs.writeFileSync(
    path.join(root, "backend", "actions.bundle.mjs"),
    "export async function importWorkItems() { return { imported: 1 }; }\n",
  );
}

function multipartBody(parts: Array<{ name: string; value: string; filename?: string; type?: string }>): { body: Buffer; contentType: string } {
  const boundary = "----localapp-test-boundary";
  const chunks: string[] = [];
  for (const part of parts) {
    chunks.push(`--${boundary}\r\n`);
    chunks.push(`Content-Disposition: form-data; name="${part.name}"${part.filename ? `; filename="${part.filename}"` : ""}\r\n`);
    if (part.filename) chunks.push(`Content-Type: ${part.type ?? "application/octet-stream"}\r\n`);
    chunks.push("\r\n");
    chunks.push(part.value);
    chunks.push("\r\n");
  }
  chunks.push(`--${boundary}--\r\n`);
  return { body: Buffer.from(chunks.join("")), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("named SQL-first backend routes", () => {
  let dataDir: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-named-sql-first-"));
    await initMetaDb(dataDir);
    app = await buildApp(dataDir);
  });

  afterEach(async () => {
    await app.close();
    closeMetaDb();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("rejects uploads containing hosted action files without changing current version", async () => {
    const pageDir = path.join(dataDir, "test-owner", "team-workload");
    fs.mkdirSync(path.join(pageDir, "versions", "v1"), { recursive: true });
    fs.writeFileSync(path.join(pageDir, "versions", "v1", "index.html"), "<div>v1</div>");
    writePageMeta(dataDir, "test-owner", "team-workload", pageMeta());

    const manifest = JSON.stringify({ name: "team-workload", backend: { root: "backend" } });
    const upload = multipartBody([
      { name: "pageId", value: "team-workload" },
      { name: "manifest", filename: "manifest.json", type: "application/json", value: manifest },
      { name: "filepath_0", value: "index.html" },
      { name: "file", filename: "index.html", type: "text/html", value: "<div>v2</div>" },
      { name: "backendFilepath_0", value: "backend/actions.manifest.json" },
      {
        name: "backendFiles",
        filename: "actions.manifest.json",
        type: "application/json",
        value: JSON.stringify({ version: 1, bundle: "backend/actions.bundle.mjs", actions: [] }),
      },
    ]);

    const response = await app.inject({
      method: "POST",
      url: "/api/upload",
      headers: { "content-type": upload.contentType },
      payload: upload.body,
    });

    expect(response.statusCode, response.body).toBe(400);
    expect(response.json()).toMatchObject({ success: false });
    expect(response.body).toMatch(/hosted action|disabled|named SQL/i);
    expect(JSON.parse(fs.readFileSync(path.join(pageDir, "meta.json"), "utf8")).currentVersion).toBe(1);
    expect(fs.existsSync(path.join(pageDir, "versions", "v2"))).toBe(false);
  });

  it("rejects action endpoint without loading bundle and leaves named SQL usable", async () => {
    const pageDir = path.join(dataDir, "test-owner", "team-workload");
    const versionDir = path.join(pageDir, "versions", "v1");
    fs.mkdirSync(versionDir, { recursive: true });
    fs.writeFileSync(path.join(versionDir, "index.html"), "<div>v1</div>");
    writeContract(versionDir);
    writeActionFiles(versionDir);
    writePageMeta(dataDir, "test-owner", "team-workload", pageMeta());
    const dbPath = getDbPath(pageDir);
    await getConnection(dbPath);
    execRawSql(dbPath, "CREATE TABLE work_items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)");
    execRawSql(dbPath, "INSERT INTO work_items (title) VALUES (?)", ["First"]);

    const actionResponse = await app.inject({
      method: "POST",
      url: "/serve/test-owner/team-workload/api/actions/workload.importWorkItems",
      payload: { input: {} },
    });

    expect(actionResponse.statusCode).toBeGreaterThanOrEqual(400);
    expect(actionResponse.json()).toMatchObject({
      success: false,
      code: expect.stringMatching(/hosted_actions_disabled|unsupported/i),
    });

    const queryResponse = await app.inject({
      method: "POST",
      url: "/serve/test-owner/team-workload/api/queries/$work_items.list",
      payload: { params: { limit: 10 } },
    });
    expect(queryResponse.statusCode).toBe(200);
    expect(queryResponse.json().data.rows).toEqual([{ id: 1, title: "First" }]);
  });
});
