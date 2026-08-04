import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeAllConnections,
  createAppNamedSqlRuntime,
  getConnection,
  LocalAppRuntimeError,
  type BackendContract,
} from "../../index.js";

const roots: string[] = [];

afterEach(() => {
  closeAllConnections();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("shared app named SQL runtime", () => {
  it("executes query, mutation and transaction routes against an explicit database", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-app-runtime-"));
    roots.push(root);
    const dbPath = path.join(root, "app.db");
    const db = await getConnection(dbPath);
    db.run("CREATE TABLE items(id TEXT PRIMARY KEY, title TEXT NOT NULL)");
    const runtime = createAppNamedSqlRuntime({
      contract: createContract(),
      dbPath,
      context: () => ({
        visitorId: "local-user",
        ownerId: "local-user",
        now: new Date("2026-07-30T00:00:00.000Z"),
      }),
    });

    await runtime.execute(
      { kind: "named-mutation", name: "items.create" },
      { params: { id: "one", title: "First" } },
    );
    await runtime.execute(
      { kind: "named-mutation-transaction" },
      {
        mutations: [
          {
            name: "items.create",
            body: { params: { id: "two", title: "Second" } },
          },
        ],
      },
    );
    await expect(
      runtime.execute({ kind: "named-query", name: "items.list" }, { params: {} }),
    ).resolves.toMatchObject({
      rows: [
        { id: "one", title: "First" },
        { id: "two", title: "Second" },
      ],
    });
  });

  it("classifies shared runtime errors without exposing host-specific replies", () => {
    const runtime = createAppNamedSqlRuntime({
      contract: createContract(),
      dbPath: "/tmp/not-used.db",
      context: () => ({
        visitorId: null,
        ownerId: "owner",
        now: new Date(),
      }),
    });

    expect(
      runtime.classifyError(
        new LocalAppRuntimeError("Too large", {
          code: "named_sql_result_too_large",
          status: 413,
        }),
      ),
    ).toEqual({
      status: 413,
      body: {
        success: false,
        error: "Too large",
        code: "named_sql_result_too_large",
      },
    });
    expect(runtime.classifyError(new Error("Access denied for owner route"))).toEqual({
      status: 401,
      body: { success: false, error: "Authentication required" },
    });
  });
});

function createContract(): BackendContract {
  return {
    files: [],
    resources: {},
    queries: {
      "items.list": {
        kind: "query",
        sql: "SELECT id, title FROM items ORDER BY id",
        access: "authenticated",
        params: {},
        result: { mode: "bounded", maxRows: 100, maxBytes: 65_536 },
      },
    },
    mutations: {
      "items.create": {
        kind: "mutation",
        sql: "INSERT INTO items(id, title) VALUES (:id, :title)",
        access: "authenticated",
        params: {
          id: { type: "string", required: true },
          title: { type: "string", required: true },
        },
      },
    },
  };
}
