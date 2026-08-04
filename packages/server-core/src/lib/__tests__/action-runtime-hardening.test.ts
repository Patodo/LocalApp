import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ActionError,
  createActionContext,
  executeHostedAction,
  type ActionManifestEntry,
} from "../backend-actions.js";
import { configureDbQueueForTests, withDbQueue } from "../app-db.js";
import { LocalAppRuntimeError, isWasmRuntimeError, wrapDatabaseRuntimeError } from "../runtime-errors.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeBundle(source: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-action-hardening-"));
  const bundlePath = path.join(dir, "actions.bundle.mjs");
  fs.writeFileSync(bundlePath, source);
  return bundlePath;
}

function testAction(name = "workload.listWorkRows"): ActionManifestEntry {
  return {
    name,
    exportName: "handler",
    access: "authenticated",
    input: {
      type: "object",
      properties: {},
    },
    uses: {
      queries: ["workload.rows"],
      mutations: ["workload.update"],
    },
  };
}

function testCtx(overrides: Partial<Parameters<typeof createActionContext>[0]> = {}) {
  return createActionContext({
    user: { id: "test-owner", name: "test-owner", role: "user" },
    ownerId: "test-owner",
    now: new Date("2026-06-23T03:00:00.000Z"),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    mutate: vi.fn().mockResolvedValue({ changes: 0 }),
    transaction: vi.fn(async (fn) => fn()),
    notify: { send: vi.fn().mockResolvedValue({ delivered: 0 }) },
    log: { info: vi.fn(), error: vi.fn() },
    ...overrides,
  });
}

afterEach(() => {
  configureDbQueueForTests({ reset: true });
});

describe("hosted action runtime hardening", () => {
  it("serializes Promise.all ctx.query calls that target the same app database", async () => {
    const dbPath = path.join(os.tmpdir(), `localapp-hardening-${Date.now()}.db`);
    const bundlePath = writeBundle(`
      export const handler = {
        async handler(ctx) {
          return Promise.all([
            ctx.query("workload.rows", { part: "a" }),
            ctx.query("workload.rows", { part: "b" }),
            ctx.query("workload.rows", { part: "c" })
          ]);
        }
      };
    `);
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;

    const ctx = testCtx({
      query: vi.fn(async (_name, params) => withDbQueue(dbPath, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        order.push(`start:${params?.part}`);
        await delay(15);
        order.push(`end:${params?.part}`);
        active -= 1;
        return { rows: [{ part: params?.part }] };
      })),
    });

    const result = await executeHostedAction({
      bundlePath,
      action: testAction(),
      input: {},
      ctx,
      appKey: "test-owner/team-workload",
    });

    expect(result).toEqual([
      { rows: [{ part: "a" }] },
      { rows: [{ part: "b" }] },
      { rows: [{ part: "c" }] },
    ]);
    expect(maxActive).toBe(1);
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b", "start:c", "end:c"]);
  });

  it("serializes page named SQL and hosted action SQL against the same app database", async () => {
    const dbPath = path.join(os.tmpdir(), `localapp-hardening-page-${Date.now()}.db`);
    const bundlePath = writeBundle(`
      export const handler = {
        async handler(ctx) {
          return ctx.query("workload.rows", { source: "action" });
        }
      };
    `);
    const order: string[] = [];
    const pageQuery = withDbQueue(dbPath, async () => {
      order.push("page:start");
      await delay(35);
      order.push("page:end");
      return { rows: [] };
    });
    await delay(5);

    const actionQuery = executeHostedAction({
      bundlePath,
      action: testAction(),
      input: {},
      ctx: testCtx({
        query: vi.fn(async () => withDbQueue(dbPath, async () => {
          order.push("action:start");
          await delay(5);
          order.push("action:end");
          return { rows: [{ source: "action" }] };
        })),
      }),
      appKey: "test-owner/team-workload",
    });

    await expect(Promise.all([pageQuery, actionQuery])).resolves.toBeTruthy();
    expect(order).toEqual(["page:start", "page:end", "action:start", "action:end"]);
  });

  it("wraps structured clone failures as stable action resource errors", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        handler() {
          return { rows: [], helper() { return true; } };
        }
      };
    `);

    let error: unknown;
    try {
      await executeHostedAction({
        bundlePath,
        action: testAction(),
        input: {},
        ctx: testCtx(),
        appKey: "test-owner/team-workload",
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 500, code: "action_resource_limit" });
    expect(error instanceof Error ? error.message : String(error)).toMatch(/Action worker failed to serialize result/i);
    expect(error instanceof Error ? error.message : String(error)).not.toMatch(/could not be cloned|DataCloneError/i);
  });

  it("wraps sql.js wasm memory errors without leaking database paths", () => {
    const wrapped = wrapDatabaseRuntimeError(
      new WebAssembly.RuntimeError("memory access out of bounds"),
      {
        operation: "query",
        sqlName: "workload.rows",
        dbPath: "/srv/localapp/data/apps/test-owner/team-workload/app.db",
      },
    );

    expect(wrapped).toBeInstanceOf(LocalAppRuntimeError);
    expect(wrapped).toMatchObject({ status: 500, code: "db_runtime_error" });
    expect(wrapped.message).toMatch(/Database runtime error/i);
    expect(wrapped.message).not.toContain("/srv/localapp");
    expect(wrapped.message).not.toMatch(/memory access out of bounds/i);
    expect(wrapped.details).toMatchObject({
      operation: "query",
      sqlName: "workload.rows",
      originalMessage: "memory access out of bounds",
    });
  });

  it("recognizes sql-wasm empty-message runtime errors as wasm failures", () => {
    const err = new Error("");
    err.stack = "Error\n    at e.handleError (/node_modules/sql.js/dist/sql-wasm.js:90:192)";

    expect(isWasmRuntimeError(err)).toBe(true);
  });

  it("applies per-app action concurrency backpressure before creating unlimited workers", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler() {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return { ok: true };
        }
      };
    `);
    const action = testAction("workload.slow");
    const appKey = `test-owner/team-workload-${Date.now()}`;

    const first = executeHostedAction({
      bundlePath,
      action,
      input: {},
      ctx: testCtx(),
      appKey,
      actionConcurrency: { max: 1, queueTimeoutMs: 5 },
    });
    await delay(5);

    let error: unknown;
    try {
      await executeHostedAction({
        bundlePath,
        action,
        input: {},
        ctx: testCtx(),
        appKey,
        actionConcurrency: { max: 1, queueTimeoutMs: 5 },
      });
    } catch (err) {
      error = err;
    }

    await expect(first).resolves.toEqual({ ok: true });
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 429, code: "action_queue_timeout" });
  });

  it("applies a global action worker limit across different apps", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler() {
          await new Promise((resolve) => setTimeout(resolve, 60));
          return { ok: true };
        }
      };
    `);
    const action = testAction("workload.globalSlow");
    const events: unknown[] = [];

    const first = executeHostedAction({
      bundlePath,
      action,
      input: {},
      ctx: testCtx(),
      appKey: `test-owner/team-a-${Date.now()}`,
      actionConcurrency: { globalMax: 1, queueTimeoutMs: 5 },
    });
    await delay(5);

    let error: unknown;
    try {
      await executeHostedAction({
        bundlePath,
        action,
        input: {},
        ctx: testCtx(),
        appKey: `test-owner/team-b-${Date.now()}`,
        actionConcurrency: { globalMax: 1, queueTimeoutMs: 5 },
        onDiagnostic: (event) => events.push(event),
      });
    } catch (err) {
      error = err;
    }

    await expect(first).resolves.toEqual({ ok: true });
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 429, code: "action_queue_timeout" });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "action:schedule_reject",
        errorCode: "action_queue_timeout",
      }),
    ]));
  });

  it("emits action diagnostics with rpc and sql result summaries", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler(ctx) {
          const result = await ctx.query("workload.rows", { part: "summary" });
          ctx.log.info("loaded");
          return result;
        }
      };
    `);
    const events: unknown[] = [];

    await executeHostedAction({
      bundlePath,
      action: testAction(),
      input: {},
      ctx: testCtx({
        query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] }),
      }),
      appKey: "test-owner/team-workload",
      onDiagnostic: (event) => events.push(event),
    });

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "action:start", actionName: "workload.listWorkRows" }),
      expect.objectContaining({
        type: "action:rpc",
        method: "query",
        rows: 2,
        bytes: expect.any(Number),
        queueWaitMs: expect.any(Number),
      }),
      expect.objectContaining({
        type: "action:finish",
        ok: true,
        rpcCount: 2,
        sqlCount: 1,
        sqlRows: 2,
        sqlBytes: expect.any(Number),
        actionQueueWaitMs: expect.any(Number),
        dbQueueWaitMs: expect.any(Number),
      }),
    ]));
  });

  it("records action queue wait on successful queued execution", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler() {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { ok: true };
        }
      };
    `);
    const action = testAction("workload.queued");
    const appKey = `test-owner/team-queued-${Date.now()}`;
    const events: unknown[] = [];

    const first = executeHostedAction({
      bundlePath,
      action,
      input: {},
      ctx: testCtx(),
      appKey,
      actionConcurrency: { max: 1, globalMax: 1, queueTimeoutMs: 500 },
    });
    await delay(5);
    const second = executeHostedAction({
      bundlePath,
      action,
      input: {},
      ctx: testCtx(),
      appKey,
      actionConcurrency: { max: 1, globalMax: 1, queueTimeoutMs: 500 },
      onDiagnostic: (event) => events.push(event),
    });

    await expect(Promise.all([first, second])).resolves.toEqual([{ ok: true }, { ok: true }]);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "action:finish",
        ok: true,
        actionQueueWaitMs: expect.any(Number),
      }),
    ]));
    const finish = events.find((event) => Boolean(event) && typeof event === "object" && (event as { type?: string }).type === "action:finish") as { actionQueueWaitMs?: number } | undefined;
    expect(finish?.actionQueueWaitMs ?? 0).toBeGreaterThan(0);
  });

  it("rejects actions that exceed the RPC count budget", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler(ctx) {
          await ctx.query("workload.rows", { part: "a" });
          await ctx.query("workload.rows", { part: "b" });
          return { ok: true };
        }
      };
    `);
    const query = vi.fn().mockResolvedValue({ rows: [] });

    let error: unknown;
    try {
      await executeHostedAction({
        bundlePath,
        action: testAction(),
        input: {},
        ctx: testCtx({ query }),
        appKey: "test-owner/team-workload",
        runtimeBudget: { maxRpcCount: 1 },
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 413, code: "action_rpc_limit_exceeded" });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rejects action SQL results that exceed rows and bytes budgets", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler(ctx) {
          return ctx.query("workload.rows", { part: "heavy" });
        }
      };
    `);

    await expect(executeHostedAction({
      bundlePath,
      action: testAction(),
      input: {},
      ctx: testCtx({
        query: vi.fn().mockResolvedValue({ rows: [{ id: 1 }, { id: 2 }] }),
      }),
      appKey: "test-owner/team-workload",
      runtimeBudget: { maxSqlRowsPerCall: 1 },
    })).rejects.toMatchObject({ status: 413, code: "action_sql_result_too_large" });

    await expect(executeHostedAction({
      bundlePath,
      action: testAction(),
      input: {},
      ctx: testCtx({
        query: vi.fn().mockResolvedValue({ rows: [{ text: "0123456789" }] }),
      }),
      appKey: "test-owner/team-workload",
      runtimeBudget: { maxSqlBytesPerCall: 10 },
    })).rejects.toMatchObject({ status: 413, code: "action_sql_result_too_large" });
  });

  it("propagates named SQL result budget errors through action ctx.query", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler(ctx) {
          return ctx.query("workload.rows", { part: "heavy" });
        }
      };
    `);

    await expect(executeHostedAction({
      bundlePath,
      action: testAction(),
      input: {},
      ctx: testCtx({
        query: vi.fn().mockRejectedValue(new LocalAppRuntimeError("Named SQL result exceeded platform budget", {
          status: 413,
          code: "named_sql_result_too_large",
          details: { sqlName: "workload.rows", rows: 1001 },
        })),
      }),
      appKey: "test-owner/team-workload",
    })).rejects.toMatchObject({ status: 413, code: "named_sql_result_too_large" });
  });

  it("rejects action results that exceed the response byte budget", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        handler() {
          return { payload: "0123456789" };
        }
      };
    `);

    await expect(executeHostedAction({
      bundlePath,
      action: testAction(),
      input: {},
      ctx: testCtx(),
      appKey: "test-owner/team-workload",
      runtimeBudget: { maxResultBytes: 10 },
    })).rejects.toMatchObject({ status: 413, code: "action_result_too_large" });
  });

  it("classifies ordinary handler failures as action runtime errors", async () => {
    const bundlePath = writeBundle(`
      export const handler = {
        async handler() {
          throw new Error("business rule failed");
        }
      };
    `);
    const events: unknown[] = [];

    let error: unknown;
    try {
      await executeHostedAction({
        bundlePath,
        action: testAction(),
        input: {},
        ctx: testCtx(),
        appKey: "test-owner/team-workload",
        onDiagnostic: (event) => events.push(event),
      });
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({ status: 400, code: "action_runtime_error" });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "action:finish",
        ok: false,
        errorCode: "action_runtime_error",
      }),
    ]));
  });
});
