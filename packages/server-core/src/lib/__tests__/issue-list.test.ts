import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeAllConnections,
  createIssueLabel,
  ensureIssueTables,
  deleteIssueComment,
  deleteIssue,
  getConnection,
  getIssueByNumber,
  getIssueDetail,
  insertIssue,
  insertIssueComment,
  insertIssueEvent,
  listIssues,
  replaceIssueAssignees,
  replaceIssueLabels,
  replaceIssueMentions,
  setIssueSubscription,
  setIssueLock,
  setIssuePin,
  updateIssue,
  updateIssueComment,
} from "../app-db.js";

describe("Issue list query contract", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-list-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("filters the structured query and returns aggregate metadata", async () => {
    const matched = await insertIssue(dbPath, "upload_100% fails", "", "bug", "alice");
    await insertIssueComment(dbPath, matched.id, "I can reproduce this", "bob");
    const deleted = await insertIssueComment(dbPath, matched.id, "obsolete", "mallory");
    await deleteIssueComment(dbPath, deleted.id, "mallory");
    await insertIssueEvent(dbPath, matched.id, "bob", "assigned");
    await insertIssue(dbPath, "uploadX100anything fails", "", "bug", "alice");
    await insertIssue(dbPath, "Other open bug", "", "bug", "carol");

    const result = await listIssues(dbPath, {
      q: "upload_100%",
      status: "open",
      issueType: "bug",
      author: "alice",
      participant: "bob",
      sort: "activity",
      direction: "desc",
      limit: 25,
      offset: 0,
    });

    expect(result).toMatchObject({
      data: [expect.objectContaining({
        id: matched.id,
        comment_count: 1,
        participant_ids: ["alice", "bob"],
        last_activity_at: expect.any(String),
      })],
      meta: { total: 1, open: 1, closed: 0, limit: 25, offset: 0 },
    });
    expect(result.data[0].participant_ids).not.toContain("mallory");
  });

  it("filters Closed Issues by reason and treats historical null as completed", async () => {
    const completed = await insertIssue(dbPath, "Completed", "", "bug", "alice");
    const notPlanned = await insertIssue(dbPath, "Not planned", "", "bug", "alice");
    const historical = await insertIssue(dbPath, "Historical", "", "bug", "alice");
    await updateIssue(dbPath, completed.id, { status: "closed", stateReason: "completed" });
    await updateIssue(dbPath, notPlanned.id, { status: "closed", stateReason: "not_planned" });
    await updateIssue(dbPath, historical.id, { status: "closed", stateReason: null });

    expect((await listIssues(dbPath, { status: "closed", reason: "completed" })).data.map(({ id }) => id).sort()).toEqual([completed.id, historical.id].sort());
    expect(await listIssues(dbPath, { status: "closed", reason: "not_planned" })).toMatchObject({
      data: [expect.objectContaining({ id: notPlanned.id })],
      meta: { total: 1, open: 0, closed: 1 },
    });
  });

  it("matches reporter, active commenter, or event actor as a participant", async () => {
    const issue = await insertIssue(dbPath, "Participants", "", "bug", "alice");
    await insertIssueComment(dbPath, issue.id, "present", "bob");
    const deleted = await insertIssueComment(dbPath, issue.id, "gone", "mallory");
    await deleteIssueComment(dbPath, deleted.id, "mallory");
    await insertIssueEvent(dbPath, issue.id, "carol", "closed");

    for (const participant of ["alice", "bob", "carol"]) {
      expect((await listIssues(dbPath, { participant })).data.map(({ id }) => id)).toContain(issue.id);
    }
    expect((await listIssues(dbPath, { participant: "mallory" })).data).toEqual([]);
  });

  it("filters custom labels and treats assignees as participants", async () => {
    const issue = await insertIssue(dbPath, "Security review", "", "feature", "alice");
    await createIssueLabel(dbPath, { id: "security", name: "安全", color: "5319e7" });
    await replaceIssueLabels(dbPath, issue.id, ["security"]);
    await replaceIssueAssignees(dbPath, issue.id, ["bob"], "owner");

    const byLabel = await listIssues(dbPath, { label: "security" });
    const byAssignee = await listIssues(dbPath, { participant: "bob" });

    expect(byLabel.data).toEqual([expect.objectContaining({
      id: issue.id,
      labels: expect.arrayContaining([expect.objectContaining({ id: "security" })]),
      assignee_ids: ["bob"],
    })]);
    expect(byAssignee.data.map(({ id }) => id)).toEqual([issue.id]);
    expect(byAssignee.data[0].participant_ids).toEqual(["alice", "bob"]);
  });

  it("keeps notification-only subscribers out of public participants and activity", async () => {
    const issue = await insertIssue(dbPath, "Quiet watcher", "", "bug", "alice");
    const before = (await listIssues(dbPath, {})).data[0];
    await setIssueSubscription(dbPath, issue.id, "watcher", true);
    await insertIssueEvent(dbPath, issue.id, "watcher", "subscribed");

    expect((await listIssues(dbPath, { participant: "watcher" })).data).toEqual([]);
    const after = (await listIssues(dbPath, {})).data[0];
    expect(after.participant_ids).toEqual(["alice"]);
    expect(after.last_activity_at).toBe(before.last_activity_at);
  });

  it("filters subscriptions for one server-selected user without exposing watchers as participants", async () => {
    const watched = await insertIssue(dbPath, "Watched by Alice", "", "bug", "bob");
    const other = await insertIssue(dbPath, "Watched by Bob", "", "feature", "carol");
    await setIssueSubscription(dbPath, watched.id, "alice", true);
    await setIssueSubscription(dbPath, other.id, "bob", true);

    const result = await listIssues(dbPath, { subscriberId: "alice" });

    expect(result.data).toEqual([expect.objectContaining({
      id: watched.id,
      participant_ids: ["bob"],
    })]);
    expect(result.meta.total).toBe(1);
  });

  it("filters locked and unlocked Issues independently of lifecycle status", async () => {
    const lockedOpen = await insertIssue(dbPath, "Locked open", "", "bug", "alice");
    await setIssueLock(dbPath, lockedOpen.id, "alice", "resolved");
    const unlockedOpen = await insertIssue(dbPath, "Unlocked open", "", "bug", "alice");
    const lockedClosed = await insertIssue(dbPath, "Locked closed", "", "bug", "alice");
    await updateIssue(dbPath, lockedClosed.id, { status: "closed" });
    await setIssueLock(dbPath, lockedClosed.id, "alice", "resolved");

    expect((await listIssues(dbPath, { status: "open", locked: true })).data.map(({ id }) => id)).toEqual([lockedOpen.id]);
    expect((await listIssues(dbPath, { status: "open", locked: false })).data.map(({ id }) => id)).toEqual([unlockedOpen.id]);
    expect((await listIssues(dbPath, { locked: true })).data.map(({ id }) => id)).toEqual([lockedClosed.id, lockedOpen.id]);
  });

  it("escapes percent and underscore as literal search characters", async () => {
    const literal = await insertIssue(dbPath, "Need 100%_coverage", "", "bug", "alice");
    await insertIssue(dbPath, "Need 100Xcoverage", "", "bug", "alice");

    const result = await listIssues(dbPath, { q: "100%_coverage" });

    expect(result.data.map(({ id }) => id)).toEqual([literal.id]);
  });

  it("searches current comment bodies without duplicating Issues and keeps lifecycle counts", async () => {
    const open = await insertIssue(dbPath, "Open discussion", "No token here", "bug", "alice");
    await insertIssueComment(dbPath, open.id, "diagnostic-token appears once", "bob");
    await insertIssueComment(dbPath, open.id, "diagnostic-token appears again", "carol");
    const closed = await insertIssue(dbPath, "Closed discussion", "No token here", "bug", "alice");
    await updateIssue(dbPath, closed.id, { status: "closed" });
    await insertIssueComment(dbPath, closed.id, "diagnostic-token final answer", "bob");

    const result = await listIssues(dbPath, { q: "diagnostic-token" });

    expect(result.data.map(({ id }) => id)).toEqual([closed.id, open.id]);
    expect(result.meta).toMatchObject({ total: 2, open: 1, closed: 1 });
  });

  it("limits text search to canonical title, body, and comment scopes", async () => {
    const title = await insertIssue(dbPath, "Scope needle", "body only", "bug", "alice");
    const body = await insertIssue(dbPath, "Body target", "Scope needle", "bug", "alice");
    const comments = await insertIssue(dbPath, "Comment target", "body only", "bug", "alice");
    await insertIssueComment(dbPath, comments.id, "Scope needle", "bob");

    expect((await listIssues(dbPath, { q: "Scope needle", searchIn: ["title"] })).data.map((issue) => issue.id)).toEqual([title.id]);
    expect((await listIssues(dbPath, { q: "Scope needle", searchIn: ["body"] })).data.map((issue) => issue.id)).toEqual([body.id]);
    expect((await listIssues(dbPath, { q: "Scope needle", searchIn: ["comments"] })).data.map((issue) => issue.id)).toEqual([comments.id]);
    const combined = await listIssues(dbPath, { q: "Scope needle", searchIn: ["title", "comments"] });
    expect(new Set(combined.data.map((issue) => issue.id))).toEqual(new Set([title.id, comments.id]));
    expect(combined.meta).toMatchObject({ total: 2, open: 2, closed: 0 });
  });

  it("pins at most three Issues atomically and returns the independent pinned collection", async () => {
    const issues = await Promise.all(Array.from({ length: 4 }, (_, index) => (
      insertIssue(dbPath, `Pinned ${index + 1}`, "", "bug", "alice")
    )));

    expect(await setIssuePin(dbPath, issues[0].id, "owner", true)).toBe("updated");
    expect(await setIssuePin(dbPath, issues[1].id, "owner", true)).toBe("updated");
    const concurrent = await Promise.all([
      setIssuePin(dbPath, issues[2].id, "owner", true),
      setIssuePin(dbPath, issues[3].id, "owner", true),
    ]);
    expect(concurrent.sort()).toEqual(["limit", "updated"]);

    const result = await listIssues(dbPath, { q: "does-not-match" });
    expect(result.data).toEqual([]);
    expect(result.pinned).toHaveLength(3);
    const pinnedAt = result.pinned.map((issue) => issue.pinned_at);
    expect(pinnedAt).toEqual([...pinnedAt].sort().reverse());
    expect(result.pinned.every((issue) => issue.pinned_by === "owner")).toBe(true);

    const pinnedIds = new Set(result.pinned.map((issue) => issue.id));
    const rejected = issues.find((issue) => !pinnedIds.has(issue.id))!;
    expect(await setIssuePin(dbPath, result.pinned[0].id, "owner", false)).toBe("updated");
    expect(await setIssuePin(dbPath, rejected.id, "owner", true)).toBe("updated");
    expect((await listIssues(dbPath)).pinned).toHaveLength(3);
  });

  it("keeps pin no-ops and limit failures out of the timeline", async () => {
    const issues = await Promise.all(Array.from({ length: 4 }, (_, index) => insertIssue(dbPath, `Timeline pin ${index}`, "", "bug", "alice")));
    for (const issue of issues.slice(0, 3)) expect(await setIssuePin(dbPath, issue.id, "owner", true)).toBe("updated");
    expect(await setIssuePin(dbPath, issues[0].id, "owner", true)).toBe("unchanged");
    expect(await setIssuePin(dbPath, issues[3].id, "owner", true)).toBe("limit");

    const first = await getIssueDetail(dbPath, issues[0].id);
    const rejected = await getIssueDetail(dbPath, issues[3].id);
    expect(first?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "pinned")).toHaveLength(1);
    expect(rejected?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "pinned")).toHaveLength(0);
  });

  it("stops matching edited or deleted comments and escapes comment wildcards", async () => {
    const issue = await insertIssue(dbPath, "Discussion", "No token here", "bug", "alice");
    const edited = await insertIssueComment(dbPath, issue.id, "ERR_100% literal", "bob");
    const deleted = await insertIssueComment(dbPath, issue.id, "ERR_100% literal", "carol");
    await insertIssueComment(dbPath, issue.id, "ERRX100anything distractor", "dave");

    expect((await listIssues(dbPath, { q: "ERR_100%" })).data.map(({ id }) => id)).toEqual([issue.id]);
    await updateIssueComment(dbPath, edited.id, "resolved without the code", "bob");
    await deleteIssueComment(dbPath, deleted.id, "carol");
    expect((await listIssues(dbPath, { q: "ERR_100%" })).data).toEqual([]);
  });

  it("sorts every supported field in both directions and paginates ties stably", async () => {
    const first = await insertIssue(dbPath, "First", "", "bug", "alice");
    const second = await insertIssue(dbPath, "Second", "", "bug", "alice");
    const third = await insertIssue(dbPath, "Third", "", "bug", "alice");
    const db = await getConnection(dbPath);
    db.run("UPDATE _issues SET created_at = ?, updated_at = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", "2026-01-03T00:00:00.000Z", first.id]);
    db.run("UPDATE _issues SET created_at = ?, updated_at = ? WHERE id = ?", ["2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z", second.id]);
    db.run("UPDATE _issues SET created_at = ?, updated_at = ? WHERE id = ?", ["2026-01-02T00:00:00.000Z", "2026-01-01T00:00:00.000Z", third.id]);
    await insertIssueComment(dbPath, first.id, "one", "bob");
    await insertIssueComment(dbPath, third.id, "one", "bob");
    await insertIssueComment(dbPath, third.id, "two", "carol");

    const ids = async (sort: "created" | "updated" | "comments", direction: "asc" | "desc") =>
      (await listIssues(dbPath, { sort, direction })).data.map(({ id }) => id);

    expect(await ids("created", "asc")).toEqual([first.id, third.id, second.id]);
    expect(await ids("created", "desc")).toEqual([third.id, second.id, first.id]);
    expect(await ids("updated", "asc")).toEqual([third.id, second.id, first.id]);
    expect(await ids("updated", "desc")).toEqual([first.id, second.id, third.id]);
    expect(await ids("comments", "asc")).toEqual([second.id, first.id, third.id]);
    expect(await ids("comments", "desc")).toEqual([third.id, first.id, second.id]);

    const firstPage = await listIssues(dbPath, { sort: "created", direction: "asc", limit: 1, offset: 0 });
    const secondPage = await listIssues(dbPath, { sort: "created", direction: "asc", limit: 1, offset: 1 });
    expect(firstPage.data.map(({ id }) => id)).toEqual([first.id]);
    expect(secondPage.data.map(({ id }) => id)).toEqual([third.id]);
  });

  it("returns lifecycle counts within the current non-status filters", async () => {
    await insertIssue(dbPath, "Open bug", "", "bug", "alice");
    const closed = await insertIssue(dbPath, "Closed bug", "", "bug", "alice");
    await updateIssue(dbPath, closed.id, { status: "closed" });
    await insertIssue(dbPath, "Feature", "", "feature", "alice");

    const result = await listIssues(dbPath, { issueType: "bug", limit: 1, offset: 1 });
    const openOnly = await listIssues(dbPath, { status: "open" });
    const noMatches = await listIssues(dbPath, { q: "missing Issue" });

    expect(result.meta).toEqual({ total: 2, open: 1, closed: 1, limit: 1, offset: 1 });
    expect(result.data).toHaveLength(1);
    expect(openOnly.meta).toMatchObject({ total: 2, open: 2, closed: 1 });
    expect(noMatches.meta).toMatchObject({ total: 0, open: 0, closed: 0 });
  });

  it("keeps private subscription filters in both lifecycle counts", async () => {
    const watchedOpen = await insertIssue(dbPath, "Watched open", "", "bug", "alice");
    const watchedClosed = await insertIssue(dbPath, "Watched closed", "", "bug", "alice");
    const other = await insertIssue(dbPath, "Other watcher", "", "bug", "alice");
    await updateIssue(dbPath, watchedClosed.id, { status: "closed" });
    await setIssueSubscription(dbPath, watchedOpen.id, "viewer", true);
    await setIssueSubscription(dbPath, watchedClosed.id, "viewer", true);
    await setIssueSubscription(dbPath, other.id, "someone-else", true);

    expect((await listIssues(dbPath, { subscriberId: "viewer", status: "open" })).meta).toMatchObject({ total: 1, open: 1, closed: 1 });
    expect((await listIssues(dbPath, { subscriberId: "viewer", status: "closed" })).meta).toMatchObject({ total: 1, open: 1, closed: 1 });
  });

  it("indexes current issue and comment mentions for a private list filter", async () => {
    const issue = await insertIssue(dbPath, "Mention index", "", "bug", "author");
    const comment = await insertIssueComment(dbPath, issue.id, "hello", "commenter");
    await replaceIssueMentions(dbPath, { issueId: issue.id, targetType: "issue", targetId: issue.id, userIds: ["alice", "alice"] });
    await replaceIssueMentions(dbPath, { issueId: issue.id, targetType: "comment", targetId: comment.id, userIds: ["bob"] });
    expect((await listIssues(dbPath, { mentionedUserId: "alice" } as never)).data.map(({ id }) => id)).toEqual([issue.id]);
    expect((await listIssues(dbPath, { mentionedUserId: "bob" } as never)).data.map(({ id }) => id)).toEqual([issue.id]);

    await replaceIssueMentions(dbPath, { issueId: issue.id, targetType: "comment", targetId: comment.id, userIds: ["alice"] });
    expect((await listIssues(dbPath, { mentionedUserId: "bob" } as never)).data).toEqual([]);
    await deleteIssueComment(dbPath, comment.id, "commenter");
    await replaceIssueMentions(dbPath, { issueId: issue.id, targetType: "issue", targetId: issue.id, userIds: [] });
    expect((await listIssues(dbPath, { mentionedUserId: "alice" } as never)).data).toEqual([]);
  });

  it("deletes an Issue and every issue-scoped record while returning bound attachments", async () => {
    const issue = await insertIssue(dbPath, "Disposable issue", "private body", "bug", "alice");
    const comment = await insertIssueComment(dbPath, issue.id, "comment", "bob");
    await insertIssueEvent(dbPath, issue.id, "alice", "opened", {});
    await createIssueLabel(dbPath, { id: "disposable", name: "Disposable", color: "ededed" });
    await replaceIssueLabels(dbPath, issue.id, ["disposable"]);
    await replaceIssueAssignees(dbPath, issue.id, ["bob"], "alice");
    await setIssueSubscription(dbPath, issue.id, "alice", true);
    await replaceIssueMentions(dbPath, { issueId: issue.id, targetType: "comment", targetId: comment.id, userIds: ["alice"] });
    const db = await getConnection(dbPath);
    db.run("INSERT INTO _issue_reactions (issue_id, comment_id, user_id, content, created_at) VALUES (?, ?, ?, ?, ?)", [issue.id, comment.id, "alice", "+1", new Date().toISOString()]);
    db.run("INSERT INTO _issue_revisions (issue_id, target_type, target_id, editor_id, body, fields_json, created_at) VALUES (?, 'issue', ?, 'alice', 'old', '[\"body\"]', ?)", [issue.id, issue.id, new Date().toISOString()]);
    db.run("INSERT INTO _issue_attachments (id, page_path, issue_id, comment_id, draft_id, uploader_id, storage_key, file_name, mime_type, size_bytes, created_at, bound_at) VALUES ('bound', 'alice/app', ?, NULL, 'draft', 'alice', 'object-key', 'proof.png', 'image/png', 5, ?, ?)", [issue.id, new Date().toISOString(), new Date().toISOString()]);

    const removed = await deleteIssue(dbPath, issue.id);

    expect(removed?.map((attachment) => attachment.storage_key)).toEqual(["object-key"]);
    expect(await getIssueByNumber(dbPath, issue.issueNumber)).toBeNull();
    for (const table of ["_issue_comments", "_issue_events", "_issue_attachments", "_issue_label_links", "_issue_assignees", "_issue_subscriptions", "_issue_mentions", "_issue_reactions", "_issue_revisions"]) {
      expect(db.exec(`SELECT COUNT(*) FROM ${table} WHERE issue_id = ${issue.id}`)[0]?.values[0]?.[0]).toBe(0);
    }
  });

  it("uses the latest Issue update, active comment, or event as last activity", async () => {
    const issue = await insertIssue(dbPath, "Latest activity", "", "bug", "alice");
    const comment = await insertIssueComment(dbPath, issue.id, "Older comment", "bob");
    const event = await insertIssueEvent(dbPath, issue.id, "carol", "assigned");
    const db = await getConnection(dbPath);
    db.run("UPDATE _issue_comments SET created_at = ? WHERE id = ?", ["2026-01-01T00:00:00.000Z", comment.id]);
    db.run("UPDATE _issue_events SET created_at = ? WHERE id = ?", ["2026-01-02T00:00:00.000Z", event.id]);
    db.run("UPDATE _issues SET updated_at = ? WHERE id = ?", ["2026-01-03T00:00:00.000Z", issue.id]);

    const result = await listIssues(dbPath, { q: "Latest activity" });

    expect(result.data[0]).toMatchObject({
      id: issue.id,
      last_activity_at: "2026-01-03T00:00:00.000Z",
    });
  });

  it("defaults to 25 results and keeps the limit within 1 through 100", async () => {
    expect((await listIssues(dbPath)).meta.limit).toBe(25);
    expect((await listIssues(dbPath, { limit: 1 })).meta.limit).toBe(1);
    expect((await listIssues(dbPath, { limit: 100 })).meta.limit).toBe(100);
    expect((await listIssues(dbPath, { limit: 0 })).meta.limit).toBe(1);
    expect((await listIssues(dbPath, { limit: 101 })).meta.limit).toBe(100);
  });

  it("resolves a public Issue number independently from its database id", async () => {
    await ensureIssueTables(dbPath);
    const db = await getConnection(dbPath);
    db.run("INSERT INTO _issues (id, issue_number, title, description, status, label, reporter_id, created_at, updated_at) VALUES (99, 42, 'Referenced', '', 'open', 'bug', 'alice', '2026-01-01', '2026-01-01')");

    expect(await getIssueByNumber(dbPath, 42)).toMatchObject({ id: 99, issue_number: 42, title: "Referenced" });
    expect(await getIssueByNumber(dbPath, 99)).toBeNull();
  });

  it("keeps a 150-Issue fixture bounded and paginates stable ties", async () => {
    await ensureIssueTables(dbPath);
    const db = await getConnection(dbPath);
    const timestamp = "2026-01-01T00:00:00.000Z";
    for (let number = 1; number <= 150; number += 1) {
      db.run(
        "INSERT INTO _issues (issue_number, title, description, status, label, reporter_id, created_at, updated_at) VALUES (?, ?, '', 'open', 'bug', 'load-user', ?, ?)",
        [number, `Load Issue ${number}`, timestamp, timestamp],
      );
    }
    await ensureIssueTables(dbPath);

    const first = await listIssues(dbPath, { sort: "created", direction: "desc", limit: 100, offset: 0 });
    const second = await listIssues(dbPath, { sort: "created", direction: "desc", limit: 100, offset: 100 });

    expect(first.data).toHaveLength(100);
    expect(second.data).toHaveLength(50);
    expect(first.meta).toMatchObject({ total: 150, limit: 100, offset: 0 });
    expect(first.data[0].issue_number).toBe(150);
    expect(first.data.at(-1)?.issue_number).toBe(51);
    expect(second.data[0].issue_number).toBe(50);
    expect(second.data.at(-1)?.issue_number).toBe(1);
  });
});
