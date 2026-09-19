import { afterEach, describe, expect, it } from "vitest";

import {
  assertSqlJsRuntimeUsable,
  isSqlJsRuntimeUnusable,
  markSqlJsRuntimeUnusable,
  resetSqlJsRuntimeUsability,
  setSqlJsRuntimeStopHook,
} from "../runtime-errors.js";

afterEach(() => {
  setSqlJsRuntimeStopHook(undefined);
  resetSqlJsRuntimeUsability();
});

describe("terminal SQLite runtime failures", () => {
  it("records a WebAssembly trap as terminal and stops the process once", () => {
    // Break caught: the runtime reported a trap, evicted the database and reopened
    // it, but `initSqlJs()` returns the same trapped module instance, so every
    // later database request trapped again — including the reopen itself.
    const stops: string[] = [];
    setSqlJsRuntimeStopHook((reason) => stops.push(reason));
    expect(isSqlJsRuntimeUnusable()).toBe(false);

    const trap = new WebAssembly.RuntimeError("memory access out of bounds");
    const first = markSqlJsRuntimeUnusable(trap, "meta database");
    expect(first.code).toBe("db_runtime_restart_required");
    expect(first.status).toBe(503);
    expect(first.details?.scope).toBe("meta database");
    expect(isSqlJsRuntimeUnusable()).toBe(true);

    // Repeated traps (every later request) must not restart the process again.
    const second = markSqlJsRuntimeUnusable(new WebAssembly.RuntimeError("memory access out of bounds"), "meta database");
    expect(second.code).toBe("db_runtime_restart_required");
    expect(stops).toHaveLength(1);
  });

  it("rejects later database access with the restart code instead of a doomed reopen", () => {
    setSqlJsRuntimeStopHook(() => undefined);
    markSqlJsRuntimeUnusable(new WebAssembly.RuntimeError("memory access out of bounds"), "application database");
    expect(() => assertSqlJsRuntimeUsable()).toThrowError(
      expect.objectContaining({ code: "db_runtime_restart_required", status: 503 }),
    );
  });

  it("leaves a healthy runtime usable", () => {
    expect(() => assertSqlJsRuntimeUsable()).not.toThrow();
  });
});
