import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LocalAppError, type PlatformCapabilities } from "@localapp/sdk";

const capabilitiesMock = vi.fn();

vi.mock("../src/client.js", () => ({
  getClient: () => ({ capabilities: capabilitiesMock }),
}));

import { useCapabilities } from "../src/index.js";

const capabilities = {
  schemaVersion: 1,
  platformVersion: "1.0.0",
} as PlatformCapabilities;

describe("useCapabilities", () => {
  beforeEach(() => {
    capabilitiesMock.mockReset();
  });

  it("loads the platform capability contract", async () => {
    capabilitiesMock.mockResolvedValue(capabilities);

    const { result } = renderHook(() => useCapabilities());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.capabilities).toEqual(capabilities);
    expect(result.current.error).toBeNull();
  });

  it("exposes a retryable error state", async () => {
    capabilitiesMock.mockRejectedValueOnce(new LocalAppError("Unavailable", 503));
    const { result } = renderHook(() => useCapabilities());
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatchObject({ message: "Unavailable", status: 503 });
    capabilitiesMock.mockResolvedValueOnce(capabilities);
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.capabilities).toEqual(capabilities);
    expect(result.current.error).toBeNull();
  });
});
