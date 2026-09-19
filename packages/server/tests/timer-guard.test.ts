import { afterEach, describe, expect, it, vi } from "vitest";
import { isSqlJsRuntimeUnusable, resetSqlJsRuntimeUsability, setSqlJsRuntimeStopHook } from "@localapp/server-core";

import { guardTimerCallback } from "../src/lib/timer-guard.js";

afterEach(() => {
  setSqlJsRuntimeStopHook(undefined);
  resetSqlJsRuntimeUsability();
  vi.restoreAllMocks();
});

describe("timer callback guard", () => {
  it("routes a WebAssembly trap to the terminal stop instead of crashing the process", () => {
    // Break caught: the 6h cleanup callback touched the database with no error
    // boundary, so the trap became an uncaught exception and killed the Server.
    const stops: string[] = [];
    setSqlJsRuntimeStopHook((reason) => stops.push(reason));
    const guarded = guardTimerCallback("desktop action cleanup", () => {
      throw new WebAssembly.RuntimeError("memory access out of bounds");
    });

    expect(() => guarded()).not.toThrow();
    expect(stops).toHaveLength(1);
    expect(isSqlJsRuntimeUnusable()).toBe(true);
  });

  it("reports an ordinary timer failure without ending the process", () => {
    const stops: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    setSqlJsRuntimeStopHook((reason) => stops.push(reason));

    guardTimerCallback("verification session cleanup", () => { throw new Error("cleanup exploded"); })();

    expect(stops).toEqual([]);
    expect(isSqlJsRuntimeUnusable()).toBe(false);
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("cleanup exploded"));
  });

  it("captures an asynchronous rejection from a timer callback", async () => {
    const stops: string[] = [];
    setSqlJsRuntimeStopHook((reason) => stops.push(reason));

    guardTimerCallback("idle database close", async () => {
      throw new WebAssembly.RuntimeError("memory access out of bounds");
    })();
    await new Promise((resolve) => setImmediate(resolve));

    expect(stops).toHaveLength(1);
  });
});
