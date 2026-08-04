import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ISSUE_LIST_QUERY } from "./issue-list-query";
import { createIssueComment, createIssueLabel, createIssueSavedView, deleteIssueLabel, deleteIssueSavedView, duplicateIssueSavedView, getIssueDetail, getIssueDetailByNumber, listIssueLabels, listIssueSavedViews, listIssues, listIssueUsers, requestIssueCatalogWithRetry, updateIssueLabel, updateIssueReaction, updateIssueSavedView } from "./issue-api";

describe("Issue catalog transient recovery", () => {
  afterEach(() => vi.useRealTimers());

  it("uses session-scoped saved view endpoints without sending an owner id", async () => {
    const fetchMock = vi.fn()
      .mockImplementation(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    await listIssueSavedViews("owner/research");
    await createIssueSavedView("owner/research", "待验收", "本周", DEFAULT_ISSUE_LIST_QUERY);
    await updateIssueSavedView("owner/research", 7, { name: "准备发布", query: DEFAULT_ISSUE_LIST_QUERY });
    await duplicateIssueSavedView("owner/research", 7);
    await deleteIssueSavedView("owner/research", 7);

    expect(String(fetchMock.mock.calls[0][0])).toBe("/api/issues/views?pagePath=owner%2Fresearch");
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ pagePath: "owner/research", name: "待验收", description: "本周", query: expect.objectContaining({ offset: 0 }) });
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "/api/issues/views?pagePath=owner%2Fresearch", "/api/issues/views", "/api/issues/views/7", "/api/issues/views/7/copy", "/api/issues/views/7",
    ]);
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.credentials)).toEqual(["include", "include", "include", "include", "include"]);
    expect(fetchMock.mock.calls.map((call) => String((call[1] as RequestInit | undefined)?.body ?? ""))).not.toEqual(expect.arrayContaining([expect.stringContaining("user_id")]));
  });

  it("filters malformed saved view directory entries", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true, data: [
      { id: 1, user_id: "alice", name: "Valid", description: "", query: { offset: 0 }, created_at: "", updated_at: "" },
      { id: 2, title: "Issue row" },
    ] }), { status: 200, headers: { "Content-Type": "application/json" } })));
    await expect(listIssueSavedViews("owner/research")).resolves.toEqual([expect.objectContaining({ id: 1, name: "Valid" })]);
  });

  it("retries one transient failure after 300ms", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(["ready"]);

    const result = requestIssueCatalogWithRetry(request);
    await vi.advanceTimersByTimeAsync(299);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual(["ready"]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("stops after the single automatic retry", async () => {
    vi.useFakeTimers();
    const request = vi.fn().mockRejectedValue(new Error("offline"));

    const result = requestIssueCatalogWithRetry(request);
    const assertion = expect(result).rejects.toThrow("offline");
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("cancels the retry wait without issuing a stale request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn().mockRejectedValue(new Error("temporary"));

    const result = requestIssueCatalogWithRetry(request, controller.signal);
    const assertion = expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(100);
    controller.abort(new DOMException("Superseded", "AbortError"));
    await assertion;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("Issue API request deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts a list request whose response never arrives", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = listIssues("owner/research", DEFAULT_ISSUE_LIST_QUERY, undefined, 25);
    const assertion = expect(request).rejects.toThrow("Issue 服务暂不可用");
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);
  });

  it("forwards a caller abort while the list request is pending", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = listIssues("owner/research", DEFAULT_ISSUE_LIST_QUERY, controller.signal);
    const assertion = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(new DOMException("Superseded", "AbortError"));
    await assertion;
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);
  });

  it.each([
    ["id", () => getIssueDetail("owner/research", 12, 25)],
    ["number", () => getIssueDetailByNumber("owner/research", 42, 25)],
  ])("aborts a pending detail lookup by %s", async (_kind, load) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = load();
    const assertion = expect(request).rejects.toThrow("Issue 服务暂不可用");
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);
  });

  it.each([
    ["reaction", () => updateIssueReaction("owner/research", 12, "+1", true)],
    ["comment", () => createIssueComment("owner/research", 12, { body: "still here", attachmentIds: [], draftId: "draft-1" })],
    ["create label", () => createIssueLabel("owner/research", { name: "阻塞", color: "ff0000", description: "" })],
    ["update label", () => updateIssueLabel("owner/research", "triage", { name: "分诊", color: "1f6feb", description: "" })],
    ["delete label", () => deleteIssueLabel("owner/research", "triage")],
  ])("aborts a pending %s mutation", async (_kind, mutate) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = mutate();
    const assertion = expect(request).rejects.toThrow("Issue 服务暂不可用");
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);
  });

  it.each([
    ["labels", () => listIssueLabels("owner/research")],
    ["users", () => listIssueUsers()],
  ])("aborts a pending %s catalog request", async (_kind, load) => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);

    const request = load();
    const assertion = expect(request).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8_000);
    await assertion;
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);
  });
});
