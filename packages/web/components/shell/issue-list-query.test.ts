import { afterEach, describe, expect, it, vi } from "vitest";
import { listIssues } from "./issue-api";
import {
  DEFAULT_ISSUE_LIST_QUERY,
  issueListQueryFromSavedView,
  issueSavedViewMatchesListQuery,
  issueListQueryToSavedView,
  normalizeIssueListQuery,
  readIssueListQuery,
  serializeIssueListQuery,
  updateIssueListQueryUrl,
  type IssueListQuery,
} from "./issue-list-query";

describe("IssueListQuery", () => {
  afterEach(() => vi.restoreAllMocks());

  it("round-trips a saved view through list defaults while resetting offset", () => {
    const current = { ...DEFAULT_ISSUE_LIST_QUERY, q: "crash", searchIn: "title,comments", status: "closed" as const, reason: "completed" as const, sort: "comments" as const, direction: "asc" as const, limit: 50, offset: 100 };
    const saved = issueListQueryToSavedView(current);
    expect(saved).toMatchObject({ q: "crash", searchIn: ["title", "comments"], status: "closed", reason: "completed", sort: "comments", direction: "asc", limit: 50, offset: 0 });
    expect(issueListQueryFromSavedView(saved)).toEqual({ ...current, offset: 0 });
    expect(issueListQueryFromSavedView({ offset: 0 })).toEqual(DEFAULT_ISSUE_LIST_QUERY);
    expect(issueSavedViewMatchesListQuery({ offset: 0, q: "crash" }, { ...DEFAULT_ISSUE_LIST_QUERY, q: "crash" })).toBe(true);
    expect(issueSavedViewMatchesListQuery({ offset: 0, q: "crash" }, { ...DEFAULT_ISSUE_LIST_QUERY, q: "other" })).toBe(false);
  });

  it("uses the GitHub-style list defaults", () => {
    expect(DEFAULT_ISSUE_LIST_QUERY).toEqual({
      q: "",
      searchIn: "",
      status: "open",
      label: "",
      issueType: "",
      author: "",
      participant: "",
      assignee: "",
      milestone: "",
      reason: "",
      subscribed: false,
      mentioned: false,
      locked: "",
      sort: "activity",
      direction: "desc",
      limit: 25,
      offset: 0,
    });
  });

  it("trims text filters and resets the offset when a filter changes", () => {
    const previous: IssueListQuery = {
      ...DEFAULT_ISSUE_LIST_QUERY,
      q: "previous",
      searchIn: "title,comments",
      offset: 50,
    };

    expect(normalizeIssueListQuery(previous, { q: "  upload  ", author: " alice ", participant: " bob " })).toEqual({
      ...previous,
      q: "upload",
      author: "alice",
      participant: "bob",
      offset: 0,
    });
  });

  it("resets the offset when sorting changes but preserves it while paging", () => {
    const previous: IssueListQuery = { ...DEFAULT_ISSUE_LIST_QUERY, offset: 25 };

    expect(normalizeIssueListQuery(previous, { sort: "comments", direction: "asc" }).offset).toBe(0);
    expect(normalizeIssueListQuery(previous, { offset: 50 })).toEqual({ ...previous, offset: 50 });
  });

  it("serializes exactly the known list API parameters", () => {
    const params = new URLSearchParams(serializeIssueListQuery({
      ...DEFAULT_ISSUE_LIST_QUERY,
      q: "upload",
      searchIn: "title,comments",
      label: "needs-review",
      issueType: "bug",
      author: "alice",
      participant: "bob",
      assignee: "carol",
      milestone: "12",
      status: "closed",
      reason: "completed",
      locked: "locked",
      sort: "comments",
      direction: "asc",
      limit: 50,
      offset: 25,
      ignored: "not-an-api-parameter",
    } as IssueListQuery & { ignored: string }));

    expect([...params.keys()].sort()).toEqual(["assignee", "author", "direction", "in", "label", "limit", "locked", "milestone", "offset", "participant", "q", "reason", "sort", "status", "type"]);
    expect(params.get("q")).toBe("upload");
    expect(params.get("in")).toBe("title,comments");
    expect(params.get("type")).toBe("bug");
    expect(params.get("ignored")).toBeNull();
  });

  it("round-trips only canonical search scopes in workspace URLs", () => {
    const query = { ...DEFAULT_ISSUE_LIST_QUERY, q: "timeout", searchIn: "title,comments" };
    const url = updateIssueListQueryUrl(new URL("https://localapp.test/app"), query);
    expect(url.searchParams.get("localappIssueIn")).toBe("title,comments");
    expect(readIssueListQuery(url)).toEqual(query);
    expect(readIssueListQuery(new URL("https://localapp.test/app?localappIssueIn=comments,title")).searchIn).toBe("");
  });

  it("preserves the lock filter in API and workspace URLs", () => {
    const query = { ...DEFAULT_ISSUE_LIST_QUERY, locked: "unlocked" as const, offset: 25 };
    expect(serializeIssueListQuery(query).get("locked")).toBe("false");
    const url = updateIssueListQueryUrl(new URL("https://localapp.test/app"), query);
    expect(url.searchParams.get("localappIssueLocked")).toBe("unlocked");
    expect(readIssueListQuery(url)).toEqual(query);
  });

  it("reads only valid reserved list parameters and falls back per field", () => {
    expect(readIssueListQuery(new URL("https://localapp.test/app?localappIssueQ=%20upload%20&localappIssueStatus=closed&localappIssueType=bug&localappIssueLabel=urgent&localappIssueAuthor=alice&localappIssueParticipant=bob&localappIssueAssignee=carol&localappIssueMilestone=12&localappIssueSort=comments&localappIssueDirection=asc&localappIssueOffset=50"))).toEqual({
      ...DEFAULT_ISSUE_LIST_QUERY,
      q: "upload",
      status: "closed",
      label: "urgent",
      issueType: "bug",
      author: "alice",
      participant: "bob",
      assignee: "carol",
      milestone: "12",
      sort: "comments",
      direction: "asc",
      offset: 50,
    });

    expect(readIssueListQuery(new URL("https://localapp.test/app?localappIssueStatus=invalid&localappIssueSort=random&localappIssueDirection=sideways&localappIssueOffset=-1"))).toEqual(DEFAULT_ISSUE_LIST_QUERY);
  });

  it("serializes the unassigned milestone queue", () => {
    const query = { ...DEFAULT_ISSUE_LIST_QUERY, milestone: "none" };
    expect(serializeIssueListQuery(query).get("milestone")).toBe("none");
    expect(readIssueListQuery(updateIssueListQueryUrl(new URL("https://localapp.test/app"), query))).toEqual(query);
  });

  it("round-trips a Closed reason and clears it when switching to Open", () => {
    const closed = { ...DEFAULT_ISSUE_LIST_QUERY, status: "closed" as const, reason: "not_planned" as const, offset: 25 };
    const url = updateIssueListQueryUrl(new URL("https://localapp.test/app"), closed);
    expect(url.searchParams.get("localappIssueReason")).toBe("not_planned");
    expect(serializeIssueListQuery(closed).get("reason")).toBe("not_planned");
    expect(readIssueListQuery(url)).toEqual(closed);
    expect(normalizeIssueListQuery(closed, { status: "open" })).toMatchObject({ status: "open", reason: "", offset: 0 });
    expect(readIssueListQuery(new URL("https://localapp.test/app?localappIssueStatus=open&localappIssueReason=completed")).reason).toBe("");
  });

  it("writes non-default list state without replacing app, detail, comment, or hash state", () => {
    const source = new URL("https://localapp.test/owner/app?tab=history&localappIssueId=12&localappIssueCommentId=6&localappIssueStatus=open&localappIssueQ=old#stage-2");
    const updated = updateIssueListQueryUrl(source, {
      ...DEFAULT_ISSUE_LIST_QUERY,
      q: "upload failure",
      status: "closed",
      label: "urgent",
      sort: "created",
      direction: "asc",
      offset: 25,
    });

    expect(updated.href).toBe("https://localapp.test/owner/app?tab=history&localappIssueId=12&localappIssueCommentId=6&localappIssues=1&localappIssueQ=upload+failure&localappIssueStatus=closed&localappIssueLabel=urgent&localappIssueSort=created&localappIssueDirection=asc&localappIssueOffset=25#stage-2");
    expect(source.searchParams.get("localappIssueQ")).toBe("old");
    expect(updateIssueListQueryUrl(updated, DEFAULT_ISSUE_LIST_QUERY).href).toBe("https://localapp.test/owner/app?tab=history&localappIssueId=12&localappIssueCommentId=6&localappIssues=1#stage-2");
  });

  it("reads top-level list metadata and supplies a cancellable request signal", async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [{ id: 1, issue_number: 1, title: "Upload", description: "", status: "open", label: "bug", reporter_id: "alice", created_at: "2026-01-01", updated_at: "2026-01-01", comment_count: 2, last_activity_at: "2026-01-02", participant_ids: ["alice", "bob"] }],
      meta: { total: 1, open: 3, closed: 2, limit: 25, offset: 0 },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    const result = await listIssues("owner/app", { ...DEFAULT_ISSUE_LIST_QUERY, q: "upload" }, controller.signal);

    expect(result.meta).toEqual({ total: 1, open: 3, closed: 2, limit: 25, offset: 0 });
    expect(result.data[0]).toMatchObject({ comment_count: 2, participant_ids: ["alice", "bob"] });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("pagePath=owner%2Fapp"),
      { credentials: "include", signal: expect.any(AbortSignal) },
    );
  });
});
