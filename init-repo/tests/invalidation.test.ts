import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { subscribe, invalidate } from "@localapp/sdk";
import { useList, useCount, useCreate, useUpdate, useDelete } from "@localapp/sdk-react";

describe("invalidation bus", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("subscribe receives calls on invalidate", () => {
    const fn = vi.fn();
    const unsub = subscribe("tasks", fn);
    invalidate("tasks");
    expect(fn).toHaveBeenCalledOnce();
    unsub();
  });

  it("unsubscribe stops receiving calls", () => {
    const fn = vi.fn();
    const unsub = subscribe("tasks", fn);
    unsub();
    invalidate("tasks");
    expect(fn).not.toHaveBeenCalled();
  });

  it("invalidate only notifies matching resource", () => {
    const tasksFn = vi.fn();
    const postsFn = vi.fn();
    const u1 = subscribe("tasks", tasksFn);
    const u2 = subscribe("posts", postsFn);
    invalidate("tasks");
    expect(tasksFn).toHaveBeenCalledOnce();
    expect(postsFn).not.toHaveBeenCalled();
    u1();
    u2();
  });

  it("dev context changes invalidate subscribed resources", () => {
    const tasksFn = vi.fn();
    const postsFn = vi.fn();
    const u1 = subscribe("tasks", tasksFn);
    const u2 = subscribe("posts", postsFn);

    window.dispatchEvent(new CustomEvent("localapp:dev-context-changed"));

    expect(tasksFn).toHaveBeenCalledOnce();
    expect(postsFn).toHaveBeenCalledOnce();
    u1();
    u2();
  });
});

describe("mutation hooks trigger invalidation", () => {
  beforeEach(() => {
    delete (window as any).location;
    (window as any).location = { pathname: "/serve/alice/my-app/", origin: "http://localhost:3000" };
  });

  it("useCreate invalidates resource", async () => {
    const fn = vi.fn();
    const unsub = subscribe("posts", fn);
    globalThis.fetch = vi.fn()
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

    const { result } = renderHook(() => useCreate("posts"));
    await act(async () => {
      await result.current.create({ title: "test" });
    });

    expect(fn).toHaveBeenCalledOnce();
    unsub();
  });

  it("useDelete invalidates resource", async () => {
    const fn = vi.fn();
    const unsub = subscribe("posts", fn);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: { deleted: true } }),
    } as Response);

    const { result } = renderHook(() => useDelete("posts"));
    await act(async () => {
      await result.current.remove(1);
    });

    expect(fn).toHaveBeenCalledOnce();
    unsub();
  });

  it("useUpdate invalidates resource", async () => {
    const fn = vi.fn();
    const unsub = subscribe("posts", fn);
    globalThis.fetch = vi.fn()
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

    const { result } = renderHook(() => useUpdate("posts"));
    await act(async () => {
      await result.current.update(1, { title: "updated" });
    });

    expect(fn).toHaveBeenCalledOnce();
    unsub();
  });
});
