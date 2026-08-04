import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import {
  DesktopActionError,
  type DesktopActionRunOptions,
  type DesktopActionSnapshot,
} from "@localapp/sdk";

const desktopRunMock = vi.fn();

vi.mock("@localapp/sdk", async (importOriginal) => ({
  ...await importOriginal<typeof import("@localapp/sdk")>(),
  desktop: {
    run: (...args: unknown[]) => desktopRunMock(...args),
    get: vi.fn(),
  },
}));

import { useDesktopAction } from "../src/index.js";

const action = { title: "Export", script: "return 42" };

describe("useDesktopAction", () => {
  beforeEach(() => {
    desktopRunMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes request progress and the terminal result", async () => {
    let resolveRun!: (snapshot: DesktopActionSnapshot<number>) => void;
    desktopRunMock.mockImplementation((_request, options: DesktopActionRunOptions<number>) => {
      options.onRequestId?.("request-1");
      options.onStatus?.({ requestId: "request-1", status: "running", result: null, error: null });
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    });
    const { result } = renderHook(() => useDesktopAction<number>());

    let promise!: Promise<DesktopActionSnapshot<number>>;
    act(() => {
      promise = result.current.run(action);
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.requestId).toBe("request-1");
    expect(result.current.status).toBe("running");
    expect(result.current.result).toBeNull();

    const terminal: DesktopActionSnapshot<number> = {
      requestId: "request-1",
      status: "succeeded",
      result: 42,
      error: null,
    };
    await act(async () => {
      resolveRun(terminal);
      await promise;
    });

    expect(await promise).toEqual(terminal);
    expect(result.current.loading).toBe(false);
    expect(result.current.status).toBe("succeeded");
    expect(result.current.result).toBe(42);
    expect(result.current.error).toBeNull();
  });

  it("exposes a structured terminal action error without rejecting run", async () => {
    const terminal: DesktopActionSnapshot = {
      requestId: "request-2",
      status: "failed",
      result: null,
      error: { code: "dependency_prepare_failed", message: "Install failed" },
    };
    desktopRunMock.mockResolvedValue(terminal);
    const { result } = renderHook(() => useDesktopAction());

    await act(async () => {
      await expect(result.current.run(action)).resolves.toEqual(terminal);
    });

    expect(result.current.status).toBe("failed");
    expect(result.current.error).toEqual(terminal.error);
    expect(result.current.loading).toBe(false);
  });

  it("stores and rethrows observation errors", async () => {
    const error = new DesktopActionError("offline", "Desktop is offline");
    desktopRunMock.mockRejectedValue(error);
    const { result } = renderHook(() => useDesktopAction());

    await act(async () => {
      await expect(result.current.run(action)).rejects.toBe(error);
    });

    expect(result.current.error).toBe(error);
    expect(result.current.loading).toBe(false);
  });

  it("does not apply completion updates after unmount", async () => {
    let resolveRun!: (snapshot: DesktopActionSnapshot<number>) => void;
    desktopRunMock.mockReturnValue(new Promise((resolve) => {
      resolveRun = resolve;
    }));
    const { result, unmount } = renderHook(() => useDesktopAction<number>());

    let promise!: Promise<DesktopActionSnapshot<number>>;
    act(() => {
      promise = result.current.run(action);
    });
    expect(result.current.loading).toBe(true);
    unmount();

    await act(async () => {
      resolveRun({ requestId: "request-3", status: "succeeded", result: 9, error: null });
      await promise;
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.result).toBeNull();
  });

  it("forwards observation options while retaining hook callbacks", async () => {
    desktopRunMock.mockResolvedValue({ requestId: "request-4", status: "succeeded", result: true, error: null });
    const externalStatus = vi.fn();
    const controller = new AbortController();
    const { result } = renderHook(() => useDesktopAction<boolean>());

    await act(async () => {
      await result.current.run(action, { signal: controller.signal, observationTimeoutMs: 123, onStatus: externalStatus });
    });

    expect(desktopRunMock).toHaveBeenCalledWith(action, expect.objectContaining({
      signal: controller.signal,
      observationTimeoutMs: 123,
      onStatus: expect.any(Function),
      onRequestId: expect.any(Function),
    }));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});
