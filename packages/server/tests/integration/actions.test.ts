import { beforeAll, afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createTestPage, createTestServer, getAppUrl, getTestApiKey } from "./helpers.js";
import { BOOTSTRAP_USER_ID } from "../../src/lib/meta-sqlite.js";
import type { FastifyInstance } from "fastify";

const RESOURCE_SCHEMA_URL = "https://localapp.dev/schemas/backend/resource-schema.schema.json";
const QUERIES_SCHEMA_URL = "https://localapp.dev/schemas/backend/queries.schema.json";
const MUTATIONS_SCHEMA_URL = "https://localapp.dev/schemas/backend/mutations.schema.json";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeBackend(pageDir: string): void {
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
      "work_items.get": {
        kind: "query",
        sql: "SELECT id, title, status FROM work_items WHERE id = :id",
        params: { id: { type: "number", required: true } },
        result: { mode: "single", maxRows: 1, maxBytes: 4096 },
        access: "authenticated",
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
      "work_items.close": {
        kind: "mutation",
        sql: "UPDATE work_items SET status = 'done' WHERE id = :id",
        params: { id: { type: "number", required: true } },
        access: "authenticated",
      },
    },
  });
  writeJson(path.join(pageDir, "backend", "actions.manifest.json"), {
    version: 1,
    bundle: "backend/actions.bundle.mjs",
    actions: [{
      name: "work_items.close",
      exportName: "closeWorkItem",
      access: "authenticated",
      input: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "number" } },
      },
      uses: {
        queries: ["work_items.get"],
        mutations: ["work_items.close"],
      },
    }, {
      name: "work_items.ownerOnly",
      exportName: "ownerOnly",
      access: "owner",
      input: { type: "object", properties: {} },
      uses: { queries: [], mutations: [] },
    }, {
      name: "work_items.transactionFail",
      exportName: "transactionFail",
      access: "authenticated",
      input: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "number" } },
      },
      uses: { mutations: ["work_items.close"], queries: ["work_items.get"] },
    }, {
      name: "work_items.largeResult",
      exportName: "largeResult",
      access: "authenticated",
      input: { type: "object", properties: {} },
      uses: { queries: [], mutations: [] },
    }],
  });
  fs.writeFileSync(path.join(pageDir, "backend", "actions.bundle.mjs"), [
    "export const closeWorkItem = {",
    "  async handler(ctx, input) {",
    "    await ctx.mutate('work_items.close', { id: input.id });",
    "    const row = await ctx.query('work_items.get', { id: input.id });",
    "    return { ok: true, userId: ctx.user.id, row };",
    "  }",
    "};",
    "export const ownerOnly = { async handler() { return { ok: true }; } };",
    "export const transactionFail = {",
    "  async handler(ctx, input) {",
    "    await ctx.transaction(async () => {",
    "      await ctx.mutate('work_items.close', { id: input.id });",
    "      throw new Error('forced rollback');",
    "    });",
    "  }",
    "};",
    "export const largeResult = {",
    "  handler() {",
    "    return { payload: 'x'.repeat(2 * 1024 * 1024) };",
    "  }",
    "};",
  ].join("\n"));
}

describe("hosted backend actions", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let stop: () => Promise<void>;
  const pageOwner = BOOTSTRAP_USER_ID;
  const pageName = "actions-app";

  beforeAll(async () => {
    const server = await createTestServer();
    app = server.app;
    baseUrl = getAppUrl(app);
    dataDir = server.dataDir;
    stop = server.stop;

    await createTestPage(app, pageOwner, pageName);
    await fetch(`${baseUrl}/api/schemas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": getTestApiKey() },
      body: JSON.stringify({
        pageName,
        name: "work_items",
        fields: {
          title: { type: "string" },
          status: { type: "string" },
        },
      }),
    });
    writeBackend(path.join(dataDir, pageOwner, pageName, "versions", "v1"));
    await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/mutations/work_items.seed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { title: "First", status: "open" } }),
    });
  });

  afterAll(async () => {
    await stop();
  });

  it("rejects legacy action calls without executing uploaded bundles", async () => {
    const response = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/actions/work_items.close`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": getTestApiKey() },
      body: JSON.stringify({ input: { id: 1 } }),
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "hosted_actions_disabled",
    });

    const query = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/queries/work_items.get`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": getTestApiKey() },
      body: JSON.stringify({ params: { id: 1 } }),
    });
    expect(query.status).toBe(200);
    expect(await query.json()).toMatchObject({
      success: true,
      data: { rows: [{ id: 1, title: "First", status: "open" }] },
    });
  });

  it("returns the same disabled code for missing or malformed action requests", async () => {
    const response = await fetch(`${baseUrl}/serve/${pageOwner}/${pageName}/api/actions/work_items.largeResult`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": getTestApiKey() },
      body: JSON.stringify({ input: { invalid: true } }),
    });

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      success: false,
      code: "hosted_actions_disabled",
    });
  });
});
