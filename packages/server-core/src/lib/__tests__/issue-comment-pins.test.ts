import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeAllConnections,
  deleteIssueComment,
  getConnection,
  getIssueDetail,
  insertIssue,
  insertIssueComment,
  setIssueCommentPin,
} from "../app-db.js";

describe("Issue comment pins", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-comment-pin-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("migrates pin metadata onto an existing comments table", async () => {
    const db = await getConnection(dbPath);
    db.run(`CREATE TABLE _issue_comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      author_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT
    )`);

    const issue = await insertIssue(dbPath, "Migration", "", "bug", "owner");
    const comment = await insertIssueComment(dbPath, issue.id, "Decision", "alice");

    expect(await setIssueCommentPin(dbPath, issue.id, comment.id, "owner", true)).toBe("pinned");
    expect((await getIssueDetail(dbPath, issue.id))?.timeline).toContainEqual(expect.objectContaining({
      kind: "comment",
      comment: expect.objectContaining({ id: comment.id, pinned_at: expect.any(String), pinned_by: "owner" }),
    }));
  });

  it("pins one comment atomically and records immutable audit events", async () => {
    const issue = await insertIssue(dbPath, "Decision", "", "feature", "owner");
    const comment = await insertIssueComment(dbPath, issue.id, "Use SQLite", "alice");

    expect(await setIssueCommentPin(dbPath, issue.id, comment.id, "owner", true)).toBe("pinned");
    expect(await setIssueCommentPin(dbPath, issue.id, comment.id, "owner", true)).toBe("unchanged");
    expect(await setIssueCommentPin(dbPath, issue.id, comment.id, "owner", false)).toBe("unpinned");
    expect(await setIssueCommentPin(dbPath, issue.id, comment.id, "owner", false)).toBe("unchanged");

    const detail = await getIssueDetail(dbPath, issue.id);
    expect(detail?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "comment_pinned")).toHaveLength(1);
    expect(detail?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "comment_unpinned")).toHaveLength(1);
    expect(detail?.timeline).toContainEqual(expect.objectContaining({
      kind: "event",
      event: expect.objectContaining({ actor_id: "owner", payload_json: JSON.stringify({ commentId: comment.id }) }),
    }));
    expect(detail?.timeline).toContainEqual(expect.objectContaining({
      kind: "comment",
      comment: expect.objectContaining({ id: comment.id, pinned_at: null, pinned_by: null }),
    }));
  });

  it("rejects a second pin and comments outside the current Issue", async () => {
    const firstIssue = await insertIssue(dbPath, "First", "", "bug", "owner");
    const secondIssue = await insertIssue(dbPath, "Second", "", "bug", "owner");
    const first = await insertIssueComment(dbPath, firstIssue.id, "First answer", "alice");
    const second = await insertIssueComment(dbPath, firstIssue.id, "Second answer", "bob");
    const foreign = await insertIssueComment(dbPath, secondIssue.id, "Foreign", "carol");

    expect(await setIssueCommentPin(dbPath, firstIssue.id, first.id, "owner", true)).toBe("pinned");
    expect(await setIssueCommentPin(dbPath, firstIssue.id, second.id, "owner", true)).toBe("conflict");
    expect(await setIssueCommentPin(dbPath, firstIssue.id, foreign.id, "owner", true)).toBe("not_found");

    const comments = (await getIssueDetail(dbPath, firstIssue.id))?.timeline.filter((item) => item.kind === "comment") ?? [];
    expect(comments.filter((item) => item.kind === "comment" && item.comment.pinned_at)).toHaveLength(1);
  });

  it("clears pin metadata when the comment is soft deleted", async () => {
    const issue = await insertIssue(dbPath, "Delete", "", "bug", "owner");
    const comment = await insertIssueComment(dbPath, issue.id, "Temporary", "alice");
    await setIssueCommentPin(dbPath, issue.id, comment.id, "owner", true);

    expect(await deleteIssueComment(dbPath, comment.id, "alice")).toBe(true);
    const detail = await getIssueDetail(dbPath, issue.id);
    expect(detail?.timeline).toContainEqual(expect.objectContaining({
      kind: "comment",
      comment: expect.objectContaining({ id: comment.id, deleted_at: expect.any(String), pinned_at: null, pinned_by: null }),
    }));
    expect(detail?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "comment_pinned")).toHaveLength(1);
  });
});
