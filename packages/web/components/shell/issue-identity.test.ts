import { afterEach, describe, expect, it, vi } from "vitest";
import { listIssueUsers } from "./issue-api";
import { initialForIdentity, resolveIssueIdentity } from "./issue-identity";

describe("Issue identity", () => {
  afterEach(() => vi.restoreAllMocks());

  it("prefers display names and preserves avatars", () => {
    expect(resolveIssueIdentity("alice", [{
      id: "alice",
      name: "alice-login",
      displayName: "Alice Chen",
      avatarUrl: "/api/avatar/alice",
    }])).toEqual({
      id: "alice",
      name: "alice-login",
      displayName: "Alice Chen",
      avatarUrl: "/api/avatar/alice",
    });
  });

  it("uses the last duplicate identity and falls back through name and id", () => {
    const users = [
      { id: "bob", name: "old-bob", displayName: null, avatarUrl: null },
      { id: "bob", name: "bob-login", displayName: "Bob Li", avatarUrl: null },
      { id: "carol", name: "carol-login", displayName: null, avatarUrl: null },
    ];

    expect(resolveIssueIdentity("bob", users).displayName).toBe("Bob Li");
    expect(resolveIssueIdentity("carol", users).displayName).toBe("carol-login");
    expect(resolveIssueIdentity("missing", users)).toEqual({
      id: "missing",
      displayName: "missing",
      avatarUrl: null,
    });
  });

  it("provides a semantic fallback for empty ids and case-safe initials", () => {
    const empty = resolveIssueIdentity("", []);

    expect(empty).toEqual({ id: "", displayName: "未知用户", avatarUrl: null });
    expect(initialForIdentity(empty)).toBe("?");
    expect(initialForIdentity({ id: "alice", displayName: "alice", avatarUrl: null })).toBe("A");
    expect(initialForIdentity({ id: "42", displayName: "42", avatarUrl: null })).toBe("4");
  });

  it("loads the authenticated public user directory", async () => {
    const signal = new AbortController().signal;
    const users = [{ id: "alice", name: "alice", displayName: "Alice", avatarUrl: "/api/avatar/alice" }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: users,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(listIssueUsers(signal)).resolves.toEqual(users);
    expect(fetchMock).toHaveBeenCalledWith("/api/users", { credentials: "include", signal: expect.any(AbortSignal) });
  });

  it.each([
    new Response(JSON.stringify({ success: false }), { status: 401, headers: { "content-type": "application/json" } }),
    new Response(JSON.stringify({ success: false }), { status: 403, headers: { "content-type": "application/json" } }),
    new Response("<!DOCTYPE html>", { status: 502, headers: { "content-type": "text/html" } }),
    new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
  ])("surfaces user directory failures", async (response) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await expect(listIssueUsers()).rejects.toThrow("负责人目录加载失败");
  });
});
