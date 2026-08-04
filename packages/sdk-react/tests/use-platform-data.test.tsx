import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { usePlatformData, type PlatformGroup, type PlatformRole, type PlatformUser } from "../src/index.js";

describe("usePlatformData", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the platform resource with GET", async () => {
    const users: PlatformUser[] = [
      { id: "u-1", name: "alice", displayName: "Alice", avatarUrl: null, role: "user" },
    ];
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true, data: users }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const { result } = renderHook(() => usePlatformData<PlatformUser>("users"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(fetch).toHaveBeenCalledWith("/api/platform/users", { method: "GET" });
    expect(result.current.data).toEqual(users);
    expect(result.current.error).toBeNull();
    expect(result.current.refresh).toEqual(expect.any(Function));
    expect("create" in result.current).toBe(false);
    expect("update" in result.current).toBe(false);
    expect("delete" in result.current).toBe(false);
  });

  it("reports a readable error when the platform route returns HTML", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<!DOCTYPE html><html></html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const { result } = renderHook(() => usePlatformData<PlatformUser>("users"));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toContain("Expected JSON");
    expect(result.current.error?.message).not.toContain("Unexpected token");
    expect(result.current.data).toEqual([]);
  });

  it("reports a readable error when refresh receives HTML", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<!DOCTYPE html><html></html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );

    const { result } = renderHook(() => usePlatformData<PlatformUser>("users"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.refresh();

    await waitFor(() => expect(result.current.error?.message).toContain("Expected JSON"));
    expect(result.current.error?.message).not.toContain("Unexpected token");
  });

  it("exports platform data types", () => {
    const user: PlatformUser = { id: "u-1", name: "alice", role: "admin" };
    const group: PlatformGroup = { id: "g-1", name: "Ops", description: "Ops team", memberCount: 2 };
    const role: PlatformRole = { id: "admin", name: "Admin", permissions: ["*"] };

    expect(user.role).toBe("admin");
    expect(group.memberCount).toBe(2);
    expect(role.permissions).toEqual(["*"]);
  });
});
