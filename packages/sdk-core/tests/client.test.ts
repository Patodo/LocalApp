import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, availableTransitions, detectBasePath, LocalAppError, transactionResult } from "../src/client.js";

describe("detectBasePath", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses native shell resource base from the formal shell route", () => {
    vi.stubGlobal("window", { location: { pathname: "/test-owner/team-workload/" } });
    vi.stubGlobal("document", {
      querySelector: vi.fn(() => ({
        getAttribute: vi.fn(() => "/serve/test-owner/team-workload/"),
      })),
    });

    expect(detectBasePath()).toBe("/serve/test-owner/team-workload/api");
  });

  it("keeps raw /serve route detection only as compatibility", () => {
    vi.stubGlobal("window", { location: { pathname: "/serve/alice/workload/" } });

    expect(detectBasePath()).toBe("/serve/alice/workload/api");
  });
});

describe("LocalAppClient named SQL APIs", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { pathname: "/serve/alice/workload/" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts params to /api/queries/:name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ rows: [{ id: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    const result = await client.query("work_items.byStatus", { status: "open" });

    expect(fetchMock).toHaveBeenCalledWith("/serve/alice/workload/api/queries/work_items.byStatus", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { status: "open" } }),
    });
    expect(result.rows).toEqual([{ id: 1 }]);
  });

  it("posts params to /api/mutations/:name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ changes: 1, lastInsertRowId: 7 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    const result = await client.mutate("work_items.close", { id: 7 });

    expect(fetchMock).toHaveBeenCalledWith("/serve/alice/workload/api/mutations/work_items.close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ params: { id: 7 } }),
    });
    expect(result.changes).toBe(1);
  });

  it("posts registered mutations to /api/mutations/_transaction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { changes: 1, lastInsertRowId: 7 },
      { changes: 1, lastInsertRowId: 0 },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    const result = await client.transaction([
      { name: "$work_items.create", params: { title: "A" } },
      { name: "$audit_logs.create", params: { message: "created" } },
    ]);

    expect(fetchMock).toHaveBeenCalledWith("/serve/alice/workload/api/mutations/_transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mutations: [
          { name: "$work_items.create", params: { title: "A" } },
          { name: "$audit_logs.create", params: { message: "created" } },
        ],
      }),
    });
    expect(result).toEqual([
      { changes: 1, lastInsertRowId: 7 },
      { changes: 1, lastInsertRowId: 0 },
    ]);
  });

  it("can build previous transaction result refs for dependent mutation params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { changes: 1, lastInsertRowId: 7 },
      { changes: 1, lastInsertRowId: 0 },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await client.transaction([
      { name: "$work_items.create", params: { title: "A" } },
      {
        name: "$work_item_stages.create",
        params: { work_item_id: transactionResult(0, "lastInsertRowId") },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith("/serve/alice/workload/api/mutations/_transaction", expect.objectContaining({
      body: JSON.stringify({
        mutations: [
          { name: "$work_items.create", params: { title: "A" } },
          {
            name: "$work_item_stages.create",
            params: { work_item_id: { $result: 0, field: "lastInsertRowId" } },
          },
        ],
      }),
    }));
  });

  it("posts input to /api/actions/:name", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    const result = await client.action("work_items.close", { id: 7 });

    expect(fetchMock).toHaveBeenCalledWith("/serve/alice/workload/api/actions/work_items.close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: { id: 7 } }),
    });
    expect(result).toEqual({ ok: true });
  });

  it("action throws LocalAppError on server errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(403, "Access denied"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.action("work_items.close", { id: 7 })).rejects.toMatchObject({
      name: "LocalAppError",
      status: 403,
      message: "Access denied",
    });
  });

  it("can serve list through a system named query while preserving list shape", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      rows: [{ id: 1, title: "A" }],
      pagination: { offset: 0, limit: 10, total: 1 },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    const result = await client.list("work_items", {
      offset: 0,
      limit: 10,
      sort: "created_at",
      order: "desc",
      filters: { status: "open" },
    });

    expect(fetchMock).toHaveBeenCalledWith("/serve/alice/workload/api/queries/$work_items.list", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        params: {
          offset: 0,
          limit: 10,
          sort: "created_at",
          order: "desc",
          status: "open",
        },
      }),
    });
    expect(result).toEqual({
      rows: [{ id: 1, title: "A" }],
      pagination: { offset: 0, limit: 10, total: 1 },
    });
  });
});

describe("LocalAppClient helper 调用 named SQL 不再 fallback 到 REST", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { location: { pathname: "/serve/alice/workload/" } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list 在 named SQL 404 时直接抛错，不发起 REST 请求", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, "Not found"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.list("work_items")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/serve/alice/workload/api/queries/$work_items.list",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create 在 named SQL 失败时直接抛错，不发起 REST POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(400, "Unknown param"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.create("work_items", { title: "x" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/serve/alice/workload/api/mutations/$work_items.create",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("update 在 named SQL 失败时直接抛错，不发起 REST PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, "Not found"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.update("work_items", 7, { title: "y" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/serve/alice/workload/api/mutations/$work_items.update");
    expect((init as RequestInit).method).toBe("POST");
  });

  it("create 在 mutation 成功后用 lastInsertRowId 调 get 拉完整 row", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ changes: 1, lastInsertRowId: 42 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ rows: [{ id: 42, title: "x", created_by: "alice" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    const row = await client.create<{ id: number; title: string; created_by: string }>("work_items", {
      title: "x",
    });

    expect(row).toEqual({ id: 42, title: "x", created_by: "alice" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "/serve/alice/workload/api/mutations/$work_items.create",
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/serve/alice/workload/api/queries/$work_items.get",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("create 在 mutation 缺少 lastInsertRowId 时抛错", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ changes: 0, lastInsertRowId: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.create("work_items", { title: "x" })).rejects.toThrow(/lastInsertRowId/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("create 在 get 返回空时抛错（记录对当前用户不可见）", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ changes: 1, lastInsertRowId: 42 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ rows: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.create("work_items", { title: "x" })).rejects.toThrow(/not visible/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("update 在 mutation 成功后调 get 拉最新 row", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ changes: 1, lastInsertRowId: 0 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ rows: [{ id: 7, title: "y" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    const row = await client.update<{ id: number; title: string }>("work_items", 7, { title: "y" });

    expect(row).toEqual({ id: 7, title: "y" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/serve/alice/workload/api/queries/$work_items.get",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("update 在 get 返回空时抛错", async () => {
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ changes: 1, lastInsertRowId: 0 }));
    fetchMock.mockResolvedValueOnce(jsonResponse({ rows: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.update("work_items", 7, { title: "y" })).rejects.toThrow(/not visible/);
  });

  it("delete 在 named SQL 失败时直接抛错，不发起 REST DELETE", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, "Not found"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.delete("work_items", 7)).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("count 在 named SQL 缺失时抛错，不 fallback 到 REST count 或 list", async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(404, "Not found"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createClient();
    await expect(client.count("work_items")).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/serve/alice/workload/api/queries/$work_items.count",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("client 不再暴露 exec 方法", () => {
    vi.stubGlobal("window", { location: { pathname: "/serve/alice/workload/" } });
    const client = createClient();
    expect((client as unknown as { exec?: unknown }).exec).toBeUndefined();
  });

  it("client 不再暴露 listTransitions / executeTransition 方法", () => {
    vi.stubGlobal("window", { location: { pathname: "/serve/alice/workload/" } });
    const client = createClient();
    expect((client as unknown as { listTransitions?: unknown }).listTransitions).toBeUndefined();
    expect((client as unknown as { executeTransition?: unknown }).executeTransition).toBeUndefined();
  });
});

describe("availableTransitions", () => {
  it("根据 record 当前状态过滤 transitions", () => {
    const result = availableTransitions(
      {
        statusField: "status",
        transitions: [
          { name: "submit", label: "提交", to: "submitted", from: ["draft"] },
          { name: "approve", label: "批准", to: "approved", from: ["submitted"] },
        ],
      },
      { status: "draft" },
    );
    expect(result).toEqual([{ name: "submit", label: "提交", to: "submitted" }]);
  });

  it("当前状态匹配多个 transitions 时返回全部", () => {
    const result = availableTransitions(
      {
        statusField: "status",
        transitions: [
          { name: "approve", to: "approved", from: ["pending"] },
          { name: "reject", to: "rejected", from: ["pending"] },
        ],
      },
      { status: "pending" },
    );
    expect(result.map((t) => t.name).sort()).toEqual(["approve", "reject"]);
  });

  it("当前状态无可用 transition 时返回空数组", () => {
    const result = availableTransitions(
      {
        statusField: "status",
        transitions: [{ name: "approve", to: "approved", from: ["pending"] }],
      },
      { status: "approved" },
    );
    expect(result).toEqual([]);
  });

  it("schema 未声明 transitions 时返回空数组", () => {
    expect(availableTransitions({ statusField: "status" }, { status: "draft" })).toEqual([]);
    expect(availableTransitions(undefined, { status: "draft" })).toEqual([]);
  });

  it("transition 缺省 label 时回退到 name", () => {
    const result = availableTransitions(
      {
        statusField: "status",
        transitions: [{ name: "submit", to: "submitted", from: ["draft"] }],
      },
      { status: "draft" },
    );
    expect(result[0].label).toBe("submit");
  });

  it("不发任何网络请求（纯函数）", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    availableTransitions(
      { statusField: "status", transitions: [{ name: "x", to: "y", from: ["a"] }] },
      { status: "a" },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

function jsonResponse<T>(data: T): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ success: true, data }),
  } as Response;
}

function errorResponse(status: number, error: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({ success: false, error }),
  } as Response;
}
