import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadBackendContract,
  executeNamedSql,
  executeNamedSqlTransaction,
  validateBackendContract,
  type NamedSqlExecutionResult,
  type BackendManifestConfig,
  createGeneratedNamedSqlSecurity,
} from "../backend-contract.js";
import { setGroupMembershipResolver } from "../access-control.js";
import { createTable, getConnection, getDbPath, execRawSql } from "../app-db.js";
import type { DataSchema } from "../../types/models.js";

const RESOURCE_SCHEMA_URL = "https://localapp.dev/schemas/backend/resource-schema.schema.json";
const QUERIES_SCHEMA_URL = "https://localapp.dev/schemas/backend/queries.schema.json";
const MUTATIONS_SCHEMA_URL = "https://localapp.dev/schemas/backend/mutations.schema.json";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeResource(projectDir: string, resource: string, overrides?: {
  schema?: Record<string, unknown>;
  queries?: Record<string, unknown>;
  mutations?: Record<string, unknown>;
}): void {
  const resourceDir = path.join(projectDir, "backend", "resources", resource);
  writeJson(path.join(resourceDir, "schema.json"), {
    $schema: RESOURCE_SCHEMA_URL,
    name: resource,
    fields: {
      id: { type: "auto_increment" },
      title: { type: "string", constraints: { required: true } },
      status: { type: "string" },
    },
    ...overrides?.schema,
  });
  writeJson(path.join(resourceDir, "queries.json"), {
    $schema: QUERIES_SCHEMA_URL,
    queries: {
      [`${resource}.list`]: {
        kind: "query",
        sql: `SELECT id, title, status FROM ${resource} WHERE status = :status`,
        params: {
          status: { type: "string", required: true },
        },
        access: "authenticated",
      },
    },
    ...overrides?.queries,
  });
  writeJson(path.join(resourceDir, "mutations.json"), {
    $schema: MUTATIONS_SCHEMA_URL,
    mutations: {
      [`${resource}.complete`]: {
        kind: "mutation",
        sql: `UPDATE ${resource} SET status = 'done' WHERE id = :id`,
        params: {
          id: { type: "number", required: true },
        },
        access: "authenticated",
      },
    },
    ...overrides?.mutations,
  });
}

describe("backend contract files", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-backend-contract-"));
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("discovers schema, query and mutation files from manifest backend.root", () => {
    writeResource(projectDir, "work_items");

    const contract = loadBackendContract(projectDir, { root: "backend" });

    expect(contract.files.map((file) => file.relativePath).sort()).toEqual([
      "backend/resources/work_items/mutations.json",
      "backend/resources/work_items/queries.json",
      "backend/resources/work_items/schema.json",
    ]);
    expect(contract.resources.work_items.schema.name).toBe("work_items");
    expect(contract.queries["work_items.list"].sql).toContain("SELECT");
    expect(contract.mutations["work_items.complete"].sql).toContain("UPDATE");
  });

  it("rejects backend.include patterns that do not match files", () => {
    expect(() => loadBackendContract(projectDir, {
      include: ["backend/resources/**/schema.json"],
    })).toThrow(/did not match any backend contract files/i);
  });

  it("rejects backend JSON files that do not declare $schema", () => {
    writeResource(projectDir, "work_items");
    writeJson(path.join(projectDir, "backend", "resources", "work_items", "queries.json"), {
      queries: {},
    });

    expect(() => loadBackendContract(projectDir, { root: "backend" })).toThrow(/\$schema/);
  });

  it("rejects duplicate resource schema names", () => {
    writeResource(projectDir, "work_items");
    writeResource(projectDir, "tasks", { schema: { name: "work_items" } });

    expect(() => loadBackendContract(projectDir, { root: "backend" })).toThrow(/duplicate resource schema/i);
  });

  it("rejects hosted action files in stable backend contracts", () => {
    writeResource(projectDir, "work_items");
    fs.mkdirSync(path.join(projectDir, "backend", "actions"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "backend", "actions", "work-items.ts"), "export const action = {};\n");
    writeJson(path.join(projectDir, "backend", "actions.manifest.json"), {
      version: 1,
      bundle: "backend/actions.bundle.mjs",
      actions: [],
    });
    fs.writeFileSync(path.join(projectDir, "backend", "actions.bundle.mjs"), "export {};\n");

    expect(() => loadBackendContract(projectDir, { root: "backend" })).toThrow(/hosted action|disabled|named SQL/i);
  });

  it("can ignore disabled hosted action files when loading legacy versions for named SQL", () => {
    writeResource(projectDir, "work_items");
    fs.mkdirSync(path.join(projectDir, "backend", "actions"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "backend", "actions", "work-items.ts"), "export const action = {};\n");
    writeJson(path.join(projectDir, "backend", "actions.manifest.json"), {
      version: 1,
      bundle: "backend/actions.bundle.mjs",
      actions: [],
    });
    fs.writeFileSync(path.join(projectDir, "backend", "actions.bundle.mjs"), "export {};\n");

    const contract = loadBackendContract(projectDir, { root: "backend" }, { allowDisabledHostedActions: true });

    expect(contract.files.map((file) => file.relativePath).sort()).toEqual([
      "backend/resources/work_items/mutations.json",
      "backend/resources/work_items/queries.json",
      "backend/resources/work_items/schema.json",
    ]);
    expect(contract.queries["work_items.list"]).toBeDefined();
    expect(contract.mutations["work_items.complete"]).toBeDefined();
  });

  it("allows resource schema files to declare only business metadata", () => {
    writeResource(projectDir, "work_items", {
      schema: {
        fields: undefined,
        business: {
          ownerField: "created_by_member_id",
          statusField: "status",
          defaultFields: {
            created_by_member_id: { defaultFrom: "currentUser.id" },
          },
          enums: {
            status: ["todo", "doing", "done"],
          },
        },
      },
    });

    const contract = loadBackendContract(projectDir, { root: "backend" });

    expect(contract.resources.work_items.schema.fields).toEqual({});
    expect(contract.resources.work_items.schema.business).toMatchObject({
      ownerField: "created_by_member_id",
    });
  });

  it("rejects named SQL with undeclared or unused params", () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.bad": {
            kind: "query",
            sql: "SELECT id FROM work_items WHERE status = :status AND owner_id = :ownerId",
            params: {
              status: { type: "string", required: true },
              unused: { type: "string" },
            },
            access: "authenticated",
          },
        },
      },
    });

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }))).toThrow(/params/i);
  });

  it("parses generated security metadata and rejects SQL drift", () => {
    const name = "work_items.mine";
    const sql = "SELECT id, title, status FROM work_items WHERE created_by = :currentUserId";
    const security = createGeneratedNamedSqlSecurity({
      name,
      kind: "query",
      sql,
      template: "owner-read-v1",
      resource: "work_items",
      config: { identityField: "created_by" },
    });
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          [name]: {
            kind: "query",
            sql,
            params: {},
            access: "authenticated",
            security,
          },
        },
      },
    });

    const contract = loadBackendContract(projectDir, { root: "backend" });
    expect(contract.queries[name].security?.mode).toBe("generated");

    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          [name]: {
            kind: "query",
            sql: "SELECT id, title, status FROM work_items",
            params: {},
            access: "authenticated",
            security,
          },
        },
      },
    });
    expect(() => loadBackendContract(projectDir, { root: "backend" })).toThrow(/security digest/i);

    const updateName = "work_items.update";
    const misplacedSql = "UPDATE work_items SET created_by = :currentUserId WHERE id = :id";
    writeResource(projectDir, "work_items", {
      mutations: {
        mutations: {
          [updateName]: {
            kind: "mutation",
            sql: misplacedSql,
            params: { id: { type: "number", required: true } },
            access: "authenticated",
            security: createGeneratedNamedSqlSecurity({
              name: updateName,
              kind: "mutation",
              sql: misplacedSql,
              template: "owner-update-v1",
              resource: "work_items",
              config: { identityField: "created_by" },
            }),
          },
        },
      },
    });
    expect(() => loadBackendContract(projectDir, { root: "backend" })).toThrow(/WHERE.*created_by/i);
  });

  it("rejects incomplete custom security metadata", () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.dashboard": {
            kind: "query",
            sql: "SELECT status, COUNT(*) FROM work_items GROUP BY status",
            params: {},
            access: "authenticated",
            security: {
              mode: "custom",
              access: "authenticated",
              resources: ["work_items"],
              systemParams: [],
              scenarios: [{ identity: "owner", expect: "allow" }],
            },
          },
        },
      },
    });

    expect(() => loadBackendContract(projectDir, { root: "backend" })).toThrow(/member.*scenario/i);
  });

  it("rejects unsafe query SQL", () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.drop": {
            kind: "query",
            sql: "SELECT id FROM work_items; DROP TABLE work_items",
            params: {},
            access: "owner",
          },
        },
      },
    });

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }))).toThrow(/unsafe|query/i);
  });

  it("rejects SQL that references unknown resources or fields", () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.unknownTable": {
            kind: "query",
            sql: "SELECT id FROM missing_items",
            params: {},
            access: "authenticated",
          },
          "work_items.unknownField": {
            kind: "query",
            sql: "SELECT ghost FROM work_items",
            params: {},
            access: "authenticated",
          },
        },
      },
    });

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }))).toThrow(/unknown.*(resource|field)/i);
  });

  it("allows CTE names while validating fields from the underlying resource", () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.cte": {
            kind: "query",
            sql: "WITH latest AS (SELECT id, title FROM work_items) SELECT * FROM latest ORDER BY id",
            params: {},
            access: "authenticated",
          },
        },
      },
    });

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }))).not.toThrow();
  });

  it("validates INSERT SELECT fields across the target and source resources without a database", () => {
    writeResource(projectDir, "ai_subscriptions", {
      schema: {
        fields: {
          id: { type: "auto_increment" },
          user_id: { type: "string" },
        },
      },
      queries: { queries: {} },
      mutations: { mutations: {} },
    });
    writeResource(projectDir, "subscription_attachments", {
      schema: {
        fields: {
          id: { type: "auto_increment" },
          subscription_id: { type: "integer" },
          user_id: { type: "string" },
          file_name: { type: "string" },
        },
      },
      queries: { queries: {} },
      mutations: {
        mutations: {
          "subscription_attachments.create": {
            kind: "mutation",
            sql: "INSERT INTO subscription_attachments (subscription_id, user_id, file_name) SELECT s.id, s.user_id, :fileName FROM ai_subscriptions s WHERE s.id = :subscriptionId AND (:currentUserId = :ownerId OR s.user_id = :currentUserId)",
            params: {
              subscriptionId: { type: "number", required: true },
              fileName: { type: "string", required: true },
            },
            access: "authenticated",
          },
        },
      },
    });

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }))).not.toThrow();
  });

  it("validates named SQL fields against database columns when fields are not duplicated in schema", async () => {
    writeResource(projectDir, "work_items", {
      schema: {
        fields: {},
        business: {
          ownerField: "created_by_member_id",
        },
      },
      queries: {
        queries: {
          "work_items.byCreator": {
            kind: "query",
            sql: "SELECT id, title, created_by_member_id FROM work_items WHERE created_by_member_id = :memberId",
            params: {
              memberId: { type: "number", required: true },
            },
            access: "authenticated",
          },
        },
      },
    });
    const db = await getConnection(getDbPath(projectDir));
    db.run("CREATE TABLE work_items (id INTEGER PRIMARY KEY, title TEXT, status TEXT, created_by_member_id INTEGER)");

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }), {
      dbPath: getDbPath(projectDir),
    })).not.toThrow();
  });

  it("validates joined named SQL against database tables instead of resource schema files", async () => {
    writeResource(projectDir, "work_items", {
      schema: {
        fields: {},
      },
      queries: {
        queries: {
          "work_items.mine": {
            kind: "query",
            sql: "SELECT wi.* FROM work_items wi JOIN workload_members wm ON wm.id = wi.created_by_member_id WHERE wm.user_id = :currentUserId",
            params: {},
            access: "authenticated",
          },
        },
      },
    });
    const db = await getConnection(getDbPath(projectDir));
    db.run("CREATE TABLE work_items (id INTEGER PRIMARY KEY, title TEXT, status TEXT, created_by_member_id INTEGER)");
    db.run("CREATE TABLE workload_members (id INTEGER PRIMARY KEY, user_id TEXT)");

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }), {
      dbPath: getDbPath(projectDir),
    })).not.toThrow();
  });

  it("rejects named SQL references to platform-owned system tables", async () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.issueLabels": {
            kind: "query",
            sql: "SELECT id, name FROM _issue_labels ORDER BY name",
            params: {},
            access: "owner",
          },
        },
      },
    });
    const db = await getConnection(getDbPath(projectDir));
    db.run("CREATE TABLE work_items (id INTEGER PRIMARY KEY, title TEXT, status TEXT)");
    db.run("CREATE TABLE _issue_labels (id TEXT PRIMARY KEY, name TEXT)");

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }), {
      dbPath: getDbPath(projectDir),
    })).toThrow(/system|protected|platform/i);
  });

  it("rejects inline backend SQL in manifest config", () => {
    const manifestBackend = {
      root: "backend",
      queries: {
        "work_items.list": { sql: "SELECT 1" },
      },
    } as unknown as BackendManifestConfig;

    expect(() => loadBackendContract(projectDir, manifestBackend)).toThrow(/inline/i);
  });

  it("loads named query result contracts for page, single and aggregate modes", () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.page": {
            kind: "query",
            sql: "SELECT id, title FROM work_items ORDER BY id LIMIT :limit OFFSET :offset",
            params: {
              limit: { type: "number", required: true },
              offset: { type: "number" },
            },
            result: { mode: "page", maxRows: 100, maxBytes: 65536 },
          },
          "work_items.get": {
            kind: "query",
            sql: "SELECT id, title FROM work_items WHERE id = :id",
            params: { id: { type: "number", required: true } },
            result: { mode: "single", maxRows: 1, maxBytes: 4096 },
          },
          "work_items.countByStatus": {
            kind: "query",
            sql: "SELECT status, COUNT(*) AS count FROM work_items GROUP BY status",
            params: {},
            result: { mode: "aggregate", maxRows: 20, maxBytes: 8192 },
          },
        },
      },
    });

    const contract = loadBackendContract(projectDir, { root: "backend" });

    expect((contract.queries["work_items.page"] as any).result).toMatchObject({ mode: "page", maxRows: 100 });
    expect((contract.queries["work_items.get"] as any).result).toMatchObject({ mode: "single", maxRows: 1 });
    expect((contract.queries["work_items.countByStatus"] as any).result).toMatchObject({ mode: "aggregate", maxRows: 20 });
    expect(() => validateBackendContract(contract)).not.toThrow();
  });

  it("rejects page result contracts that do not expose a bounded limit parameter", () => {
    writeResource(projectDir, "work_items", {
      queries: {
        queries: {
          "work_items.badPage": {
            kind: "query",
            sql: "SELECT id, title FROM work_items ORDER BY id",
            params: {},
            result: { mode: "page", maxRows: 100, maxBytes: 65536 },
          },
        },
      },
    });

    expect(() => validateBackendContract(loadBackendContract(projectDir, { root: "backend" }))).toThrow(/limit|page|pagination/i);
  });
});

describe("named SQL executor", () => {
  let pageDir: string;

  beforeEach(async () => {
    pageDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-named-sql-"));
    writeJson(path.join(pageDir, "backend", "resources", "work_items", "schema.json"), {
      $schema: RESOURCE_SCHEMA_URL,
      name: "work_items",
      fields: {
        title: { type: "string" },
        status: { type: "string" },
        assignee_id: { type: "string" },
      },
    });
    writeJson(path.join(pageDir, "backend", "resources", "work_items", "queries.json"), {
      $schema: QUERIES_SCHEMA_URL,
      queries: {
        "work_items.mine": {
          kind: "query",
          sql: "SELECT id, title FROM work_items WHERE assignee_id = :currentUserId AND status = :status",
          params: {
            status: { type: "string", required: true, enum: ["open", "done"] },
          },
          access: "authenticated",
        },
        "work_items.ownerOnly": {
          kind: "query",
          sql: "SELECT id FROM work_items",
          params: {},
          access: "owner",
        },
        "work_items.ops": {
          kind: "query",
          sql: "SELECT id FROM work_items",
          params: {},
          access: "acl",
          acl: ["group:ops"],
        },
      },
    });
    const schema: DataSchema = {
      name: "work_items",
      pageName: "test",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      fields: {
        title: { type: "string" },
        status: { type: "string" },
        assignee_id: { type: "string" },
      },
    };
    await createTable(pageDir, schema);
    const dbPath = getDbPath(pageDir);
    await getConnection(dbPath);
    execRawSql(dbPath, "INSERT INTO work_items (title, status, assignee_id) VALUES (?, ?, ?)", [
      "Mine",
      "open",
      "alice",
    ]);
    execRawSql(dbPath, "INSERT INTO work_items (title, status, assignee_id) VALUES (?, ?, ?)", [
      "Other",
      "open",
      "bob",
    ]);
  });

  afterEach(() => {
    setGroupMembershipResolver(null);
    fs.rmSync(pageDir, { recursive: true, force: true });
  });

  it("rejects frontend-supplied SQL and only accepts registered SQL names", async () => {
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.mine",
      dbPath: pageDir,
      body: {
        sql: "SELECT id, title FROM work_items",
        params: { status: "open" },
      },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    })).rejects.toThrow(/sql field/i);

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.unknown",
      dbPath: pageDir,
      body: { params: {} },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    })).rejects.toThrow(/not found/i);
  });

  it("validates request params before executing named SQL", async () => {
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.mine",
      dbPath: pageDir,
      body: { params: { status: "invalid" } },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    })).rejects.toThrow(/status/);

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.mine",
      dbPath: pageDir,
      body: { params: { status: "open", extra: true } },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    })).rejects.toThrow(/extra/);
  });

  it("injects system variables and prevents frontend override", async () => {
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.mine",
      dbPath: pageDir,
      body: { params: { status: "open", currentUserId: "bob" } },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    })).rejects.toThrow(/currentUserId/);

    const result = await executeNamedSql(contract, {
      kind: "query",
      name: "work_items.mine",
      dbPath: pageDir,
      body: { params: { status: "open" } },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    }) as Extract<NamedSqlExecutionResult, { rows: Record<string, unknown>[] }>;

    expect(result.rows).toEqual([{ id: 1, title: "Mine" }]);
  });

  it("rejects named SQL when access checks fail before execution", async () => {
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.ownerOnly",
      dbPath: pageDir,
      body: { params: {} },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    })).rejects.toThrow(/access denied/i);
  });

  it("uses existing acl group semantics for named SQL access", async () => {
    setGroupMembershipResolver((userId, groupName) => userId === "alice" && groupName === "ops");
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.ops",
      dbPath: pageDir,
      body: { params: {} },
      context: { visitorId: "bob", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    })).rejects.toThrow(/access denied/i);

    const result = await executeNamedSql(contract, {
      kind: "query",
      name: "work_items.ops",
      dbPath: pageDir,
      body: { params: {} },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    }) as Extract<NamedSqlExecutionResult, { rows: Record<string, unknown>[] }>;

    expect(result.rows).toHaveLength(2);
  });

  it("binds omitted optional params as null so patch SQL keeps existing values", async () => {
    writeJson(path.join(pageDir, "backend", "resources", "work_items", "mutations.json"), {
      $schema: MUTATIONS_SCHEMA_URL,
      mutations: {
        "work_items.patch": {
          kind: "mutation",
          sql: "UPDATE work_items SET title = COALESCE(:title, title), assignee_id = CASE WHEN :assignee_id__set_null THEN NULL ELSE COALESCE(:assignee_id, assignee_id) END WHERE id = :id",
          params: {
            id: { type: "number", required: true },
            title: { type: "string" },
            assignee_id: { type: "string", nullable: true },
            assignee_id__set_null: { type: "boolean" },
          },
          access: "authenticated",
        },
      },
    });
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await executeNamedSql(contract, {
      kind: "mutation",
      name: "work_items.patch",
      dbPath: pageDir,
      body: { params: { id: 1, title: "Renamed" } },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    });

    await executeNamedSql(contract, {
      kind: "mutation",
      name: "work_items.patch",
      dbPath: pageDir,
      body: { params: { id: 1, assignee_id__set_null: true } },
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
    });

    const rows = execRawSql(getDbPath(pageDir), "SELECT title, status, assignee_id FROM work_items WHERE id = 1").rows;
    expect(rows).toEqual([{ title: "Renamed", status: "open", assignee_id: null }]);
  });

  it("rejects named SQL query results that exceed rows and bytes budgets", async () => {
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.ops",
      dbPath: pageDir,
      body: { params: {} },
      context: { visitorId: "owner", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
      resultBudget: { maxRows: 1 },
    })).rejects.toMatchObject({ status: 413, code: "named_sql_result_too_large" });

    await expect(executeNamedSql(contract, {
      kind: "query",
      name: "work_items.ops",
      dbPath: pageDir,
      body: { params: {} },
      context: { visitorId: "owner", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
      resultBudget: { maxBytes: 10 },
    })).rejects.toMatchObject({ status: 413, code: "named_sql_result_too_large" });
  });

  it("executes registered mutations as a single transaction and rolls back on failure", async () => {
    writeJson(path.join(pageDir, "backend", "resources", "work_items", "mutations.json"), {
      $schema: MUTATIONS_SCHEMA_URL,
      mutations: {
        "work_items.rename": {
          kind: "mutation",
          sql: "UPDATE work_items SET title = :title WHERE id = :id",
          params: {
            id: { type: "number", required: true },
            title: { type: "string", required: true },
          },
          access: "authenticated",
        },
        "work_items.fail": {
          kind: "mutation",
          sql: "UPDATE missing_table SET title = :title WHERE id = :id",
          params: {
            id: { type: "number", required: true },
            title: { type: "string", required: true },
          },
          access: "authenticated",
        },
      },
    });
    const contract = loadBackendContract(pageDir, { root: "backend" });

    await expect(executeNamedSqlTransaction(contract, {
      dbPath: pageDir,
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
      mutations: [
        { name: "work_items.rename", body: { params: { id: 1, title: "Changed" } } },
        { name: "work_items.fail", body: { params: { id: 1, title: "Broken" } } },
      ],
    })).rejects.toThrow();

    const rows = execRawSql(getDbPath(pageDir), "SELECT title FROM work_items WHERE id = 1").rows;
    expect(rows).toEqual([{ title: "Mine" }]);
  });

  it("allows later transaction mutation params to reference previous results", async () => {
    const dbPath = getDbPath(pageDir);
    execRawSql(dbPath, `
      CREATE TABLE work_item_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        work_item_id INTEGER NOT NULL,
        message TEXT NOT NULL
      )
    `);
    writeJson(path.join(pageDir, "backend", "resources", "work_items", "mutations.json"), {
      $schema: MUTATIONS_SCHEMA_URL,
      mutations: {
        "work_items.create": {
          kind: "mutation",
          sql: "INSERT INTO work_items (title, status, assignee_id) VALUES (:title, :status, :assignee_id)",
          params: {
            title: { type: "string", required: true },
            status: { type: "string", required: true },
            assignee_id: { type: "string", required: true },
          },
          access: "authenticated",
        },
      },
    });
    writeJson(path.join(pageDir, "backend", "resources", "work_item_logs", "schema.json"), {
      $schema: RESOURCE_SCHEMA_URL,
      name: "work_item_logs",
      fields: {
        work_item_id: { type: "number" },
        message: { type: "string" },
      },
    });
    writeJson(path.join(pageDir, "backend", "resources", "work_item_logs", "mutations.json"), {
      $schema: MUTATIONS_SCHEMA_URL,
      mutations: {
        "work_item_logs.create": {
          kind: "mutation",
          sql: "INSERT INTO work_item_logs (work_item_id, message) VALUES (:work_item_id, :message)",
          params: {
            work_item_id: { type: "number", required: true },
            message: { type: "string", required: true },
          },
          access: "authenticated",
        },
      },
    });
    const contract = loadBackendContract(pageDir, { root: "backend" });

    const results = await executeNamedSqlTransaction(contract, {
      dbPath: pageDir,
      context: { visitorId: "alice", ownerId: "owner", now: new Date("2026-01-02T03:04:05Z") },
      body: {
        mutations: [
          {
            name: "work_items.create",
            params: { title: "Created", status: "open", assignee_id: "alice" },
          },
          {
            name: "work_item_logs.create",
            params: {
              work_item_id: { $result: 0, field: "lastInsertRowId" },
              message: "created",
            },
          },
        ],
      },
    });

    expect(results[0]).toMatchObject({ changes: 1, lastInsertRowId: expect.any(Number) });
    const createdId = (results[0] as { lastInsertRowId: number }).lastInsertRowId;
    const rows = execRawSql(dbPath, "SELECT work_item_id, message FROM work_item_logs").rows;
    expect(rows).toEqual([{ work_item_id: createdId, message: "created" }]);
  });
});
