// @vitest-environment node
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { execRawSql, getConnection, insertIssueAttachment, PLATFORM_CAPABILITIES } from "@localapp/server-core";
// @ts-ignore - .mjs file has no type declarations
import { createGracefulShutdown, createMiniServer, parseArgs, startMiniServer } from "../runtime/mini-server.mjs";

let server: http.Server | undefined;
const tmpDirs: string[] = [];

async function readLocalIssueChanged(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/event: issue:changed\ndata: (.+)\n\n/);
    if (match) return JSON.parse(match[1]);
  }
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  server = undefined;

  for (const tmpDir of tmpDirs.splice(0)) {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

describe("mini-server CLI 参数", () => {
  it("解析端口、数据目录、生产 server 和 API key", () => {
    expect(
      parseArgs([
        "--port",
        "5174",
        "--data-dir",
        ".localapp",
        "--prod-server",
        "https://example.test",
        "--api-key",
        "test-key",
        "--project-dir",
        "/tmp/demo",
      ]),
    ).toEqual({
      port: 5174,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
      projectDir: "/tmp/demo",
    });
  });

  it("allows an empty API key for offline dev", () => {
    expect(
      parseArgs([
        "--port",
        "5174",
        "--data-dir",
        ".localapp",
        "--prod-server",
        "https://example.test",
        "--api-key",
        "",
      ]).apiKey,
    ).toBe("");
  });
});

describe("mini-server HTTP server", () => {
  function createProjectWithTasks() {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const migrationsDir = path.join(projectDir, "migrations");
    const dataDir = path.join(projectDir, ".localapp");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "manifest.json"),
      JSON.stringify({
        name: "business-mini",
        business: {
          tasks: {
            ownerField: "created_by",
            defaultFields: { created_by: { defaultFrom: "currentUser.id" } },
            recordAccess: {
              read: "owner",
              create: "owner",
              update: "owner",
              delete: "owner",
            },
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      [
        "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, created_by TEXT);",
        "INSERT INTO tasks (title, created_by) VALUES ('alice task', 'alice');",
        "INSERT INTO tasks (title, created_by) VALUES ('bob task', 'bob');",
      ].join("\n"),
    );
    return { projectDir, dataDir };
  }

  function createProjectWithTransitions() {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const migrationsDir = path.join(projectDir, "migrations");
    const dataDir = path.join(projectDir, ".localapp");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "manifest.json"),
      JSON.stringify({
        name: "transition-mini",
        business: {
          leaves: {
            ownerField: "created_by",
            assigneeField: "reviewer_id",
            defaultFields: { created_by: { defaultFrom: "currentUser.id" } },
            recordAccess: { read: "authenticated", create: "owner", update: "owner", delete: "owner" },
            statusField: "status",
            transitions: [
              {
                name: "submit",
                label: "Submit",
                from: ["draft"],
                to: "submitted",
                access: "owner",
                set: { submitted_at: "now" },
              },
              {
                name: "approve",
                label: "Approve",
                from: ["submitted"],
                to: "approved",
                access: { mode: "assigneeField", field: "reviewer_id" },
                set: { reviewed_by: "currentUser.id", reviewed_at: "now" },
              },
            ],
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      [
        "CREATE TABLE leaves (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT, created_by TEXT, reviewer_id TEXT, submitted_at TEXT, reviewed_by TEXT, reviewed_at TEXT);",
        "INSERT INTO leaves (title, status, created_by, reviewer_id) VALUES ('draft leave', 'draft', 'alice', 'bob');",
        "INSERT INTO leaves (title, status, created_by, reviewer_id) VALUES ('submitted leave', 'submitted', 'alice', 'bob');",
      ].join("\n"),
    );
    return { projectDir, dataDir };
  }

  function createProjectWithSeed() {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const migrationsDir = path.join(projectDir, "migrations");
    const seedsDir = path.join(projectDir, "db", "seeds");
    const dataDir = path.join(projectDir, ".localapp");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.mkdirSync(seedsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "manifest.json"),
      JSON.stringify({
        name: "seed-mini",
        business: {
          tasks: {
            ownerField: "created_by",
            defaultFields: { created_by: { defaultFrom: "currentUser.id" } },
            recordAccess: { read: "authenticated", create: "owner" },
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, created_by TEXT);",
    );
    fs.writeFileSync(
      path.join(seedsDir, "dev.sql"),
      "INSERT INTO tasks (title, created_by) VALUES ('seed task', 'dev-user');",
    );
    return { projectDir, dataDir };
  }

  function createProjectWithApiContract(options: { sqlAccess?: string } = {}) {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const migrationsDir = path.join(projectDir, "migrations");
    const dataDir = path.join(projectDir, ".localapp");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "manifest.json"),
      JSON.stringify({
        name: "api-contract-mini",
        db: { mode: "crud", sqlAccess: options.sqlAccess ?? "public" },
        business: {
          work_items: {
            ownerField: "owner_id",
            recordAccess: { read: "authenticated", create: "authenticated", update: "owner", delete: "owner" },
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      [
        "CREATE TABLE work_items (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, status TEXT, owner_id TEXT);",
        "INSERT INTO work_items (title, status, owner_id) VALUES ('todo one', 'todo', 'alice');",
        "INSERT INTO work_items (title, status, owner_id) VALUES ('done one', 'done', 'bob');",
        "INSERT INTO work_items (title, status, owner_id) VALUES ('todo two', 'todo', 'dev-user');",
      ].join("\n"),
    );
    return { projectDir, dataDir };
  }

  function writeNamedSqlBackend(projectDir: string) {
    const resourceDir = path.join(projectDir, "backend", "resources", "work_items");
    fs.mkdirSync(resourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(resourceDir, "schema.json"),
      JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
        name: "work_items",
        fields: {
          title: { type: "string" },
          status: { type: "string" },
          owner_id: { type: "string" },
        },
      }),
    );
    fs.writeFileSync(
      path.join(resourceDir, "queries.json"),
      JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/queries.schema.json",
        queries: {
          "work_items.byStatus": {
            kind: "query",
            sql: "SELECT title FROM work_items WHERE status = :status ORDER BY id",
            params: { status: { type: "string", required: true } },
            result: { mode: "bounded", maxRows: 100, maxBytes: 65536 },
            access: "public",
          },
          "work_items.ownerOnly": {
            kind: "query",
            sql: "SELECT title FROM work_items ORDER BY id",
            params: {},
            result: { mode: "bounded", maxRows: 100, maxBytes: 65536 },
            access: "owner",
          },
        },
      }),
    );
  }

  function writeTransactionBackend(projectDir: string) {
    const resourceDir = path.join(projectDir, "backend", "resources", "work_items");
    fs.mkdirSync(resourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(resourceDir, "schema.json"),
      JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
        name: "work_items",
        fields: {
          title: { type: "string" },
          status: { type: "string" },
          owner_id: { type: "string" },
        },
      }),
    );
    fs.writeFileSync(
      path.join(resourceDir, "mutations.json"),
      JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/mutations.schema.json",
        mutations: {
          "work_items.create": {
            kind: "mutation",
            sql: "INSERT INTO work_items (title, status, owner_id) VALUES (:title, :status, :owner_id)",
            params: {
              title: { type: "string", required: true },
              status: { type: "string", required: true },
              owner_id: { type: "string", required: true },
            },
            access: "public",
          },
          "work_items.fail": {
            kind: "mutation",
            sql: "INSERT INTO missing_table (title) VALUES (:title)",
            params: { title: { type: "string", required: true } },
            access: "public",
          },
        },
      }),
    );
  }

  function createProjectWithCollaboration() {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const migrationsDir = path.join(projectDir, "migrations");
    const dataDir = path.join(projectDir, ".localapp");
    const resourceDir = path.join(projectDir, "backend", "resources", "tasks");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.mkdirSync(resourceDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, "manifest.json"),
      JSON.stringify({
        name: "collab-mini",
        backend: { root: "backend" },
        collaboration: {
          enabled: true,
          resources: {
            tasks: {
              mode: "record-versioned",
              mutation: "tasks.updateCollaborative",
              history: true,
            },
          },
        },
      }),
    );
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      [
        "CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL);",
        "INSERT INTO tasks (id, title) VALUES ('task-1', 'Original');",
      ].join("\n"),
    );
    fs.writeFileSync(
      path.join(resourceDir, "schema.json"),
      JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/resource-schema.schema.json",
        name: "tasks",
        fields: { title: { type: "string" } },
      }),
    );
    fs.writeFileSync(
      path.join(resourceDir, "mutations.json"),
      JSON.stringify({
        $schema: "https://localapp.dev/schemas/backend/mutations.schema.json",
        mutations: {
          "tasks.updateCollaborative": {
            kind: "mutation",
            sql: "UPDATE tasks SET title = :title WHERE id = :id",
            params: {
              id: { type: "string", required: true },
              title: { type: "string", required: true },
            },
            access: "public",
          },
        },
      }),
    );
    return { projectDir, dataDir };
  }

  async function listenMiniServer(projectDir: string, dataDir: string) {
    server = await startMiniServer({
      port: 0,
      dataDir,
      projectDir,
      prodServer: "https://example.test",
      apiKey: "",
      devContext: {
        user: { id: "alice", name: "Alice", role: "user" },
        timeMode: "real",
        now: null,
        recentUsers: [],
      },
    });
    const address = server.address() as { port: number };
    return `http://127.0.0.1:${address.port}`;
  }

  it("启动后提供健康检查端点", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    expect(address).toMatchObject({ address: "127.0.0.1" });

    const response = await fetch(`http://127.0.0.1:${(address as { port: number }).port}/health`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("离线模式公开与生产一致的平台能力契约", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${address.port}/api/platform/capabilities`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: PLATFORM_CAPABILITIES });
  });

  it("/api/dev/context returns the default dev context", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const address = server.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${address.port}/api/dev/context`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        user: { id: "dev-user", name: "Dev User", role: "owner" },
        timeMode: "real",
        now: null,
        pageName: "",
        pageOwnerId: "dev-user",
        recentUsers: [],
      },
    });
  });

  it("PUT /api/dev/context switches the current /api/me user", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));

    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const updated = await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "user" } }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      success: true,
      data: { user: { id: "alice", name: "Alice", role: "user" } },
    });

    const me = await fetch(`${baseUrl}/api/me`);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      success: true,
      data: { id: "alice", name: "Alice", role: "user" },
    });
  });

  it("dev user picker lists platform users, supports search, and does not invent users", async () => {
    const upstream = http.createServer((req, res) => {
      expect(req.headers["x-api-key"]).toBe("test-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        data: [
          { id: "test-owner", name: "test-owner", displayName: "Test Owner" },
          { id: "reviewer", name: "reviewer", displayName: "Reviewer" },
        ],
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "test-key",
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dev/users?search=rev`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        data: {
          users: [{ id: "reviewer", name: "reviewer", displayName: "Reviewer" }],
          recentUsers: [],
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("dev user picker exposes the configured owner as self even when current context is unauthenticated", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/me") {
        res.end(JSON.stringify({ success: true, data: null }));
        return;
      }
      res.end(JSON.stringify({
        success: true,
        data: [
          { id: "test-owner", name: "test-owner", displayName: "Test Owner", avatarUrl: "/api/avatar/test-owner", role: "user" },
          { id: "reviewer", name: "reviewer", displayName: "Reviewer", role: "user" },
        ],
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };
    const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-dev-self-"));
    await fs.promises.mkdir(path.join(projectDir, ".localapp"), { recursive: true });
    await fs.promises.writeFile(
      path.join(projectDir, ".localapp", "dev-config.json"),
      JSON.stringify({ userId: "test-owner" }),
    );

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        projectDir,
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "test-key",
        devContext: { user: null, timeMode: "real", now: null, recentUsers: [] },
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dev/users`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        data: {
          currentUser: null,
          ownUser: { id: "test-owner", name: "test-owner", displayName: "Test Owner", avatarUrl: "/api/avatar/test-owner", role: "user" },
          users: [
            { id: "test-owner", name: "test-owner", displayName: "Test Owner", avatarUrl: "/api/avatar/test-owner", role: "user" },
            { id: "reviewer", name: "reviewer", displayName: "Reviewer", role: "user" },
          ],
        },
      });
    } finally {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("dev user picker falls back to current context when platform users are unavailable", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(req.url === "/api/me" ? 200 : 503, { "content-type": "application/json" });
      if (req.url === "/api/me") {
        res.end(JSON.stringify({
          success: true,
          data: { id: "test-owner", name: "test-owner", displayName: "Test Owner", avatarUrl: "/api/avatar/test-owner", role: "admin" },
        }));
        return;
      }
      res.end(JSON.stringify({ success: false, error: "platform users unavailable" }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };
    const projectDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "qw-dev-users-fallback-"));
    await fs.promises.mkdir(path.join(projectDir, ".localapp"), { recursive: true });
    await fs.promises.writeFile(
      path.join(projectDir, ".localapp", "dev-config.json"),
      JSON.stringify({ userId: "test-owner" }),
    );

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        projectDir,
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "test-key",
        devContext: { user: null, timeMode: "real", now: null, recentUsers: [] },
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dev/users`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        data: {
          currentUser: null,
          ownUser: { id: "test-owner", name: "test-owner", displayName: "test-owner", avatarUrl: null, role: "owner" },
          users: [{ id: "test-owner", name: "test-owner", displayName: "test-owner", avatarUrl: null, role: "owner" }],
          source: "unavailable",
        },
      });
    } finally {
      await fs.promises.rm(projectDir, { recursive: true, force: true });
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("dev context keeps the simulated owner when platform /api/me is available", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/me") {
        res.end(JSON.stringify({ success: true, data: { id: "test-owner", name: "Test Owner", role: "admin" } }));
        return;
      }
      res.end(JSON.stringify({ success: true, data: [] }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "test-key",
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };

      const response = await fetch(`http://127.0.0.1:${address.port}/api/dev/context`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        data: {
          user: { id: "dev-user", name: "Dev User", role: "owner" },
          pageOwnerId: "dev-user",
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("dev context rejects users that are not in the platform user list", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        success: true,
        data: [{ id: "test-owner", name: "test-owner", displayName: "Test Owner" }],
      }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "test-key",
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const rejected = await fetch(`${baseUrl}/api/dev/context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: { id: "made-up", name: "Made Up", role: "user" } }),
      });
      expect(rejected.status).toBe(400);
      expect(await rejected.json()).toMatchObject({
        success: false,
        error: expect.stringContaining("platform user"),
      });

      const accepted = await fetch(`${baseUrl}/api/dev/context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: { id: "test-owner", name: "Test Owner", role: "user" } }),
      });
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        success: true,
        data: {
          user: { id: "test-owner", name: "Test Owner", role: "user" },
          pageOwnerId: "dev-user",
          recentUsers: [{ id: "test-owner", name: "test-owner", displayName: "Test Owner", role: "user" }],
        },
      });

      const owner = await fetch(`${baseUrl}/api/dev/context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: { id: "dev-user", name: "Dev User", role: "owner" } }),
      });
      expect(owner.status).toBe(200);
      expect(await owner.json()).toMatchObject({
        success: true,
        data: {
          user: { id: "dev-user", name: "Dev User", role: "owner" },
          pageOwnerId: "dev-user",
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("keeps an explicitly simulated role when platform identity hydration finishes later", async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      if (req.url === "/api/me") {
        res.end(JSON.stringify({ success: true, data: { id: "test-owner", name: "test-owner", role: "user" } }));
        return;
      }
      res.end(JSON.stringify({ success: true, data: [{ id: "test-owner", name: "test-owner", displayName: "Test Owner", role: "user" }] }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "test-key",
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const updated = await fetch(`${baseUrl}/api/dev/context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: { id: "test-owner", name: "Test Owner", role: "owner" } }),
      });
      expect(updated.status).toBe(200);
      await fetch(`${baseUrl}/api/dev/users`);

      const context = await fetch(`${baseUrl}/api/dev/context`);
      expect(await context.json()).toMatchObject({
        success: true,
        data: { user: { id: "test-owner", name: "Test Owner", role: "owner" } },
      });
    } finally {
      await new Promise<void>((resolve, reject) => upstream.close((error) => error ? reject(error) : resolve()));
    }
  });

  // 注：unauthenticated dev context blocks defaultFrom currentUser.id 和
  // dev context user controls owner recordAccess filtering 两个测试已随
  // REST CRUD 整体移除（restrict-app-api-to-named-sql 变更）。defaultFrom /
  // recordAccess 现在由 named SQL 的 access 字段和 SQL WHERE 子句表达。

  it("PUT /api/dev/context stores a fixed backend time", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const fixedNow = "2026-07-01T09:00:00.000Z";
    const updated = await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeMode: "fixed", now: fixedNow }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({
      success: true,
      data: {
        user: { id: "dev-user", name: "Dev User", role: "owner" },
        timeMode: "fixed",
        now: fixedNow,
        pageName: "",
        pageOwnerId: "dev-user",
        recentUsers: [],
      },
    });
  });

  it("/api/time returns the fixed dev context time", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const fixedNow = "2026-07-01T09:00:00.000Z";

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ timeMode: "fixed", now: fixedNow }),
    });

    const response = await fetch(`${baseUrl}/api/time`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        now: fixedNow,
        today: "2026-07-01",
      },
    });
  });

  it("/api/me 返回 dev mock 用户", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${address.port}/api/me`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: {
        id: "dev-user",
        name: "Dev User",
        role: "owner",
      },
    });
  });

  it("/api/me returns standard success envelope with null when unauthenticated", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "https://example.test",
      apiKey: "test-key",
    });

    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: null }),
    });

    const response = await fetch(`${baseUrl}/api/me`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: null });
  });

  it("启动时应用 migrations 到 dev.db", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const migrationsDir = path.join(projectDir, "migrations");
    const dataDir = path.join(projectDir, ".localapp");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);",
    );

    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "test-key",
      projectDir,
    });

    const dbBytes = fs.readFileSync(path.join(dataDir, "dev.db"));
    expect(dbBytes.toString("utf8")).toContain("CREATE TABLE tasks");
  });

  it("已有 dev.db 时只继续应用未应用的 migrations", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const migrationsDir = path.join(projectDir, "migrations");
    const dataDir = path.join(projectDir, ".localapp");
    fs.mkdirSync(migrationsDir, { recursive: true });
    fs.writeFileSync(
      path.join(migrationsDir, "001_init.sql"),
      "CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT);",
    );

    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "test-key",
      projectDir,
    });
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    server = undefined;

    fs.writeFileSync(
      path.join(migrationsDir, "002_notes.sql"),
      "CREATE TABLE notes (id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT);",
    );

    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "test-key",
      projectDir,
    });

    const dbText = fs.readFileSync(path.join(dataDir, "dev.db")).toString("utf8");
    expect(dbText).toContain("CREATE TABLE tasks");
    expect(dbText).toContain("CREATE TABLE notes");
  });

  // 注：/api/<resource> 提供 dev.db CRUD 和 GET /api/{resource}/count 两个测试
  // 已随 REST CRUD 端点整体移除（restrict-app-api-to-named-sql 变更）。
  // 应用层数据操作现由 named SQL 唯一承担。

  it("/api/users and /api/groups are platform routes instead of CRUD fallback", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "test-key",
      projectDir,
    });
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const users = await fetch(`${baseUrl}/api/users`);
    expect(users.status).toBe(200);
    expect(await users.json()).toMatchObject({
      success: true,
      data: expect.arrayContaining([
        { id: "dev-user", name: "dev-user", displayName: "Dev User", avatarUrl: null, role: "owner" },
      ]),
    });

    const groups = await fetch(`${baseUrl}/api/groups`);
    expect(groups.status).toBe(200);
    const groupsBody = await groups.json();
    expect(groupsBody).toMatchObject({
      success: true,
      data: expect.arrayContaining([
        { id: "dev-team", name: "Dev Team", description: expect.any(String), isCreator: true },
      ]),
    });

    const detail = await fetch(`${baseUrl}/api/groups/${groupsBody.data[0].id}`);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toMatchObject({
      success: true,
      data: { members: expect.arrayContaining([expect.objectContaining({ id: "dev-user", name: "dev-user" })]) },
    });
  });

  it("/api/content/upload and /api/content/{key} provide PDF and Range parity", async () => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const dataDir = path.join(projectDir, ".localapp");

    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "test-key",
    });
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const formData = new FormData();
    const pdf = Buffer.from("%PDF-1.7\n0123456789\n%%EOF");
    formData.append("file", new Blob([pdf], { type: "application/pdf" }), "invoice.pdf");

    const upload = await fetch(`${baseUrl}/api/content/upload`, { method: "POST", body: formData });
    expect(upload.status).toBe(201);
    const uploadBody = await upload.json();
    expect(uploadBody).toEqual({
      success: true,
      data: { key: expect.any(String), url: expect.stringMatching(/^\/api\/content\//) },
    });

    const content = await fetch(`${baseUrl}${uploadBody.data.url}`);
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toContain("application/pdf");
    expect(content.headers.get("x-content-type-options")).toBe("nosniff");
    expect(content.headers.get("content-disposition")).toContain("inline");
    expect(Buffer.from(await content.arrayBuffer())).toEqual(pdf);

    const partial = await fetch(`${baseUrl}${uploadBody.data.url}`, { headers: { Range: "bytes=5-9" } });
    expect(partial.status).toBe(206);
    expect(partial.headers.get("content-range")).toBe(`bytes 5-9/${pdf.length}`);
    expect(Buffer.from(await partial.arrayBuffer())).toEqual(pdf.subarray(5, 10));
  });

  it.each([
    ["notes.txt", "text/plain", Buffer.from("notes"), "CONTENT_TYPE_UNSUPPORTED", 400],
    ["image.png", "application/pdf", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "CONTENT_MIME_MISMATCH", 400],
    ["image.png", "image/png", Buffer.from("not a png"), "CONTENT_SIGNATURE_INVALID", 400],
  ])("rejects invalid local content %# with production error codes", async (filename, mimeType, bytes, code, status) => {
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-mini-server-"));
    tmpDirs.push(projectDir);
    const dataDir = path.join(projectDir, ".localapp");
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const formData = new FormData();
    formData.append("file", new Blob([bytes], { type: mimeType }), filename);

    const response = await fetch(`${baseUrl}/api/content/upload`, { method: "POST", body: formData });

    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ success: false, code });
  });

  // 注：/api/db/exec executes allowed SQL 和 /api/db/exec rejects unauthorized dev visitors
  // 两个测试已随 raw SQL 端点整体移除（restrict-app-api-to-named-sql 变更）。

  it("/api/queries/:name executes registered named SQL without accepting frontend SQL", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract({ sqlAccess: "public" });
    writeNamedSqlBackend(projectDir);
    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "test-key",
      projectDir,
    });
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const rejected = await fetch(`${baseUrl}/api/queries/work_items.byStatus`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: { status: "todo" }, sql: "SELECT * FROM work_items" }),
    });
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({
      success: false,
      error: expect.stringContaining("sql field"),
    });

    const allowed = await fetch(`${baseUrl}/api/queries/work_items.byStatus`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: { status: "todo" } }),
    });
    const allowedBody = await allowed.json();
    expect(allowed.status, JSON.stringify(allowedBody)).toBe(200);
    expect(allowedBody).toMatchObject({
      success: true,
      data: {
        rows: [
          { title: "todo one" },
          { title: "todo two" },
        ],
      },
    });
  });

  it("owner-only named SQL uses the stable page owner while identities switch", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    writeNamedSqlBackend(projectDir);
    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "",
      projectDir,
      devUserId: "dev-user",
    });
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const query = () => fetch(`${baseUrl}/api/queries/work_items.ownerOnly`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ params: {} }),
    });

    expect((await query()).status).toBe(200);

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: { id: "test-owner", name: "Test Owner", role: "user" } }),
    });
    expect((await query()).status).toBe(403);

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: null }),
    });
    expect((await query()).status).toBe(401);
  });

  it("/api/mutations/_transaction executes named mutations transactionally in local dev", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract({ sqlAccess: "public" });
    writeTransactionBackend(projectDir);
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    const ok = await fetch(`${baseUrl}/api/mutations/_transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mutations: [
          {
            name: "work_items.create",
            body: { params: { title: "tx one", status: "todo", owner_id: "alice" } },
          },
          {
            name: "work_items.create",
            body: { params: { title: "tx two", status: "done", owner_id: "alice" } },
          },
        ],
      }),
    });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("application/json");
    expect(await ok.json()).toMatchObject({
      success: true,
      data: [{ changes: 1 }, { changes: 1 }],
    });

    const dbPath = path.join(dataDir, "dev.db");
    await getConnection(dbPath);
    expect(
      execRawSql(dbPath, "SELECT title FROM work_items WHERE owner_id = ? AND title LIKE 'tx %' ORDER BY title", ["alice"]).rows,
    ).toEqual([{ title: "tx one" }, { title: "tx two" }]);

    const failed = await fetch(`${baseUrl}/api/mutations/_transaction`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mutations: [
          {
            name: "work_items.create",
            body: { params: { title: "tx rollback", status: "todo", owner_id: "alice" } },
          },
          {
            name: "work_items.fail",
            body: { params: { title: "boom" } },
          },
        ],
      }),
    });
    expect(failed.status).toBe(400);
    expect(failed.headers.get("content-type")).toContain("application/json");
    expect(await failed.json()).toMatchObject({ success: false });
    expect(
      execRawSql(dbPath, "SELECT title FROM work_items WHERE title = ?", ["tx rollback"]).rows,
    ).toEqual([]);
  });

  it("local Issue API creates, filters, and numbers Issues in dev.db", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    for (const [title, label] of [["upload fails", "bug"], ["add export", "feature"]] as const) {
      const created = await fetch(`${baseUrl}/api/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: "owner/api-contract-mini", title, description: `${title} detail`, label }),
      });
      expect(created.status).toBe(200);
      expect(created.headers.get("content-type")).toContain("application/json");
    }

    const bugs = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&status=open&type=bug`);
    expect(bugs.status).toBe(200);
    expect(await bugs.json()).toMatchObject({
      success: true,
      data: [{ issue_number: 1, title: "upload fails", reporter_id: "alice", status: "open", issue_type: "bug" }],
      meta: { total: 1, open: 1, closed: 0, limit: 25, offset: 0 },
    });

    const all = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&status=open`);
    const allBody = await all.json() as { success: boolean; data: Array<{ issue_number: number }> };
    expect(allBody.data.map((issue) => issue.issue_number).sort()).toEqual([1, 2]);
    const byNumber = await fetch(`${baseUrl}/api/issues/by-number/2?pagePath=owner%2Fapi-contract-mini`);
    expect(byNumber.status).toBe(200);
    expect(await byNumber.json()).toMatchObject({ success: true, data: { issue: { issue_number: 2, title: "add export" } } });
    expect(fs.existsSync(path.join(dataDir, "dev.db"))).toBe(true);
  });

  it("enforces the hosted-compatible Unicode Issue title limit before local writes", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const validTitle = "😀".repeat(256);
    const invalidTitle = `${validTitle}😀`;
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: validTitle, description: "kept", label: "bug" }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json() as { data: { id: number } }).data;
    const rejectedCreate = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: invalidTitle, label: "bug" }),
    });
    expect(rejectedCreate.status).toBe(400);
    await expect(rejectedCreate.json()).resolves.toMatchObject({ code: "issue_title_too_long" });
    const rejectedUpdate = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: invalidTitle }),
    });
    expect(rejectedUpdate.status).toBe(400);
    await expect(rejectedUpdate.json()).resolves.toMatchObject({ code: "issue_title_too_long" });
    const detailResponse = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(detailResponse.json()).resolves.toMatchObject({ data: { issue: { title: validTitle } } });
  });

  it("local Issue writes publish the hosted-compatible minimal SSE invalidation", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const events = await fetch(`${baseUrl}/api/issues/events?pagePath=owner%2Fapi-contract-mini`);
    expect(events.status).toBe(200);
    const reader = events.body!.getReader();

    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Realtime local", description: "private local body", label: "bug" }),
    });
    const issue = (await created.json()).data;
    const event = await readLocalIssueChanged(reader);

    expect(event).toEqual({
      type: "issue:changed",
      data: {
        pagePath: "owner/api-contract-mini",
        issueId: issue.id,
        kind: "created",
        updatedAt: expect.any(String),
      },
    });
    expect(JSON.stringify(event)).not.toContain("private local body");
    await reader.cancel();
  });

  it("creates local Issue labels and assignees in the initial transaction", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const labelResponse = await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", name: "创建标签", color: "1f6feb" }),
    });
    const customLabel = (await labelResponse.json() as { data: { id: string } }).data;

    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagePath: "owner/api-contract-mini",
        title: "Local creation metadata",
        issueType: "feature",
        labelIds: [customLabel.id, customLabel.id],
        assigneeIds: ["alice", "alice"],
      }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json() as { data: { id: number } }).data;
    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    const detailBody = await detail.json() as { data: { issue: { issue_type: string }; collaboration: { labels: Array<{ id: string }> } } };
    expect(detailBody).toMatchObject({
      success: true,
      data: {
        collaboration: {
          labels: expect.arrayContaining([
            expect.objectContaining({ id: customLabel.id }),
          ]),
          assignee_ids: ["alice"],
        },
        timeline: expect.arrayContaining([
          { kind: "event", event: expect.objectContaining({ event_type: "labels_changed" }) },
          { kind: "event", event: expect.objectContaining({ event_type: "assignees_changed" }) },
        ]),
      },
    });
    expect(detailBody.data.collaboration.labels.map((item) => item.id)).toEqual([customLabel.id]);
    expect(detailBody.data.issue).toMatchObject({ issue_type: "feature" });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "user" } }),
    });
    const assignedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(assignedDetail.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["alice"] } } });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }),
    });
    const denied = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Escalation", labelIds: [customLabel.id] }),
    });
    expect(denied.status).toBe(403);

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const invalid = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Rolled back local creation", labelIds: ["missing-label"] }),
    });
    expect(invalid.status).toBe(400);
    const missing = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&q=Rolled%20back%20local%20creation`);
    await expect(missing.json()).resolves.toMatchObject({ success: true, meta: { total: 0 }, data: [] });
  });

  it("manages local milestones with hosted-compatible filtering and owner permissions", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const createdMilestone = await fetch(`${baseUrl}/api/issues/milestones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Local v1", description: "Offline release", dueOn: "2026-09-15" }),
    });
    expect(createdMilestone.status).toBe(201);
    const milestone = (await createdMilestone.json() as { data: { id: number } }).data;
    const createdIssue = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Offline milestone work", milestoneId: milestone.id }),
    });
    expect(createdIssue.status).toBe(200);
    const issue = (await createdIssue.json() as { data: { id: number } }).data;

    const filtered = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&milestone=${milestone.id}`);
    await expect(filtered.json()).resolves.toMatchObject({ data: [expect.objectContaining({ id: issue.id, milestone_id: milestone.id })] });
    const updated = await fetch(`${baseUrl}/api/issues/milestones/${milestone.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Local v1.0", description: "Offline", dueOn: null, state: "closed" }),
    });
    await expect(updated.json()).resolves.toMatchObject({ data: { title: "Local v1.0", due_on: null, state: "closed", open_issues: 1 } });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }),
    });
    const denied = await fetch(`${baseUrl}/api/issues/milestones`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Denied" }),
    });
    expect(denied.status).toBe(403);

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    expect((await fetch(`${baseUrl}/api/issues/milestones/${milestone.id}?pagePath=owner%2Fapi-contract-mini`, { method: "DELETE" })).status).toBe(200);
    const unassigned = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&milestone=none`);
    await expect(unassigned.json()).resolves.toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id: issue.id, milestone_id: null })]) });
  });

  it("local Issue list mirrors the structured query and response metadata", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    for (const [title, label] of [["upload export", "bug"], ["other feature", "feature"]] as const) {
      const created = await fetch(`${baseUrl}/api/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: "owner/api-contract-mini", title, label }),
      });
      expect(created.status).toBe(200);
    }
    const unlabeledCreated = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "unlabeled queue" }),
    });
    expect(unlabeledCreated.status).toBe(200);
    const unlabeledIssue = (await unlabeledCreated.json() as { data: { id: number } }).data;
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const clearedLabels = await fetch(`${baseUrl}/api/issues/${unlabeledIssue.id}/labels`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", labelIds: [] }),
    });
    expect(clearedLabels.status).toBe(200);

    const defaultResponse = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini`);
    expect(defaultResponse.status).toBe(200);
    await expect(defaultResponse.json()).resolves.toMatchObject({
      success: true,
      meta: { total: 3, open: 3, closed: 0, limit: 25, offset: 0 },
    });

    const response = await fetch(
      `${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&q=upload&status=open&type=bug&author=alice&participant=alice&sort=comments&direction=asc&limit=10&offset=0`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining({
        title: "upload export",
        status: "open",
        issue_type: "bug",
        reporter_id: "alice",
        comment_count: 0,
        last_activity_at: expect.any(String),
        participant_ids: ["alice"],
      })],
      meta: { total: 1, open: 1, closed: 0, limit: 10, offset: 0 },
    });

    const unassigned = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&assignee=none`);
    expect(unassigned.status).toBe(200);
    await expect(unassigned.json()).resolves.toMatchObject({ success: true, meta: { total: 3 } });

    const missingMetadata = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&label=none&assignee=none`);
    expect(missingMetadata.status).toBe(200);
    await expect(missingMetadata.json()).resolves.toMatchObject({
      success: true,
      data: expect.arrayContaining([expect.objectContaining({ title: "unlabeled queue", labels: [], assignee_ids: [] })]),
      meta: { total: 3 },
    });
  });

  it("local Issue list searches current comment bodies offline", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, title: "Offline discussion search" }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json() as { data: { id: number } }).data;
    const comment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, body: "LOCAL-COMMENT-SEARCH-261" }),
    });
    expect(comment.status).toBe(201);

    const searched = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "LOCAL-COMMENT-SEARCH-261" })}`);
    expect(searched.status).toBe(200);
    await expect(searched.json()).resolves.toMatchObject({ success: true, data: [expect.objectContaining({ id: issue.id })], meta: { total: 1, open: 1, closed: 0 } });
    const commentsOnly = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "LOCAL-COMMENT-SEARCH-261", in: "comments" })}`);
    await expect(commentsOnly.json()).resolves.toMatchObject({ success: true, data: [expect.objectContaining({ id: issue.id })], meta: { total: 1 } });
    const titleOnly = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "LOCAL-COMMENT-SEARCH-261", in: "title" })}`);
    await expect(titleOnly.json()).resolves.toMatchObject({ success: true, data: [], meta: { total: 0 } });
  });

  it("pins at most three local Issues for the dev page owner without a platform connection", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const issues = [] as Array<{ id: number }>;
    for (let index = 0; index < 4; index += 1) {
      const created = await fetch(`${baseUrl}/api/issues`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, title: `Local pin ${index + 1}` }),
      });
      issues.push((await created.json() as { data: { id: number } }).data);
    }
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    for (const issue of issues.slice(0, 3)) {
      expect((await fetch(`${baseUrl}/api/issues/${issue.id}/pin`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, pinned: true }),
      })).status).toBe(200);
    }
    const limited = await fetch(`${baseUrl}/api/issues/${issues[3].id}/pin`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, pinned: true }),
    });
    expect(limited.status).toBe(409);
    await expect(limited.json()).resolves.toMatchObject({ code: "issue_pin_limit_exceeded" });
    const list = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "no-normal-result" })}`);
    await expect(list.json()).resolves.toMatchObject({ data: [], pinned: expect.arrayContaining(issues.slice(0, 3).map(({ id }) => expect.objectContaining({ id }))) });

    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }) });
    expect((await fetch(`${baseUrl}/api/issues/${issues[0].id}/pin`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, pinned: false }),
    })).status).toBe(403);
  });

  it("pins one local Issue comment with the offline page owner identity", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title: "Pinned local decision" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;
    const commentResponse = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, body: "Keep this visible" }),
    });
    const comment = ((await commentResponse.json() as { data: { timeline: Array<{ kind: string; comment?: { id: number } }> } }).data.timeline.find((item) => item.kind === "comment"))!.comment!;
    const endpoint = `${baseUrl}/api/issues/${issue.id}/comments/${comment.id}/pin`;

    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }) });
    expect((await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(403);

    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }) });
    const pinned = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
    expect(pinned.status).toBe(200);
    await expect(pinned.json()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "comment", comment: expect.objectContaining({ id: comment.id, pinned_by: "local-owner", pinned_at: expect.any(String) }) })]) } });
    expect((await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(200);
  });

  it("minimizes and restores a local comment with the offline page owner identity", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const created = await fetch(`${baseUrl}/api/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title: "Local moderation" }) });
    const issue = (await created.json() as { data: { id: number } }).data;
    const commentResponse = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, body: "Old local answer" }) });
    const comment = ((await commentResponse.json() as { data: { timeline: Array<{ kind: string; comment?: { id: number } }> } }).data.timeline.find((item) => item.kind === "comment"))!.comment!;
    const endpoint = `${baseUrl}/api/issues/${issue.id}/comments/${comment.id}/minimize`;

    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: null }) });
    expect((await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, reason: "outdated" }) })).status).toBe(401);
    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }) });
    const minimized = await fetch(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, reason: "outdated" }) });
    expect(minimized.status).toBe(200);
    await expect(minimized.json()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "comment", comment: expect.objectContaining({ id: comment.id, minimized_by: "local-owner", minimized_reason: "outdated" }) })]) } });
    expect((await fetch(endpoint, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(200);
  });

  it("creates, links, and removes local Sub-issues entirely offline", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const create = async (title: string, parentIssueId?: number) => {
      const response = await fetch(`${baseUrl}/api/issues`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, title, ...(parentIssueId === undefined ? {} : { parentIssueId }) }),
      });
      return { response, body: await response.json() as { data: { id: number } } };
    };
    const parent = await create("Local Sub-issue parent");
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const atomicChild = await create("Local atomic child", parent.body.data.id);
    expect(atomicChild.response.status).toBe(200);
    const existing = await create("Local existing child");

    const linked = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    });
    expect(linked.status).toBe(200);
    await expect(linked.json()).resolves.toMatchObject({ data: { subIssueSummary: { total: 2 }, subIssues: expect.any(Array) } });
    const children = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues?pagePath=${encodeURIComponent(pagePath)}`);
    expect(children.status).toBe(200);
    await expect(children.json()).resolves.toMatchObject({ data: {
      summary: { total: 2, completed: 0, percent: 0 },
      items: expect.arrayContaining([expect.objectContaining({ id: atomicChild.body.data.id, child_count: 0, completed_child_count: 0, child_percent: 0 })]),
    } });
    const childDetail = await fetch(`${baseUrl}/api/issues/${atomicChild.body.data.id}?pagePath=${encodeURIComponent(pagePath)}`);
    await expect(childDetail.json()).resolves.toMatchObject({ data: { parent: { id: parent.body.data.id } } });

    const duplicate = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ code: "issue_sub_issue_duplicate" });
    const priority = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/priority`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, childIssueId: existing.body.data.id, afterIssueId: null }),
    });
    expect(priority.status).toBe(200);
    await expect(priority.json()).resolves.toMatchObject({ data: { subIssues: [{ id: existing.body.data.id, position: 0 }, { id: atomicChild.body.data.id, position: 1 }] } });
    expect((await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    })).status).toBe(200);

    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }) });
    expect((await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    })).status).toBe(403);
  });

  it("converts a local body task into a Sub-issue entirely offline", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }) });
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, title: "Local conversion", description: "- [ ] Build offline flow" }),
    });
    const parent = (await created.json() as { data: { id: number; updated_at: string } }).data;
    const endpoint = `${baseUrl}/api/issues/${parent.id}/tasks/0/convert`;

    const converted = await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, expectedUpdatedAt: parent.updated_at }),
    });
    expect(converted.status).toBe(200);
    await expect(converted.json()).resolves.toMatchObject({ data: {
      issue: { description: expect.stringMatching(/^- \[ \] #\d+$/) },
      subIssues: [expect.objectContaining({ title: "Build offline flow", reporter_id: "local-owner" })],
    } });

    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }) });
    expect((await fetch(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, expectedUpdatedAt: parent.updated_at }),
    })).status).toBe(403);
  });

  it("manages local Issue dependencies entirely offline", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const create = async (title: string) => {
      const response = await fetch(`${baseUrl}/api/issues`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title }),
      });
      return (await response.json() as { data: { id: number } }).data;
    };
    const blocked = await create("Local blocked work");
    const blocker = await create("Local blocking work");
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const added = await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    });
    expect(added.status).toBe(200);
    await expect(added.json()).resolves.toMatchObject({ data: { blockedBy: [expect.objectContaining({ id: blocker.id })], dependencySummary: { isBlocked: true } } });
    const duplicate = await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ code: "issue_dependency_duplicate" });
    expect((await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    })).status).toBe(200);
    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }) });
    expect((await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    })).status).toBe(403);
  });

  it("suggests minimal potential duplicate Issues entirely offline", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, title: "Local screenshot upload JSON error", description: "Unexpected token HTML response while uploading a screenshot" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;
    const query = new URLSearchParams({ pagePath, title: "Screenshot upload JSON error", body: "Unexpected token HTML response while uploading a screenshot".padEnd(100, " x") });
    const response = await fetch(`${baseUrl}/api/issues/potential-duplicates?${query}`);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: Array<Record<string, unknown>> };
    expect(payload.data).toEqual([expect.objectContaining({ id: issue.id, score: expect.any(Number) })]);
    expect(payload.data[0]).not.toHaveProperty("description");
    expect((await fetch(`${baseUrl}/api/issues/potential-duplicates?${query}&body=duplicate`)).status).toBe(400);
  });

  it("reads and revalidates Issue templates from the local manifest without platform access", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const manifestPath = path.join(projectDir, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.issues = { templates: [{ id: "bug-report", name: " Bug report ", description: " Report a defect ", body: "## Steps", labels: ["triage", "triage"] }] };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const response = await fetch(`${baseUrl}/api/issues/config?pagePath=${encodeURIComponent(pagePath)}`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { templates: [{ id: "bug-report", name: "Bug report", description: "Report a defect", labels: ["triage"] }] } });

    manifest.issues.templates[0].id = "Bad_ID";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    const invalid = await fetch(`${baseUrl}/api/issues/config?pagePath=${encodeURIComponent(pagePath)}`);
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: "invalid_issue_templates", path: "issues.templates[0].id" });

    manifest.issues.templates[0].id = "bug-report";
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    expect((await fetch(`${baseUrl}/api/issues/config?pagePath=${encodeURIComponent(pagePath)}`)).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/issues/config?pagePath=${encodeURIComponent(pagePath)}&pagePath=other`)).status).toBe(400);
  });

  it("keeps saved Issue views private to the current offline dev identity", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "owner" } }),
    });
    const created = await fetch(`${baseUrl}/api/issues/views`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, name: "离线待办", query: { status: "open", subscribed: true, offset: 50 } }),
    });
    expect(created.status).toBe(200);
    const view = (await created.json()).data;
    expect(view).toMatchObject({ user_id: "alice", query: { status: "open", subscribed: true, offset: 0 } });
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    await expect(fetch(`${baseUrl}/api/issues/views?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json())).resolves.toEqual({ success: true, data: [] });
    expect((await fetch(`${baseUrl}/api/issues/views/${view.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }),
    })).status).toBe(404);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "owner" } }),
    });
    await expect(fetch(`${baseUrl}/api/issues/views?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json())).resolves.toMatchObject({ data: [expect.objectContaining({ id: view.id })] });
  });

  it("keeps saved replies private to the current offline dev identity", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "owner" } }),
    });
    const created = await fetch(`${baseUrl}/api/issues/saved-replies`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Need logs", body: "Please attach logs.\n\n%cursor%" }),
    });
    expect(created.status).toBe(201);
    const reply = (await created.json()).data;
    expect(reply).toMatchObject({ user_id: "alice", title: "Need logs" });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    await expect(fetch(`${baseUrl}/api/issues/saved-replies`).then((response) => response.json())).resolves.toEqual({ success: true, data: [] });
    expect((await fetch(`${baseUrl}/api/issues/saved-replies/${reply.id}`, {
      method: "DELETE",
    })).status).toBe(404);
  });

  it("marks and unmarks duplicate Issues entirely offline with owner permission", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const create = async (title: string) => (await (await fetch(`${baseUrl}/api/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title, description: "" }) })).json()).data;
    const canonical = await create("Canonical");
    const duplicate = await create("Duplicate");
    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "member", name: "Member", role: "user" } }) });
    const ordinary = await fetch(`${baseUrl}/api/issues/${duplicate.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, body: `Duplicate of #${canonical.issue_number}` }) });
    expect((await ordinary.json()).data.duplicateOf).toBeNull();
    await fetch(`${baseUrl}/api/dev/context`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ user: { id: "owner", name: "Owner", role: "owner" } }) });
    const marked = await fetch(`${baseUrl}/api/issues/${duplicate.id}/comments`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, body: `Duplicate of #${canonical.issue_number}` }) });
    expect(marked.status).toBe(201);
    await expect(marked.json()).resolves.toMatchObject({ data: { duplicateOf: { id: canonical.id } } });
    expect((await fetch(`${baseUrl}/api/issues/${duplicate.id}/duplicate/${canonical.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(200);
    await expect(fetch(`${baseUrl}/api/issues/${duplicate.id}?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json())).resolves.toMatchObject({ data: { duplicateOf: null } });
  });

  it("reconciles local Issue cross references without a platform connection", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner/api-contract-mini";
    const create = async (title: string, description = "") => (await (await fetch(`${baseUrl}/api/issues`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title, description }) })).json()).data;
    const target = await create("Local cross reference target");
    const source = await create("Local cross reference source", `See #${target.issue_number}`);
    const readTarget = () => fetch(`${baseUrl}/api/issues/${target.id}?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json());
    await expect(readTarget()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "cross_reference", crossReference: expect.objectContaining({ source_issue_id: source.id }) })]) } });

    const current = await fetch(`${baseUrl}/api/issues/${source.id}?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json());
    await fetch(`${baseUrl}/api/issues/${source.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, description: "Reference removed", expectedUpdatedAt: current.data.issue.updated_at }) });
    expect((await readTarget()).data.timeline.filter((item) => item.kind === "cross_reference")).toHaveLength(0);
  });

  it("local Issue list rejects unknown, repeated, and invalid scalar query parameters", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const pagePath = "owner%2Fapi-contract-mini";
    const invalidQueries = [
      `pagePath=${pagePath}&q=one&q=two`,
      `pagePath=${pagePath}&q=one&in=comments&in=title`,
      `pagePath=${pagePath}&q=one&in=comments,title`,
      `pagePath=${pagePath}&status=open&status=closed`,
      `pagePath=${pagePath}&label=bug&label=feature`,
      `pagePath=${pagePath}&author=alice&author=bob`,
      `pagePath=${pagePath}&participant=alice&participant=bob`,
      `pagePath=${pagePath}&assignee=alice&assignee=bob`,
      `pagePath=${pagePath}&subscribed=true&subscribed=true`,
      `pagePath=${pagePath}&subscribed=alice`,
      `pagePath=${pagePath}&mentioned=true&mentioned=true`,
      `pagePath=${pagePath}&mentioned=alice`,
      `pagePath=${pagePath}&reason=wontfix`,
      `pagePath=${pagePath}&reason=completed&reason=not_planned`,
      `pagePath=${pagePath}&sort=unknown`,
      `pagePath=${pagePath}&direction=sideways`,
      `pagePath=${pagePath}&limit=0`,
      `pagePath=${pagePath}&limit=101`,
      `pagePath=${pagePath}&limit=1.5`,
      `pagePath=${pagePath}&offset=-1`,
      `pagePath=${pagePath}&offset=1.5`,
      `pagePath=${pagePath}&extra=value`,
    ];

    for (const query of invalidQueries) {
      const response = await fetch(`${baseUrl}/api/issues?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.headers.get("content-type"), query).toContain("application/json");
      expect(await response.json(), query).toMatchObject({ success: false });
    }
  });

  it("local Issue list filters subscriptions by the current dev identity", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const create = async (title: string) => {
      const response = await fetch(`${baseUrl}/api/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: "owner/api-contract-mini", title }),
      });
      return (await response.json() as { data: { id: number } }).data;
    };
    const aliceIssue = await create("Alice watched");
    const bobIssue = await create("Bob watched");
    await fetch(`${baseUrl}/api/issues/${aliceIssue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", subscribed: true }),
    });
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    await fetch(`${baseUrl}/api/issues/${bobIssue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", subscribed: true }),
    });

    const bobList = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&subscribed=true`);
    expect(bobList.status).toBe(200);
    await expect(bobList.json()).resolves.toMatchObject({ data: [expect.objectContaining({ id: bobIssue.id })], meta: { total: 1 } });
  });

  it("local Issue list filters current mentions by the current dev identity", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "owner" } }),
    });
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Mentioned locally", description: "Review @bob" }),
    });
    expect(created.status).toBe(200);
    const listed = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&mentioned=true`);
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ data: [expect.objectContaining({ title: "Mentioned locally" })], meta: { total: 1 } });
  });

  it("local Issue deletion is owner-only and removes the Issue", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Disposable local Issue" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    expect((await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`, { method: "DELETE" })).status).toBe(403);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "owner", name: "Owner", role: "owner" } }),
    });
    expect((await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`, { method: "DELETE" })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`)).status).toBe(404);
  });

  it("treats the configured dev user as page owner even when the platform role is user", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    server = await startMiniServer({
      port: 0, dataDir, projectDir, prodServer: "https://example.test", apiKey: "", devUserId: "alice", devPageName: "api-contract-mini",
      devContext: { user: { id: "alice", name: "Alice", role: "user" }, timeMode: "real", now: null, recentUsers: [] },
    });
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const created = await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "__localapp_dev_page_owner__/api-contract-mini", name: "Owner label", color: "1f6feb" }),
    });
    expect(created.status).toBe(201);
  });

  it("local Issue API uses dev context identity and owner permissions", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "owned by alice", label: "bug" }),
    });
    const createdBody = await created.json() as { data: { id: number } };

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    const denied = await fetch(`${baseUrl}/api/issues/${createdBody.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", status: "closed", stateReason: "not_planned" }),
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ success: false, error: "Permission denied" });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const closed = await fetch(`${baseUrl}/api/issues/${createdBody.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", status: "closed", stateReason: "not_planned" }),
    });
    expect(closed.status).toBe(200);
    expect(await closed.json()).toMatchObject({ success: true, data: { status: "closed", state_reason: "not_planned" } });

    const byReason = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&status=closed&reason=not_planned`);
    expect(byReason.status).toBe(200);
    expect(await byReason.json()).toMatchObject({ data: [expect.objectContaining({ id: createdBody.data.id })], meta: { total: 1, closed: 1 } });
    const completedOnly = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&status=closed&reason=completed`);
    expect(await completedOnly.json()).toMatchObject({ data: [], meta: { total: 0, closed: 0 } });

    const reopened = await fetch(`${baseUrl}/api/issues/${createdBody.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", status: "open" }),
    });
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ success: true, data: { status: "open", state_reason: null } });

    const stale = await fetch(`${baseUrl}/api/issues/${createdBody.data.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", description: "stale task toggle", expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ success: false, code: "issue_content_conflict" });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: null }),
    });
    const anonymous = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "anonymous" }),
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get("content-type")).toContain("application/json");
  });

  it("local Issue API mirrors collaboration metadata and permission boundaries", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "local collaboration", label: "bug" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const labelResponse = await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", name: "紧急", color: "b60205" }),
    });
    expect(labelResponse.status).toBe(201);
    const label = (await labelResponse.json() as { data: { id: string } }).data;
    expect((await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", name: "紧急", color: "ff0000" }),
    })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/issues/labels/bug`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", name: "Changed", color: "ff0000" }),
    })).status).toBe(404);

    const labels = await fetch(`${baseUrl}/api/issues/${issue.id}/labels`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", labelIds: [label.id] }),
    });
    expect(labels.status).toBe(200);
    const assignees = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", userIds: ["alice"] }),
    });
    expect(assignees.status).toBe(200);

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    const subscribed = await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", subscribed: true, userId: "alice" }),
    });
    expect(subscribed.status).toBe(200);
    const denied = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", userIds: ["bob"] }),
    });
    expect(denied.status).toBe(403);

    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(detail.json()).resolves.toMatchObject({
      success: true,
      data: {
        collaboration: {
          labels: expect.arrayContaining([expect.objectContaining({ id: label.id, name: "紧急" })]),
          assignee_ids: ["alice"],
          subscriber_ids: ["bob"],
          participant_ids: expect.arrayContaining(["alice", "local-owner"]),
        },
        timeline: expect.arrayContaining([
          { kind: "event", event: expect.objectContaining({ event_type: "labels_changed", actor_id: "local-owner" }) },
          { kind: "event", event: expect.objectContaining({ event_type: "assignees_changed", actor_id: "local-owner" }) },
          { kind: "event", event: expect.objectContaining({ event_type: "subscribed", actor_id: "bob" }) },
        ]),
      },
    });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const ownerDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    const ownerDetailBody = await ownerDetail.json();
    expect(ownerDetailBody.data.collaboration.subscriber_ids).toEqual([]);
    expect(ownerDetailBody.data.timeline).not.toEqual(expect.arrayContaining([
      { kind: "event", event: expect.objectContaining({ event_type: "subscribed" }) },
    ]));
  });

  it("local Issue API returns JSON envelopes for invalid requests", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    const cases = [
      fetch(`${baseUrl}/api/issues`, { method: "DELETE" }),
      fetch(`${baseUrl}/api/issues?pagePath=invalid&status=open`),
      fetch(`${baseUrl}/api/issues/999`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: "owner/api-contract-mini", status: "closed" }),
      }),
    ];

    for (const response of await Promise.all(cases)) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ success: false });
    }
  });

  it("local Issue API rejects page paths for a different dev application", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    const list = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fother-app`);
    expect(list.status).toBe(404);
    const create = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/other-app", title: "must not leak" }),
    });
    expect(create.status).toBe(404);
  });

  it("local Issue API provides comments, editing, and status events in the detail timeline", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "timeline issue", description: "body", label: "bug" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;

    const commentResponse = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagePath: "owner/api-contract-mini",
        body: "**Reproduced** locally",
        draftId: "comment-draft",
        attachmentIds: [],
        statusAction: "closed",
        stateReason: "not_planned",
      }),
    });
    expect(commentResponse.status).toBe(201);
    const commentDetail = await commentResponse.json() as {
      data: { timeline: Array<{ kind: string; comment?: { id: number } }> };
    };
    const comment = commentDetail.data.timeline.find((item) => item.kind === "comment")!.comment!;

    const invalidStatus = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "invalid", statusAction: "archive" }),
    });
    expect(invalidStatus.status).toBe(400);

    const invalidReason = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "invalid reason", statusAction: "closed", stateReason: "duplicate" }),
    });
    expect(invalidReason.status).toBe(400);

    const detailResponse = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({
      success: true,
      data: {
        issue: { status: "closed", state_reason: "not_planned" },
        timeline: expect.arrayContaining([
          { kind: "event", event: expect.objectContaining({ event_type: "opened", actor_id: "alice" }) },
          { kind: "comment", comment: expect.objectContaining({ id: comment.id, body: "**Reproduced** locally", author_id: "alice" }) },
          { kind: "event", event: expect.objectContaining({ event_type: "closed", actor_id: "alice" }) },
        ]),
      },
    });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "owner" } }),
    });
    const denied = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "owner rewrite" }),
    });
    expect(denied.status).toBe(403);

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "user" } }),
    });
    const edited = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "edited by author" }),
    });
    expect(edited.status).toBe(200);
    const editedBody = await edited.json();
    expect(editedBody.data.timeline).toEqual(expect.arrayContaining([
      { kind: "comment", comment: expect.objectContaining({ id: comment.id, revision_count: 1 }) },
    ]));
    const commentHistory = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}/history?pagePath=owner%2Fapi-contract-mini`);
    expect(commentHistory.status).toBe(200);
    await expect(commentHistory.json()).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining({ target_type: "comment", target_id: comment.id, body: "**Reproduced** locally" })],
    });
    expect(editedBody).toMatchObject({
      success: true,
      data: { timeline: expect.arrayContaining([{ kind: "comment", comment: expect.objectContaining({ body: "edited by author" }) }]) },
    });
  });

  it("automatically subscribes local Issue creators and comment participants", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Participating subscription", label: "bug" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;
    const creatorDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(creatorDetail.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["alice"] } } });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    const commented = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "I am participating", draftId: "participating-subscription", attachmentIds: [] }),
    });
    expect(commented.status).toBe(201);
    await expect(commented.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["bob"] } } });

    const unsubscribed = await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", subscribed: false }),
    });
    await expect(unsubscribed.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: [] } } });
  });

  it("automatically subscribes newly assigned local users and preserves subscription after removal", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Assignment subscription", label: "bug" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    const assigned = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", userIds: ["bob"] }),
    });
    expect(assigned.status).toBe(200);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    const assignedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(assignedDetail.json()).resolves.toMatchObject({ data: { collaboration: { assignee_ids: ["bob"], subscriber_ids: ["bob"] } } });

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "local-owner", name: "Owner", role: "owner" } }),
    });
    await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", userIds: [] }),
    });
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    const removedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(removedDetail.json()).resolves.toMatchObject({ data: { collaboration: { assignee_ids: [], subscriber_ids: ["bob"] } } });
  });

  it("automatically subscribes newly mentioned local users and respects unsubscribe on unchanged edits", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "user" } }),
    });
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Mention subscription", description: "Please review @bob", label: "bug" }),
    });
    const issue = (await created.json() as { data: { id: number; updated_at: string } }).data;
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    const mentionedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(mentionedDetail.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["bob"] } } });
    await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", subscribed: false }),
    });
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "user" } }),
    });
    const edited = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", description: "Please review @bob when ready", expectedUpdatedAt: issue.updated_at }),
    });
    expect(edited.status).toBe(200);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    const unchangedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    await expect(unchangedDetail.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: [] } } });
  });

  it("local Issue API toggles body and comment reactions without a platform connection", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "local reaction" }),
    });
    const issue = (await created.json() as { data: { id: number } }).data;
    const commented = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "react here", draftId: "reaction", attachmentIds: [] }),
    });
    const commentDetail = await commented.json() as { data: { timeline: Array<{ kind: string; comment?: { id: number } }> } };
    const comment = commentDetail.data.timeline.find((item) => item.kind === "comment")!.comment!;

    const reacted = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", commentId: comment.id, content: "heart", reacted: true }),
    });
    expect(reacted.status).toBe(200);
    await expect(reacted.json()).resolves.toMatchObject({
      success: true,
      data: { reactions: [expect.objectContaining({ comment_id: comment.id, user_id: "alice", content: "heart" })] },
    });

    const duplicate = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", commentId: comment.id, content: "heart", reacted: true }),
    });
    expect((await duplicate.json() as { data: { reactions: unknown[] } }).data.reactions).toHaveLength(1);

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: null }),
    });
    const anonymous = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", content: "+1", reacted: true }),
    });
    expect(anonymous.status).toBe(401);
    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice", role: "owner" } }),
    });
    const invalid = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", content: "fire", reacted: true }),
    });
    expect(invalid.status).toBe(400);
  });

  it("local Issue API locks conversations without a platform connection", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", title: "Local lock" }),
    }).then((response) => response.json()) as { data: { id: number } };
    const issue = created.data;

    const invalidReason = await fetch(`${baseUrl}/api/issues/${issue.id}/lock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", locked: true, reason: "other" }),
    });
    expect(invalidReason.status).toBe(400);

    const locked = await fetch(`${baseUrl}/api/issues/${issue.id}/lock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", locked: true, reason: "too_heated" }),
    });
    expect(locked.status).toBe(200);
    await expect(locked.json()).resolves.toMatchObject({ data: { issue: { locked_at: expect.any(String), locked_by: "alice", lock_reason: "too_heated" } } });
    const lockedList = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&status=open&locked=true`);
    expect((await lockedList.json() as { data: Array<{ id: number }> }).data.map(({ id }) => id)).toContain(issue.id);

    const comment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "blocked", draftId: "locked", attachmentIds: [] }),
    });
    expect(comment.status).toBe(409);
    await expect(comment.json()).resolves.toMatchObject({ code: "issue_locked" });

    const reaction = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", content: "+1", reacted: true }),
    });
    expect(reaction.status).toBe(409);

    const unlocked = await fetch(`${baseUrl}/api/issues/${issue.id}/lock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", locked: false }),
    });
    expect(unlocked.status).toBe(200);
  });

  it("local Issue API stores draft attachments outside dev.db and serves safe headers", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const form = new FormData();
    form.append("pagePath", "owner/api-contract-mini");
    form.append("draftId", "new-issue-draft");
    form.append("file", new Blob(["fake-png"], { type: "image/png" }), "screen.png");

    const uploaded = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: form });
    expect(uploaded.status).toBe(201);
    const attachment = (await uploaded.json() as { data: { id: string; url: string } }).data;
    expect(attachment).toMatchObject({ id: expect.any(String), url: expect.stringContaining("/api/issues/attachments/") });
    const wrongPageRead = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=other%2Fapp`);
    expect(wrongPageRead.status).toBe(404);

    const rejectedPartial = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagePath: "owner/api-contract-mini",
        title: "must roll back",
        label: "bug",
        draftId: "new-issue-draft",
        attachmentIds: [attachment.id, "missing-attachment"],
      }),
    });
    expect(rejectedPartial.status).toBe(400);
    const afterRejected = await fetch(`${baseUrl}/api/issues?pagePath=owner%2Fapi-contract-mini&status=open`);
    expect(await afterRejected.json()).toMatchObject({ success: true, data: [], meta: { total: 0 } });

    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pagePath: "owner/api-contract-mini",
        title: "has screenshot",
        description: `![screen](${attachment.url})`,
        label: "bug",
        draftId: "new-issue-draft",
        attachmentIds: [attachment.id],
      }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json() as { data: { id: number; updated_at: string } }).data;

    const commentForm = new FormData();
    commentForm.append("pagePath", "owner/api-contract-mini");
    commentForm.append("draftId", "attachment-only-comment");
    commentForm.append("file", new Blob(["comment-file"], { type: "text/plain" }), "comment.txt");
    const commentUpload = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: commentForm });
    const commentAttachment = (await commentUpload.json() as { data: { id: string } }).data;
    const attachmentOnlyComment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "", draftId: "attachment-only-comment", attachmentIds: [commentAttachment.id] }),
    });
    expect(attachmentOnlyComment.status).toBe(201);
    const attachmentOnlyDetail = await attachmentOnlyComment.json() as { data: { timeline: Array<{ kind: string; comment?: { id: number; body: string; updated_at: string } }>; attachments: Array<{ id: string; comment_id: number | null }> } };
    expect(attachmentOnlyDetail).toMatchObject({
      data: {
        timeline: expect.arrayContaining([{ kind: "comment", comment: expect.objectContaining({ body: "" }) }]),
        attachments: expect.arrayContaining([expect.objectContaining({ id: commentAttachment.id, comment_id: expect.any(Number) })]),
      },
    });
    const attachmentOnlyRecord = attachmentOnlyDetail.data.timeline.find((item) => item.kind === "comment" && item.comment?.body === "")!.comment!;
    const attachmentOnlyEdit = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${attachmentOnlyRecord.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "", expectedUpdatedAt: attachmentOnlyRecord.updated_at, draftId: "attachment-only-edit", attachmentIds: [] }),
    });
    expect(attachmentOnlyEdit.status).toBe(200);
    for (const removedAttachmentIds of [["missing-bound-attachment"], [commentAttachment.id, commentAttachment.id]]) {
      const invalidRemoval = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${attachmentOnlyRecord.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "Must not partially remove", expectedUpdatedAt: attachmentOnlyRecord.updated_at, draftId: "attachment-only-edit", attachmentIds: [], removedAttachmentIds }),
      });
      expect(invalidRemoval.status).toBe(400);
    }
    const removeBoundAttachment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${attachmentOnlyRecord.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", body: "Removed obsolete attachment", expectedUpdatedAt: attachmentOnlyRecord.updated_at, draftId: "attachment-only-edit", attachmentIds: [], removedAttachmentIds: [commentAttachment.id] }),
    });
    expect(removeBoundAttachment.status).toBe(200);
    expect(await removeBoundAttachment.json()).not.toMatchObject({ data: { attachments: expect.arrayContaining([expect.objectContaining({ id: commentAttachment.id })]) } });
    const removedRead = await fetch(`${baseUrl}/api/issues/attachments/${commentAttachment.id}?pagePath=owner%2Fapi-contract-mini`);
    expect(removedRead.status).toBe(404);

    const currentIssueDetail = (await (await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`)).json() as { data: { issue: { updated_at: string } } }).data;
    const removeIssueAttachment = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", description: "Removed obsolete Issue attachment", expectedUpdatedAt: currentIssueDetail.issue.updated_at, draftId: "issue-attachment-edit", attachmentIds: [], removedAttachmentIds: [attachment.id] }),
    });
    expect(removeIssueAttachment.status).toBe(200);
    const issueAfterAttachmentRemoval = (await removeIssueAttachment.json() as { data: { updated_at: string } }).data;
    const removedIssueAttachmentRead = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=owner%2Fapi-contract-mini`);
    expect(removedIssueAttachmentRead.status).toBe(404);

    const editForm = new FormData();
    editForm.append("pagePath", "owner/api-contract-mini");
    editForm.append("draftId", "edit-issue-draft");
    editForm.append("file", new Blob(["edit-file"], { type: "text/plain" }), "edit.txt");
    const editUpload = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: editForm });
    const editAttachment = (await editUpload.json() as { data: { id: string; url: string } }).data;
    const edited = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath: "owner/api-contract-mini", description: "edited with attachment", expectedUpdatedAt: issueAfterAttachmentRemoval.updated_at, draftId: "edit-issue-draft", attachmentIds: [editAttachment.id] }),
    });
    expect(edited.status).toBe(200);

    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=owner%2Fapi-contract-mini`);
    const detailBody = await detail.json() as { data: { attachments: Array<Record<string, unknown>> } };
    expect(detailBody.data.attachments).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: attachment.id })]));
    expect(detailBody.data.attachments[0]).not.toHaveProperty("storage_key");
    expect(detailBody.data.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ id: editAttachment.id, issue_id: issue.id })]));

    const read = await fetch(`${baseUrl}${editAttachment.url}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(read.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await read.arrayBuffer()).toString()).toBe("edit-file");
    expect(fs.existsSync(path.join(dataDir, "issues", "attachments", attachment.id))).toBe(false);
  });

  it("rejects a 21st local draft attachment without retaining metadata or a file", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const dbPath = path.join(dataDir, "dev.db");
    for (let index = 0; index < 20; index += 1) {
      await insertIssueAttachment(dbPath, {
        id: `local-limit-${index}`, pagePath: "owner/api-contract-mini", draftId: "local-limit", uploaderId: "alice",
        storageKey: `local-limit-${index}`, fileName: `${index}.txt`, mimeType: "text/plain", sizeBytes: 1,
      });
    }
    const attachmentDir = path.join(dataDir, "issues", "attachments");
    fs.mkdirSync(attachmentDir, { recursive: true });
    const before = fs.readdirSync(attachmentDir);
    const form = new FormData();
    form.append("pagePath", "owner/api-contract-mini");
    form.append("draftId", "local-limit");
    form.append("file", new Blob(["x"], { type: "text/plain" }), "overflow.txt");

    const response = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: form });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: "attachment_limit_exceeded",
      error: "每个草稿最多添加 20 个附件",
    });
    expect(fs.readdirSync(attachmentDir)).toEqual(before);
  });

  it("local Issue API releases only a matching unbound draft attachment file", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const form = new FormData();
    form.append("pagePath", "owner/api-contract-mini");
    form.append("draftId", "discard-draft");
    form.append("file", new Blob(["discard"], { type: "image/png" }), "discard.png");
    const uploaded = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: form });
    const attachment = (await uploaded.json() as { data: { id: string } }).data;
    const attachmentPath = path.join(dataDir, "issues", "attachments", attachment.id);
    expect(fs.existsSync(attachmentPath)).toBe(true);

    const wrongDraft = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=owner%2Fapi-contract-mini&draftId=wrong`, { method: "DELETE" });
    expect(wrongDraft.status).toBe(404);
    expect(fs.existsSync(attachmentPath)).toBe(true);

    const released = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=owner%2Fapi-contract-mini&draftId=discard-draft`, { method: "DELETE" });
    expect(released.status).toBe(200);
    expect(fs.existsSync(attachmentPath)).toBe(false);
    expect((await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=owner%2Fapi-contract-mini`)).status).toBe(404);
  });

  it("local Issue API restores draft metadata when attachment file deletion fails", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const form = new FormData();
    form.append("pagePath", "owner/api-contract-mini");
    form.append("draftId", "retry-discard");
    form.append("file", new Blob(["retry"], { type: "image/png" }), "retry.png");
    const uploaded = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: form });
    const attachment = (await uploaded.json() as { data: { id: string } }).data;
    const attachmentPath = path.join(dataDir, "issues", "attachments", attachment.id);
    const removeSpy = vi.spyOn(fs, "rmSync").mockImplementationOnce(() => { throw new Error("disk busy"); });

    const released = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=owner%2Fapi-contract-mini&draftId=retry-discard`, { method: "DELETE" });
    removeSpy.mockRestore();
    expect(released.status).toBe(503);
    expect(fs.existsSync(attachmentPath)).toBe(true);
    expect((await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=owner%2Fapi-contract-mini`)).status).toBe(200);
  });

  it("dev snapshots restore Issue attachments and reset removes them", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const form = new FormData();
    form.append("pagePath", "owner/api-contract-mini");
    form.append("draftId", "snapshot-draft");
    form.append("file", new Blob(["snapshot-file"], { type: "application/pdf" }), "report.pdf");
    const uploaded = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: form });
    const attachment = (await uploaded.json() as { data: { id: string } }).data;
    const attachmentPath = path.join(dataDir, "issues", "attachments", attachment.id);

    const snapshotResponse = await fetch(`${baseUrl}/api/dev/data/snapshots`, { method: "POST" });
    const snapshot = (await snapshotResponse.json() as { data: { id: string } }).data;
    fs.rmSync(attachmentPath);
    expect(fs.existsSync(attachmentPath)).toBe(false);

    const restored = await fetch(`${baseUrl}/api/dev/data/snapshots/${snapshot.id}/restore`, { method: "POST" });
    expect(restored.status).toBe(200);
    expect(fs.readFileSync(attachmentPath, "utf8")).toBe("snapshot-file");

    const reset = await fetch(`${baseUrl}/api/dev/data/reset`, { method: "POST" });
    expect(reset.status).toBe(200);
    expect(fs.existsSync(path.join(dataDir, "issues", "attachments"))).toBe(false);
  });

  it("/api/actions/:name rejects hosted actions while named SQL remains usable", async () => {
    const { projectDir, dataDir } = createProjectWithApiContract();
    writeNamedSqlBackend(projectDir);

    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "",
      projectDir,
    });
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user: { id: "alice", name: "Alice" } }),
    });

    const response = await fetch(`${baseUrl}/api/actions/work_items.currentUser`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { status: "todo" } }),
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "hosted_actions_disabled",
    });

    const named = await fetch(`${baseUrl}/api/queries/work_items.byStatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { status: "todo" } }),
    });
    expect(named.status).toBe(200);
    expect(await named.json()).toMatchObject({
      success: true,
      data: {
        rows: expect.arrayContaining([{ title: "todo one" }, { title: "todo two" }]),
      },
    });
  });

  it("/api/collaboration/commit checks baseRevision, advances revision, and writes operation log", async () => {
    const { projectDir, dataDir } = createProjectWithCollaboration();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    const ok = await fetch(`${baseUrl}/api/collaboration/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "tasks",
        recordId: "task-1",
        baseRevision: 0,
        operationId: "op-local",
        params: { id: "task-1", title: "Local Updated" },
      }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ success: true, data: { revision: 1, operationId: "op-local" } });

    const dbPath = path.join(dataDir, "dev.db");
    await getConnection(dbPath);
    expect(execRawSql(dbPath, "SELECT title FROM tasks WHERE id = ?", ["task-1"]).rows).toEqual([{ title: "Local Updated" }]);
    expect(execRawSql(dbPath, "SELECT revision FROM _localapp_record_revisions WHERE resource = ? AND record_id = ?", ["tasks", "task-1"]).rows).toEqual([{ revision: 1 }]);
    expect(execRawSql(dbPath, "SELECT operation_id, actor_id FROM _localapp_operation_log WHERE resource = ? AND record_id = ?", ["tasks", "task-1"]).rows).toEqual([{ operation_id: "op-local", actor_id: "alice" }]);

    const conflict = await fetch(`${baseUrl}/api/collaboration/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "tasks",
        recordId: "task-1",
        baseRevision: 0,
        operationId: "op-conflict",
        params: { id: "task-1", title: "Stale" },
      }),
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      success: false,
      code: "revision_conflict",
      data: { serverRevision: 1 },
    });
  });

  it("/api/collaboration/events sends committed events to another local tab", async () => {
    const { projectDir, dataDir } = createProjectWithCollaboration();
    const baseUrl = await listenMiniServer(projectDir, dataDir);
    const events = fetch(`${baseUrl}/api/collaboration/events?resource=tasks`);

    const ok = await fetch(`${baseUrl}/api/collaboration/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "tasks",
        recordId: "task-1",
        baseRevision: 0,
        operationId: "op-event",
        params: { id: "task-1", title: "Evented" },
      }),
    });
    expect(ok.status).toBe(200);

    const response = await events;
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + 1_500;
    while (Date.now() < deadline) {
      const { value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/event: collab:operation_committed\ndata: (.+)\n\n/);
      if (match) {
        await reader.cancel();
        expect(JSON.parse(match[1])).toMatchObject({
          type: "collab:operation_committed",
          data: { resource: "tasks", recordId: "task-1", revision: 1, actorId: "alice", operationId: "op-event" },
        });
        return;
      }
    }
    await reader.cancel();
    throw new Error(`No committed event received. Buffer: ${buffer}`);
  });

  it("/api/presence/events sends local online counts without using collaboration events", async () => {
    const { projectDir, dataDir } = createProjectWithCollaboration();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    const heartbeat = await fetch(`${baseUrl}/api/presence/heartbeat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "background-tab" }),
    });
    expect(heartbeat.status).toBe(200);

    const first = await fetch(`${baseUrl}/api/presence/events?clientId=first-tab`);
    expect(first.status).toBe(200);
    const firstReader = first.body!.getReader();
    await expect(readPresenceCount(firstReader)).resolves.toBe(1);

    const second = await fetch(`${baseUrl}/api/presence/events?clientId=second-tab`);
    expect(second.status).toBe(200);
    const secondReader = second.body!.getReader();
    await expect(readPresenceCount(secondReader)).resolves.toBe(1);

    await firstReader.cancel();
    await expect(readPresenceCount(secondReader)).resolves.toBe(1);
    await secondReader.cancel();

    const leave = await fetch(`${baseUrl}/api/presence/leave`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId: "background-tab" }),
    });
    expect(leave.status).toBe(200);

    const collabWithoutResource = await fetch(`${baseUrl}/api/collaboration/events`);
    expect(collabWithoutResource.status).toBe(200);
    const reader = collabWithoutResource.body!.getReader();
    const firstChunk = await reader.read();
    await reader.cancel();
    expect(new TextDecoder().decode(firstChunk.value)).not.toContain("presence:snapshot");
  });

  it("Dev Toolkit user switch changes local operation actorId", async () => {
    const { projectDir, dataDir } = createProjectWithCollaboration();
    const baseUrl = await listenMiniServer(projectDir, dataDir);

    const switched = await fetch(`${baseUrl}/api/dev/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: { id: "bob", name: "Bob", role: "user" } }),
    });
    expect(switched.status).toBe(200);

    const ok = await fetch(`${baseUrl}/api/collaboration/commit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resource: "tasks",
        recordId: "task-1",
        baseRevision: 0,
        operationId: "op-bob",
        params: { id: "task-1", title: "Bob Updated" },
      }),
    });
    expect(ok.status).toBe(200);

    const dbPath = path.join(dataDir, "dev.db");
    await getConnection(dbPath);
    expect(execRawSql(dbPath, "SELECT actor_id FROM _localapp_operation_log WHERE operation_id = ?", ["op-bob"]).rows).toEqual([{ actor_id: "bob" }]);
  });

  // 注：covers SDK public API routes (含 /api/work_items REST CRUD, /api/work_items/count,
  // /api/db/exec 端点) 和 applies manifest.business defaultFields, enums, and recordAccess
  // (REST CRUD 中间件下沉逻辑) 两个测试已随 REST CRUD / raw SQL 端点整体移除
  // （restrict-app-api-to-named-sql 变更）。

  // 注：lists/executes/rejects/uses dev context for local transitions 四个测试
  // 已随服务端 transition 端点整体移除（restrict-app-api-to-named-sql 变更）。
  // 状态流转现在通过 named mutation 执行（$<resource>.<action>），可用动作由
  // 前端 SDK 通过 availableTransitions 本地计算。

  // 注：resets dev.db / saves and restores snapshots / records recent request diagnostics
  // 三个测试用 REST CRUD /api/tasks 做种子写入和验证，REST CRUD 移除后需要重写为
  // named SQL 路径。这些 dev data 管理功能本身保留，只是测试需要换写法——
  // 后续补 named SQL seed mutation + /api/mutations/$tasks.list 验证即可。

  it("returns manifest business config for DevShell", async () => {
    const { projectDir, dataDir } = createProjectWithSeed();
    server = await startMiniServer({
      port: 0,
      dataDir,
      prodServer: "https://example.test",
      apiKey: "test-key",
      projectDir,
    });
    const address = server.address() as { port: number };
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const response = await fetch(`${baseUrl}/api/dev/business`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: {
        tasks: {
          ownerField: "created_by",
          recordAccess: { read: "authenticated", create: "owner" },
        },
      },
    });
  });

  // 注：/api/upload 把文件保存到 dev-uploads 测试已随 legacy upload 端点整体
  // 移除（restrict-app-api-to-named-sql 变更）。文件上传统一走 /api/content/upload。

  it("/api/platform/* 转发生产 server 并缓存同一资源", async () => {
    let upstreamHits = 0;
    const upstream = http.createServer((req, res) => {
      upstreamHits += 1;
      expect(req.headers["x-api-key"]).toBe("test-key");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, data: [{ id: "u1", name: "User 1" }] }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "test-key",
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const first = await fetch(`${baseUrl}/api/platform/users`);
      const second = await fetch(`${baseUrl}/api/platform/users`);

      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ success: true, data: [{ id: "u1", name: "User 1" }] });
      expect(second.status).toBe(200);
      expect(await second.json()).toEqual({ success: true, data: [{ id: "u1", name: "User 1" }] });
      expect(upstreamHits).toBe(1);
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("/api/platform/* returns stable dev mock data when upstream is unavailable", async () => {
    server = createMiniServer({
      port: 0,
      dataDir: ".localapp",
      prodServer: "http://127.0.0.1:1",
      apiKey: "test-key",
    });
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };

    const response = await fetch(`http://127.0.0.1:${address.port}/api/platform/users`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      success: true,
      data: expect.arrayContaining([expect.objectContaining({ id: "dev-user", name: "dev-user" })]),
      source: "cache",
    });
  });

  it("/api/platform/* stays local when no API key is configured", async () => {
    let upstreamHits = 0;
    const upstream = http.createServer((_req, res) => {
      upstreamHits += 1;
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: false, error: "should not be called" }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "",
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${address.port}`;

      const [users, groups, roles, version] = await Promise.all([
        fetch(`${baseUrl}/api/platform/users`),
        fetch(`${baseUrl}/api/platform/groups`),
        fetch(`${baseUrl}/api/platform/roles`),
        fetch(`${baseUrl}/api/platform/version`),
      ]);

      expect(upstreamHits).toBe(0);
      expect(users.status).toBe(200);
      expect(await users.json()).toMatchObject({
        success: true,
        data: expect.arrayContaining([expect.objectContaining({ id: "dev-user" })]),
        source: "mock",
      });
      expect(groups.status).toBe(200);
      expect(await groups.json()).toMatchObject({
        success: true,
        data: expect.arrayContaining([expect.objectContaining({ id: "dev-team" })]),
        source: "mock",
      });
      expect(roles.status).toBe(200);
      expect(await roles.json()).toMatchObject({
        success: true,
        data: [
          expect.objectContaining({ id: "admin", name: "Admin" }),
          expect.objectContaining({ id: "user", name: "User" }),
        ],
        source: "mock",
      });
      expect(version.status).toBe(200);
      expect(await version.json()).toMatchObject({
        success: true,
        data: { version: "local-dev" },
        source: "mock",
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("dev user picker stays local when no API key is configured", async () => {
    let upstreamHits = 0;
    const upstream = http.createServer((_req, res) => {
      upstreamHits += 1;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ success: true, data: [{ id: "remote-user" }] }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const upstreamAddress = upstream.address() as { port: number };

    try {
      server = createMiniServer({
        port: 0,
        dataDir: ".localapp",
        prodServer: `http://127.0.0.1:${upstreamAddress.port}`,
        apiKey: "",
      });
      await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
      const address = server.address() as { port: number };
      const response = await fetch(`http://127.0.0.1:${address.port}/api/dev/users`);

      expect(upstreamHits).toBe(0);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        success: true,
        data: {
          users: [expect.objectContaining({ id: "dev-user" })],
          source: "local",
          error: null,
        },
      });
    } finally {
      await new Promise<void>((resolve, reject) => {
        upstream.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });

  it("优雅退出时 flush db 并关闭 HTTP server", async () => {
    const flush = vi.fn();
    const close = vi.fn((callback: (error?: Error) => void) => callback());
    const exit = vi.fn();

    const shutdown = createGracefulShutdown({
      server: { close } as unknown as http.Server,
      flush,
      exit,
    });

    shutdown();

    await vi.waitFor(() => {
      expect(flush).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(exit).toHaveBeenCalledWith(0);
    });
  });
});

async function readPresenceCount(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<number> {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const { value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/event: presence:snapshot\ndata: (.+)\n\n/);
    if (match) return JSON.parse(match[1]).data.count;
  }
  throw new Error(`No presence count event received. Buffer: ${buffer}`);
}
