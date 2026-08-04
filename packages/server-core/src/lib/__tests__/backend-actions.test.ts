import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createActionContext,
  discoverActionSources,
  executeHostedAction,
  loadActionManifest,
  validateActionEntry,
  validateActionManifest,
  type ActionManifest,
} from "../backend-actions.js";
import { loadBackendContract } from "../backend-contract.js";

const RESOURCE_SCHEMA_URL = "https://localapp.dev/schemas/backend/resource-schema.schema.json";
const QUERIES_SCHEMA_URL = "https://localapp.dev/schemas/backend/queries.schema.json";
const MUTATIONS_SCHEMA_URL = "https://localapp.dev/schemas/backend/mutations.schema.json";

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function writeWorkItemsBackend(projectDir: string): void {
  const resourceDir = path.join(projectDir, "backend", "resources", "work_items");
  writeJson(path.join(resourceDir, "schema.json"), {
    $schema: RESOURCE_SCHEMA_URL,
    name: "work_items",
    fields: {
      id: { type: "auto_increment" },
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
      },
    },
  });
  writeJson(path.join(resourceDir, "mutations.json"), {
    $schema: MUTATIONS_SCHEMA_URL,
    mutations: {
      "work_items.close": {
        kind: "mutation",
        sql: "UPDATE work_items SET status = 'done' WHERE id = :id",
        params: { id: { type: "number", required: true } },
      },
    },
  });
}

function manifest(overrides: Partial<ActionManifest> = {}): ActionManifest {
  return {
    version: 1,
    bundle: "backend/actions.bundle.mjs",
    actions: [
      {
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
      },
    ],
    ...overrides,
  };
}

describe("backend actions contract", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-actions-"));
    writeWorkItemsBackend(projectDir);
  });

  afterEach(() => {
    fs.rmSync(projectDir, { recursive: true, force: true });
  });

  it("discovers backend action source files under backend/actions", () => {
    fs.mkdirSync(path.join(projectDir, "backend", "actions"), { recursive: true });
    fs.writeFileSync(path.join(projectDir, "backend", "actions", "leave.ts"), "export default {};\n");

    expect(discoverActionSources(projectDir, { root: "backend" })).toEqual([
      "backend/actions/leave.ts",
    ]);
  });

  it("loads legacy action manifests but excludes them from stable backend contracts", () => {
    writeJson(path.join(projectDir, "backend", "actions.manifest.json"), manifest());

    const loaded = loadActionManifest(projectDir, { root: "backend" });

    expect(loaded?.actions[0]?.name).toBe("work_items.close");
    expect(() => loadBackendContract(projectDir, { root: "backend" })).toThrow(/hosted action|disabled|named SQL/i);
  });

  it("rejects duplicate action names", () => {
    const duplicate = manifest({
      actions: [
        manifest().actions[0],
        { ...manifest().actions[0], exportName: "closeAgain" },
      ],
    });

    expect(() => validateActionManifest(duplicate, loadBackendContract(projectDir, { root: "backend" }))).toThrow(/duplicate/i);
  });

  it("rejects invalid access levels and non-serializable input schemas", () => {
    expect(() => validateActionManifest(
      manifest({ actions: [{ ...manifest().actions[0], access: "superuser" as never }] }),
      loadBackendContract(projectDir, { root: "backend" }),
    )).toThrow(/access/i);

    expect(() => validateActionManifest(
      manifest({ actions: [{ ...manifest().actions[0], input: { type: "function" } }] }),
      loadBackendContract(projectDir, { root: "backend" }),
    )).toThrow(/input/i);
  });

  it("rejects action manifests that reference unknown named SQL", () => {
    const bad = manifest({
      actions: [{
        ...manifest().actions[0],
        uses: { queries: ["work_items.missing"], mutations: ["work_items.close"] },
      }],
    });

    expect(() => validateActionManifest(bad, loadBackendContract(projectDir, { root: "backend" }))).toThrow(/work_items\.missing/);
  });

  it("rejects action manifests that omit the SQL uses allowlist", () => {
    const bad = manifest({
      actions: [{
        ...manifest().actions[0],
        uses: undefined,
      }],
    });

    expect(() => validateActionManifest(bad, loadBackendContract(projectDir, { root: "backend" }))).toThrow(/uses/i);
  });

  it("rejects action query dependencies that do not declare bounded results", () => {
    writeJson(path.join(projectDir, "backend", "resources", "work_items", "queries.json"), {
      $schema: QUERIES_SCHEMA_URL,
      queries: {
        "work_items.unbounded": {
          kind: "query",
          sql: "SELECT id, title, status FROM work_items",
          params: {},
        },
      },
    });
    const bad = manifest({
      actions: [{
        ...manifest().actions[0],
        uses: { queries: ["work_items.unbounded"], mutations: ["work_items.close"] },
      }],
    });

    expect(() => validateActionManifest(bad, loadBackendContract(projectDir, { root: "backend" }))).toThrow(/bounded|result|pagination/i);
  });

  it("validates only the selected action entry at runtime", () => {
    writeJson(path.join(projectDir, "backend", "resources", "work_items", "queries.json"), {
      $schema: QUERIES_SCHEMA_URL,
      queries: {
        "work_items.get": {
          kind: "query",
          sql: "SELECT id, title, status FROM work_items WHERE id = :id",
          params: { id: { type: "number", required: true } },
          result: { mode: "single", maxRows: 1, maxBytes: 4096 },
        },
        "work_items.unbounded": {
          kind: "query",
          sql: "SELECT id, title, status FROM work_items",
          params: {},
        },
      },
    });
    const good = manifest().actions[0];
    const bad = {
      ...good,
      name: "work_items.badRead",
      exportName: "badRead",
      uses: { queries: ["work_items.unbounded"], mutations: [] },
    };
    const mixed = manifest({ actions: [good, bad] });
    const contract = loadBackendContract(projectDir, { root: "backend" });

    expect(() => validateActionManifest(mixed, contract)).toThrow(/work_items\.badRead/);
    expect(() => validateActionEntry(good, contract)).not.toThrow();
  });
});

describe("backend action runtime", () => {
  it("builds a trusted ctx and executes handlers through platform capabilities", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 1, status: "open" }] });
    const mutate = vi.fn().mockResolvedValue({ changes: 1 });
    const notifySend = vi.fn().mockResolvedValue({ delivered: 1 });
    const logInfo = vi.fn();
    const transaction = vi.fn(async (fn) => fn());

    const ctx = createActionContext({
      user: { id: "alice", name: "Alice", role: "user" },
      ownerId: "owner",
      now: new Date("2026-01-02T03:04:05.000Z"),
      query,
      mutate,
      transaction,
      notify: { send: notifySend },
      log: { info: logInfo, error: vi.fn() },
    });

    const result = await ctx.transaction(async () => {
      const row = await ctx.query("work_items.get", { id: 1 });
      await ctx.mutate("work_items.close", { id: 1 });
      await ctx.notify.send("alice", { title: "closed" });
      ctx.log.info("closed", { id: 1 });
      return row;
    });

    expect(ctx.user).toMatchObject({ id: "alice" });
    expect(ctx.ownerId).toBe("owner");
    expect(ctx.now.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(result).toEqual({ rows: [{ id: 1, status: "open" }] });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith("work_items.get", { id: 1 });
    expect(mutate).toHaveBeenCalledWith("work_items.close", { id: 1 });
    expect(notifySend).toHaveBeenCalledWith("alice", { title: "closed" });
    expect(logInfo).toHaveBeenCalledWith("closed", { id: 1 });
  });

  it("rejects ctx query and mutation calls that are not declared in the action allowlist", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const mutate = vi.fn().mockResolvedValue({ changes: 1 });
    const ctx = createActionContext({
      user: { id: "alice", name: "Alice", role: "user" },
      ownerId: "owner",
      now: new Date("2026-01-02T03:04:05.000Z"),
      query,
      mutate,
      transaction: vi.fn(async (fn) => fn()),
      runtime: {
        allowedQueries: new Set(["work_items.get"]) as never,
        allowedMutations: new Set(["work_items.close"]) as never,
      } as never,
    });

    await expect(ctx.query("work_items.list", {})).rejects.toMatchObject({ code: "action_contract_violation" });
    await expect(ctx.mutate("work_items.delete", {})).rejects.toMatchObject({ code: "action_contract_violation" });
    expect(query).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it("loads a bundled action export, validates input, and executes handler", async () => {
    const bundlePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localapp-action-bundle-")), "actions.mjs");
    fs.writeFileSync(bundlePath, [
      "export const closeWorkItem = {",
      "  async handler(ctx, input) {",
      "    await ctx.mutate('work_items.close', { id: input.id });",
      "    return { ok: true, userId: ctx.user.id };",
      "  }",
      "};",
    ].join("\n"));

    const result = await executeHostedAction({
      bundlePath,
      action: manifest().actions[0],
      input: { id: 7 },
      ctx: createActionContext({
        user: { id: "alice", name: "Alice", role: "user" },
        ownerId: "owner",
        now: new Date("2026-01-02T03:04:05.000Z"),
        query: vi.fn(),
        mutate: vi.fn().mockResolvedValue({ changes: 1 }),
        transaction: vi.fn(async (fn) => fn()),
        notify: { send: vi.fn() },
        log: { info: vi.fn(), error: vi.fn() },
      }),
    });

    expect(result).toEqual({ ok: true, userId: "alice" });
  });

  it("rejects action bundles that use capabilities outside ctx", async () => {
    const bundlePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localapp-action-bundle-")), "actions.mjs");
    fs.writeFileSync(bundlePath, "import fs from 'node:fs'; export const closeWorkItem = { handler() { return fs.existsSync('.'); } };\n");

    await expect(executeHostedAction({
      bundlePath,
      action: manifest().actions[0],
      input: { id: 7 },
      ctx: createActionContext({
        user: { id: "alice" },
        ownerId: "owner",
        now: new Date(),
        query: vi.fn(),
        mutate: vi.fn(),
        transaction: vi.fn(async (fn) => fn()),
      }),
    })).rejects.toThrow(/ctx boundary/);
  });

  it("rejects node builtin imports inside the worker runtime", async () => {
    const bundlePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localapp-action-bundle-")), "actions.mjs");
    fs.writeFileSync(bundlePath, [
      "import { readFile } from 'node:fs/promises';",
      "import { createRequire } from 'node:module';",
      "export const closeWorkItem = { async handler() {",
      "  const require = createRequire(import.meta.url);",
      "  return { fs: await readFile('/etc/passwd', 'utf8'), require: typeof require };",
      "} };",
    ].join("\n"));

    await expect(executeHostedAction({
      bundlePath,
      action: manifest().actions[0],
      input: { id: 7 },
      ctx: createActionContext({
        user: { id: "alice" },
        ownerId: "owner",
        now: new Date(),
        query: vi.fn(),
        mutate: vi.fn(),
        transaction: vi.fn(async (fn) => fn()),
      }),
    })).rejects.toThrow(/imports are not allowed|ctx boundary/);
  });

  it("rejects dynamic imports inside the worker runtime", async () => {
    const bundlePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localapp-action-bundle-")), "actions.mjs");
    fs.writeFileSync(bundlePath, [
      "export const closeWorkItem = { async handler() {",
      "  const name = 'node:' + 'fs/promises';",
      "  return import(name);",
      "} };",
    ].join("\n"));

    await expect(executeHostedAction({
      bundlePath,
      action: manifest().actions[0],
      input: { id: 7 },
      ctx: createActionContext({
        user: { id: "alice" },
        ownerId: "owner",
        now: new Date(),
        query: vi.fn(),
        mutate: vi.fn(),
        transaction: vi.fn(async (fn) => fn()),
      }),
    })).rejects.toThrow(/imports are not allowed/);
  });

  it("fails action handlers that exceed the platform timeout", async () => {
    const bundlePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localapp-action-bundle-")), "actions.mjs");
    fs.writeFileSync(bundlePath, "export const closeWorkItem = { handler() { return new Promise(() => {}); } };\n");

    await expect(executeHostedAction({
      bundlePath,
      action: manifest().actions[0],
      input: { id: 7 },
      timeoutMs: 5,
      ctx: createActionContext({
        user: { id: "alice" },
        ownerId: "owner",
        now: new Date(),
        query: vi.fn(),
        mutate: vi.fn(),
        transaction: vi.fn(async (fn) => fn()),
      }),
    })).rejects.toMatchObject({ status: 504 });
  });

  it("terminates synchronous runaway action handlers on timeout", async () => {
    const bundlePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "localapp-action-bundle-")), "actions.mjs");
    fs.writeFileSync(bundlePath, "export const closeWorkItem = { handler() { while (true) {} } };\n");

    await expect(executeHostedAction({
      bundlePath,
      action: manifest().actions[0],
      input: { id: 7 },
      timeoutMs: 20,
      ctx: createActionContext({
        user: { id: "alice" },
        ownerId: "owner",
        now: new Date(),
        query: vi.fn(),
        mutate: vi.fn(),
        transaction: vi.fn(async (fn) => fn()),
      }),
    })).rejects.toMatchObject({ status: 504 });
  });
});
