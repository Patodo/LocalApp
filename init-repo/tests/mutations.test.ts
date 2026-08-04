import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useCreate, useUpdate, useDelete } from "@localapp/sdk-react";

describe("useCreate", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("calls POST and returns created record", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { changes: 1, lastInsertRowId: 1 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "new post" }] } }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useCreate("posts"));

    let created: any;
    await act(async () => {
      created = await result.current.create({ title: "new post" });
    });

    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/mutations/$posts.create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { title: "new post" } }),
    });
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/queries/$posts.get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1 } }),
    });
    expect(created).toEqual({ id: 1, title: "new post" });
  });

  it("calls onSuccess callback after successful create", async () => {
    const onSuccess = vi.fn();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { changes: 1, lastInsertRowId: 1 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "new post" }] } }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useCreate<{ id: number; title: string }>("posts", { onSuccess }));

    await act(async () => {
      await result.current.create({ title: "new post" });
    });

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith({ id: 1, title: "new post" });
  });

  it("works without options (backward compatible)", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { changes: 1, lastInsertRowId: 1 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "test" }] } }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useCreate("posts"));

    let created: any;
    await act(async () => {
      created = await result.current.create({ title: "test" });
    });

    expect(created).toEqual({ id: 1, title: "test" });
  });

  it("throws on validation error", async () => {
    vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ success: false, error: "Required field missing: title" }),
    } as Response);
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ success: false, error: "Required field missing: title" }),
    } as Response);

    const { result } = renderHook(() => useCreate("posts"));

    await expect(act(async () => {
      await result.current.create({});
    })).rejects.toThrow("Required field missing: title");
  });
});

describe("useUpdate", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("calls PUT and returns updated record", async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { changes: 1 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "updated" }] } }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useUpdate("posts"));

    let updated: any;
    await act(async () => {
      updated = await result.current.update(1, { title: "updated" });
    });

    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/mutations/$posts.update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1, title: "updated" } }),
    });
    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/queries/$posts.get", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1 } }),
    });
    expect(updated).toEqual({ id: 1, title: "updated" });
  });

  it("calls onSuccess callback after successful update", async () => {
    const onSuccess = vi.fn();
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { changes: 1 } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ success: true, data: { rows: [{ id: 1, title: "updated" }] } }),
      } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useUpdate<{ id: number; title: string }>("posts", { onSuccess }));

    await act(async () => {
      await result.current.update(1, { title: "updated" });
    });

    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onSuccess).toHaveBeenCalledWith({ id: 1, title: "updated" });
  });
});

describe("useDelete", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("calls DELETE", async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { deleted: true, id: 1 } }),
    } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useDelete("posts"));

    await act(async () => {
      await result.current.remove(1);
    });

    expect(fetchSpy).toHaveBeenCalledWith("/serve/alice/my-app/api/mutations/$posts.delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 1 } }),
    });
  });

  it("calls onSuccess callback after successful delete", async () => {
    const onSuccess = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { deleted: true } }),
    } as Response);
    globalThis.fetch = fetchSpy;

    const { result } = renderHook(() => useDelete("posts", { onSuccess }));

    await act(async () => {
      await result.current.remove(1);
    });

    expect(onSuccess).toHaveBeenCalledOnce();
  });
});
