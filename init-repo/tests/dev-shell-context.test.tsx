import { afterEach, describe, expect, it, vi } from "vitest";
import { requestDevContext } from "@localapp/app-kit/dev-shell";

describe("requestDevContext", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("aborts when a successful response body never settles", async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      capturedSignal = init?.signal;
      return {
        ok: true,
        status: 200,
        json: () => new Promise(() => undefined),
      } as Response;
    });

    const request = requestDevContext(1_000);
    const rejection = expect(request).rejects.toThrow("Dev context request timed out");
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("returns valid context data and clears its deadline", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: { user: null, timeMode: "real", now: null, pageName: "local-app", recentUsers: [] },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(requestDevContext(1_000)).resolves.toMatchObject({ pageName: "local-app", user: null });
    expect(vi.getTimerCount()).toBe(0);
  });
});
