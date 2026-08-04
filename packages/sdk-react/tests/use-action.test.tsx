import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { LocalAppError } from "@localapp/sdk";

const actionMock = vi.fn();

vi.mock("../src/client.js", () => ({
  getClient: () => ({
    action: (...args: unknown[]) => actionMock(...args),
  }),
}));

import { useAction } from "../src/index.js";

describe("useAction", () => {
  beforeEach(() => {
    actionMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs a backend action and exposes loading state", async () => {
    let resolveAction!: (value: { ok: boolean }) => void;
    actionMock.mockReturnValue(new Promise((resolve) => {
      resolveAction = resolve;
    }));

    const { result } = renderHook(() => useAction<{ id: number }, { ok: boolean }>("work_items.close"));

    let promise!: Promise<{ ok: boolean }>;
    act(() => {
      promise = result.current.run({ id: 7 });
    });

    expect(result.current.loading).toBe(true);
    expect(actionMock).toHaveBeenCalledWith("work_items.close", { id: 7 });

    await act(async () => {
      resolveAction({ ok: true });
      await promise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(await promise).toEqual({ ok: true });
    expect(result.current.error).toBeNull();
  });

  it("stores LocalAppError when action fails", async () => {
    const error = new LocalAppError("Access denied", 403);
    actionMock.mockRejectedValue(error);

    const { result } = renderHook(() => useAction("work_items.close"));

    await act(async () => {
      await expect(result.current.run({ id: 7 })).rejects.toBe(error);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(error);
    expect(result.current.error?.status).toBe(403);
  });
});
