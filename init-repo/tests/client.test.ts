import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, LocalAppError } from "@localapp/sdk";

function mockFetch(url: string, init?: RequestInit) {
  const method = init?.method || "GET";
  const body = init?.body ? JSON.parse(init.body as string) : undefined;
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ success: true, data: { method, url, body } }),
  } as Response);
}

describe("createClient basePath detection", () => {
  const originalLocation = window.location;

  afterEach(() => {
    // @ts-expect-error restore location
    window.location = originalLocation;
  });

  it("detects basePath from /serve/{userId}/{name}/ path", () => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/index.html", origin: "http://localhost:3000" };
    const client = createClient();
    expect(client.basePath).toBe("/serve/alice/my-app/api");
  });

  it("defaults to /api for root path", () => {
    delete (window as any).location;
    (window as any).location = { pathname: "/", origin: "http://localhost:3000" };
    const client = createClient();
    expect(client.basePath).toBe("/api");
  });

  it("detects basePath from /serve/{userId}/{name}/ (trailing slash)", () => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
    const client = createClient();
    expect(client.basePath).toBe("/serve/alice/my-app/api");
  });
});

describe("createClient CRUD methods", () => {
  let client: ReturnType<typeof createClient>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
    fetchSpy = vi.fn(mockFetch);
    globalThis.fetch = fetchSpy;
    client = createClient();
  });

  it("me() calls GET /api/me", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { id: "alice", name: "alice" } }),
    } as Response);

    const result = await client.me();
    expect(fetchSpy).toHaveBeenCalledWith("/api/me", { method: "GET" });
    expect(result).toEqual({ id: "alice", name: "alice" });
  });

  it("time() calls GET {basePath}/time", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { now: "2026-07-01T09:00:00.000Z", today: "2026-07-01" } }),
    } as Response);

    const result = await client.time();
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/time", { method: "GET" });
    expect(result).toEqual({ now: "2026-07-01T09:00:00.000Z", today: "2026-07-01" });
  });

  it("list() calls system named query first", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        success: true,
        data: { rows: [{ id: 1, title: "hello" }], pagination: { offset: 0, limit: 50, total: 1 } },
      }),
    } as Response);

    const result = await client.list("posts");
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/queries/$posts.list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { offset: 0, limit: 50 } }),
    });
    expect(result.rows).toEqual([{ id: 1, title: "hello" }]);
    expect(result.pagination.total).toBe(1);
  });

  it("list() passes filters, offset, limit, sort, order as named params", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { rows: [], pagination: { offset: 10, limit: 5, total: 0 } } }),
    } as Response);

    await client.list("posts", { filters: { status: "published" }, offset: 10, limit: 5, sort: "created_at", order: "desc" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/serve/alice/my-app/api/queries/$posts.list",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ params: { offset: 10, limit: 5, sort: "created_at", order: "desc", status: "published" } }),
      },
    );
  });

  it("get() calls system named query first", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { id: 1, title: "hello" } }),
    } as Response);

    const result = await client.get("posts", 1);
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/queries/$posts.get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1 } }),
    });
    expect(result).toEqual({ id: 1, title: "hello" });
  });

  it("create() 在 mutation 后用 lastInsertRowId 调 $<resource>.get 拉完整 row", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { changes: 1, lastInsertRowId: 1 } }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "new" }] } }),
    } as Response);

    const result = await client.create<{ id: number; title: string }>("posts", { title: "new" });
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/serve/alice/my-app/api/mutations/$posts.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { title: "new" } }),
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/serve/alice/my-app/api/queries/$posts.get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1 } }),
    });
    expect(result).toEqual({ id: 1, title: "new" });
  });

  it("update() 在 mutation 后调 get 拉最新 row", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { changes: 1, lastInsertRowId: 0 } }),
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "updated" }] } }),
    } as Response);

    const result = await client.update<{ id: number; title: string }>("posts", 1, { title: "updated" });
    expect(fetchSpy).toHaveBeenNthCalledWith(1, "/serve/alice/my-app/api/mutations/$posts.update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1, title: "updated" } }),
    });
    expect(fetchSpy).toHaveBeenNthCalledWith(2, "/serve/alice/my-app/api/queries/$posts.get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1 } }),
    });
    expect(result).toEqual({ id: 1, title: "updated" });
  });

  it("delete() calls system named mutation first", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { deleted: true, id: 1 } }),
    } as Response);

    await client.delete("posts", 1);
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/mutations/$posts.delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1 } }),
    });
  });

  it("count() calls system named query first", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { count: 42 } }),
    } as Response);

    const result = await client.count("posts");
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/queries/$posts.count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: {} }),
    });
    expect(result).toBe(42);
  });

  it("count() passes filters as named params", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { count: 10 } }),
    } as Response);

    await client.count("posts", { status: "published" });
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/queries/$posts.count", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { status: "published" } }),
    });
  });

  // 原 "count() falls back to list pagination total when an old runtime returns 404"
  // 和 "count() does not fall back for auth, validation, or server errors" 两个测试
  // 已随 REST CRUD fallback 整体移除（restrict-app-api-to-named-sql 变更）。
  // count 现在只调 named SQL，未声明 $<resource>.count 时直接抛 LocalAppError。

  it("users() calls GET /api/users", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [{ id: "alice", name: "alice", displayName: null }] }),
    } as Response);

    const result = await client.users();
    expect(fetchSpy).toHaveBeenCalledWith("/api/users", { method: "GET" });
    expect(result).toEqual([{ id: "alice", name: "alice", displayName: null }]);
  });

  it("groups() calls GET /api/groups", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: [{ id: "g1", name: "team", description: null, isCreator: true }] }),
    } as Response);

    const result = await client.groups();
    expect(fetchSpy).toHaveBeenCalledWith("/api/groups", { method: "GET" });
    expect(result).toEqual([{ id: "g1", name: "team", description: null, isCreator: true }]);
  });

  it("groupMembers() calls GET /api/groups/{groupId}", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { members: [{ id: "alice", name: "alice", displayName: null }] } }),
    } as Response);

    const result = await client.groupMembers("g1");
    expect(fetchSpy).toHaveBeenCalledWith("/api/groups/g1", { method: "GET" });
    expect(result).toEqual([{ id: "alice", name: "alice", displayName: null }]);
  });

  it("throws on non-ok response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: "Authentication required" }),
    } as Response);

    await expect(client.list("posts")).rejects.toThrow("Authentication required");
  });
});

describe("LocalAppError", () => {
  it("extends Error", () => {
    const err = new LocalAppError("test", 401);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(LocalAppError);
  });

  it("carries status code", () => {
    const err = new LocalAppError("Auth required", 401);
    expect(err.message).toBe("Auth required");
    expect(err.status).toBe(401);
  });

  it("has correct name", () => {
    const err = new LocalAppError("test", 500);
    expect(err.name).toBe("LocalAppError");
  });
});

describe("request() throws LocalAppError", () => {
  let client: ReturnType<typeof createClient>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
    fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy;
    client = createClient();
  });

  it("throws LocalAppError with status 401 on auth failure", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: "Authentication required" }),
    } as Response);

    try {
      await client.list("posts");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LocalAppError);
      expect((e as LocalAppError).status).toBe(401);
      expect((e as LocalAppError).message).toBe("Authentication required");
    }
  });

  it("throws LocalAppError with status 403 on forbidden", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ success: false, error: "Access denied" }),
    } as Response);

    try {
      await client.get("posts", 1);
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LocalAppError);
      expect((e as LocalAppError).status).toBe(403);
    }
  });

  it("throws LocalAppError with fallback message when no error field", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ success: false }),
    } as Response);

    try {
      await client.me();
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LocalAppError);
      expect((e as LocalAppError).status).toBe(500);
      expect((e as LocalAppError).message).toBe("HTTP 500");
    }
  });

  it("throws LocalAppError when an error response is not JSON", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      text: () => Promise.resolve("<html>bad gateway</html>"),
    } as unknown as Response);

    try {
      await client.me();
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(LocalAppError);
      expect((e as LocalAppError).status).toBe(502);
      expect((e as LocalAppError).message).toBe("HTTP 502");
    }
  });
});
