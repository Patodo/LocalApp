import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act, cleanup } from "@testing-library/react";
import { useMe, useList, useGet, useCount } from "@localapp/sdk-react";
import { LocalAppError } from "@localapp/sdk";

afterEach(() => {
  cleanup();
});

describe("useMe", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("returns logged-in user", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { id: "alice", name: "alice" } }),
    } as Response);

    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me).toEqual({ id: "alice", name: "alice" });
  });

  it("returns null for unauthenticated user", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: null }),
    } as Response);

    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me).toBeNull();
  });

  it("sets error on fetch failure", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ success: false, error: "Internal error" }),
    } as Response);

    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(LocalAppError);
    expect(result.current.error!.status).toBe(500);
    expect(result.current.me).toBeNull();
  });

  it("refreshes the current user when dev context changes", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: null }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { id: "dev-user", name: "Dev User" } }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useMe());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.me).toBeNull();

    act(() => {
      window.dispatchEvent(new CustomEvent("localapp:dev-context-changed"));
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.me).toEqual({ id: "dev-user", name: "Dev User" }));
  });
});

describe("useList", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("returns rows and pagination", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        success: true,
        data: {
          rows: [{ id: 1, title: "hello" }, { id: 2, title: "world" }],
          pagination: { offset: 0, limit: 50, total: 2 },
        },
      }),
    } as Response);

    const { result } = renderHook(() => useList("posts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.pagination.total).toBe(2);
  });

  it("passes filters to URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { rows: [], pagination: { offset: 0, limit: 50, total: 0 } } }),
    } as Response);
    globalThis.fetch = fetchSpy;

    renderHook(() => useList("posts", { filters: { status: "published" } }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe("/serve/alice/my-app/api/queries/$posts.list");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string).params.status).toBe("published");
  });

  it("passes offset, limit, sort, order to URL", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { rows: [], pagination: { offset: 10, limit: 5, total: 0 } } }),
    } as Response);
    globalThis.fetch = fetchSpy;

    renderHook(() => useList("posts", { offset: 10, limit: 5, sort: "created_at", order: "desc" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const params = JSON.parse(fetchSpy.mock.calls[0][1].body as string).params;
    expect(params.offset).toBe(10);
    expect(params.limit).toBe(5);
    expect(params.sort).toBe("created_at");
    expect(params.order).toBe("desc");
  });

  it("refresh() re-fetches data", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { rows: [{ id: callCount }], pagination: { offset: 0, limit: 50, total: 1 } } }),
      } as Response);
    });

    const { result } = renderHook(() => useList("posts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows[0].id).toBe(1);

    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(result.current.rows[0].id).toBe(2));
  });

  it("sets error on 401 and loading becomes false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: "Authentication required" }),
    } as Response);

    const { result } = renderHook(() => useList("posts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(LocalAppError);
    expect(result.current.error!.status).toBe(401);
    expect(result.current.rows).toEqual([]);
  });

  it("sets error on 403", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ success: false, error: "Access denied" }),
    } as Response);

    const { result } = renderHook(() => useList("posts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(LocalAppError);
    expect(result.current.error!.status).toBe(403);
  });
});

describe("useGet", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("returns existing record", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { id: 1, title: "hello" } }),
    } as Response);

    const { result } = renderHook(() => useGet("posts", 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.row).toEqual({ id: 1, title: "hello" });
  });

  it("returns null for non-existent record", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: null }),
    } as Response);

    const { result } = renderHook(() => useGet("posts", 999));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.row).toBeNull();
  });

  it("sets error on 401 and loading becomes false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: "Authentication required" }),
    } as Response);

    const { result } = renderHook(() => useGet("posts", 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(LocalAppError);
    expect(result.current.error!.status).toBe(401);
    expect(result.current.row).toBeNull();
  });
});

describe("useCount", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("returns count", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { count: 42 } }),
    } as Response);

    const { result } = renderHook(() => useCount("posts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(42);
  });

  it("passes filters", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { count: 10 } }),
    } as Response);
    globalThis.fetch = fetchSpy;

    renderHook(() => useCount("posts", { status: "published" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(fetchSpy.mock.calls[0][0]).toBe("/serve/alice/my-app/api/queries/$posts.count");
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body as string).params.status).toBe("published");
  });

  it("sets error on 401 and loading becomes false", async () => {
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ success: false, error: "Authentication required" }),
    } as Response);

    const { result } = renderHook(() => useCount("posts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeInstanceOf(LocalAppError);
    expect(result.current.error!.status).toBe(401);
    expect(result.current.count).toBe(0);
  });

  it("refreshes when dev context changes", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { count: 1 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { count: 2 } }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useCount("posts"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.count).toBe(1);

    act(() => {
      window.dispatchEvent(new CustomEvent("localapp:dev-context-changed"));
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.count).toBe(2));
  });
});
