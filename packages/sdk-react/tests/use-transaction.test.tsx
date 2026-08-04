import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { LocalAppError } from "@localapp/sdk";

const transactionMock = vi.fn();

vi.mock("../src/client.js", () => ({
  getClient: () => ({
    transaction: (...args: unknown[]) => transactionMock(...args),
  }),
}));

import { useTransaction } from "../src/index.js";

describe("useTransaction", () => {
  beforeEach(() => {
    transactionMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs a named mutation transaction and exposes loading state", async () => {
    let resolveTransaction!: (value: Array<{ changes: number }>) => void;
    transactionMock.mockReturnValue(new Promise((resolve) => {
      resolveTransaction = resolve;
    }));

    const { result } = renderHook(() => useTransaction<Array<{ changes: number }>>());
    const steps = [{ name: "$work_items.create", params: { title: "A" } }];

    let promise!: Promise<Array<{ changes: number }>>;
    act(() => {
      promise = result.current.transaction(steps);
    });

    expect(result.current.loading).toBe(true);
    expect(transactionMock).toHaveBeenCalledWith(steps);

    await act(async () => {
      resolveTransaction([{ changes: 1 }]);
      await promise;
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(await promise).toEqual([{ changes: 1 }]);
    expect(result.current.error).toBeNull();
  });

  it("stores LocalAppError when transaction fails", async () => {
    const error = new LocalAppError("Access denied", 403);
    transactionMock.mockRejectedValue(error);

    const { result } = renderHook(() => useTransaction());

    await act(async () => {
      await expect(result.current.transaction([{ name: "$work_items.create" }])).rejects.toBe(error);
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(error);
    expect(result.current.error?.status).toBe(403);
  });
});
