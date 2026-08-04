import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestServer, createTestPage, getAppUrl, getTestApiKey } from "./helpers.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import { execRawSql, getConnection } from "../../src/lib/app-db.js";
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const RESOURCE_SCHEMA_URL = "https://localapp.dev/schemas/backend/resource-schema.schema.json";
const QUERIES_SCHEMA_URL = "https://localapp.dev/schemas/backend/queries.schema.json";
const MUTATIONS_SCHEMA_URL = "https://localapp.dev/schemas/backend/mutations.schema.json";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeBackendContract(pageDir: string): void {
  const resourceDir = path.join(pageDir, "backend", "resources", "work_items");
  writeJson(path.join(resourceDir, "schema.json"), {
    $schema: RESOURCE_SCHEMA_URL,
    name: "work_items",
    fields: {
      title: { type: "string" },
      status: { type: "string" },
    },
  });
  writeJson(path.join(resourceDir, "queries.json"), {
    $schema: QUERIES_SCHEMA_URL,
    queries: {
      "work_items.byStatus": {
        kind: "query",
        sql: "SELECT title FROM work_items WHERE status = :status ORDER BY id",
        params: {
          status: { type: "string", required: true },
        },
        access: "public",
      },
    },
  });
  writeJson(path.join(resourceDir, "mutations.json"), {
    $schema: MUTATIONS_SCHEMA_URL,
    mutations: {
      "work_items.seed": {
        kind: "mutation",
        sql: "INSERT INTO work_items (title, status) VALUES (:title, :status)",
        params: {
          title: { type: "string", required: true },
          status: { type: "string", required: true },
        },
        access: "public",
      },
      "work_items.setStatus": {
        kind: "mutation",
        sql: "UPDATE work_items SET status = :status WHERE title = :title",
        params: {
          title: { type: "string", required: true },
          status: { type: "string", required: true },
        },
        access: "public",
      },
    },
  });
}

describe("named-sql-api", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const apiKey = getTestApiKey();
  const pageOwner = BOOTSTRAP_USER_ID;
  const pageName = "named-sql-app";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;

    await createTestPage(app, pageOwner, pageName);
    await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        pageName,
        name: "work_items",
        fields: {
          title: { type: "string" },
          status: { type: "string" },
        },
      }),
    });
    // 先写 backend contract（含 seed mutation），再用 named mutation 写入测试数据。
    // 原 REST CRUD POST 已不可用（restrict-app-api-to-named-sql 变更）。
    writeBackendContract(path.join(dataDir, pageOwner, pageName));
    await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/mutations/work_items.seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { title: "First", status: "open" } }),
    });
    await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/mutations/work_items.seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { title: "Second", status: "done" } }),
    });
  });

  afterAll(async () => {
    await stop();
  });

  it("executes registered queries without accepting frontend SQL", async () => {
    const response = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/queries/work_items.byStatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: { status: "open" },
        sql: "SELECT title FROM work_items",
      }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("sql field"),
    });

    const allowed = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/queries/work_items.byStatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { status: "open" } }),
    });
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toMatchObject({
      success: true,
      data: { rows: [{ title: "First" }] },
    });
  });

  it("executes registered mutation batches transactionally", async () => {
    const success = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/mutations/_transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mutations: [
          { name: "work_items.setStatus", params: { title: "Second", status: "open" } },
          { name: "work_items.setStatus", params: { title: "Second", status: "done" } },
        ],
      }),
    });
    const successBody = await success.json();
    expect(success.status).toBe(200);
    expect(successBody).toMatchObject({
      success: true,
      data: [{ changes: 1 }, { changes: 1 }],
    });

    const failed = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/mutations/_transaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mutations: [
          { name: "work_items.setStatus", params: { title: "First", status: "done" } },
          { name: "work_items.missing", params: {} },
        ],
      }),
    });
    expect(failed.status).toBe(404);

    const stillOpen = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/queries/work_items.byStatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { status: "open" } }),
    });
    expect(await stillOpen.json()).toMatchObject({
      success: true,
      data: { rows: [{ title: "First" }] },
    });
  });

  it("uses migrated app.db schema immediately after upload even when a pooled connection was already open", async () => {
    const pageName = "named-sql-upload-refresh";
    await createTestPage(app, pageOwner, pageName);
    const pageDir = path.join(dataDir, pageOwner, pageName);
    const appDb = path.join(pageDir, "app.db");

    await getConnection(appDb);
    execRawSql(appDb, "CREATE TABLE todos (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT)");

    const schema = {
      $schema: RESOURCE_SCHEMA_URL,
      name: "todos",
      fields: {
        title: { type: "string" },
        source: { type: "string" },
      },
    };
    const mutations = {
      $schema: MUTATIONS_SCHEMA_URL,
      mutations: {
        "todos.create": {
          kind: "mutation",
          sql: "INSERT INTO todos (title, source) VALUES (:title, :source)",
          params: {
            title: { type: "string", required: true },
            source: { type: "string", required: true },
          },
          access: "public",
        },
      },
    };
    const migration = "ALTER TABLE todos ADD COLUMN source TEXT;";
    const upload = multipart([
      field("name", pageName),
      file("manifest", "manifest.json", JSON.stringify({ name: pageName, distDir: "dist", backend: { root: "backend" } }), "application/json"),
      file("files", "index.html", "<html><body>v2</body></html>", "text/html"),
      field("backendFilepath_0", "backend/resources/todos/schema.json"),
      file("backendFiles", "schema.json", JSON.stringify(schema), "application/json"),
      field("backendFilepath_1", "backend/resources/todos/mutations.json"),
      file("backendFiles", "mutations.json", JSON.stringify(mutations), "application/json"),
      ...migrationFile("002_add_todo_source.sql", migration),
    ]);

    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": upload.contentType },
      body: upload.body,
    });
    expect(uploadRes.status).toBe(200);

    const createRes = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/mutations/todos.create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { title: "Temporary", source: "manual" } }),
    });
    expect(createRes.status).toBe(200);
    expect(await createRes.json()).toMatchObject({
      success: true,
      data: { changes: 1 },
    });
  });
});

function multipart(parts: string[]): { body: string; contentType: string } {
  const boundary = `----NamedSqlUpload${Date.now()}`;
  return {
    body: `${parts.map((part) => `--${boundary}\r\n${part}`).join("")}--${boundary}--\r\n`,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

function field(name: string, value: string): string {
  return `Content-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
}

function migrationFile(filename: string, content: string): string[] {
  const checksum = crypto.createHash("sha256").update(content).digest("hex");
  return [
    field(`migrationChecksum_${filename}`, checksum),
    file(`migration_${filename}`, filename, content, "application/sql"),
  ];
}

function file(name: string, filename: string, content: string, contentType: string): string {
  return [
    `Content-Disposition: form-data; name="${name}"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
    content,
    "",
  ].join("\r\n");
}
