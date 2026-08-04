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
  setIssueCommentMinimized,
  setIssueCommentPin,
} from "../app-db.js";

describe("Issue comment minimization", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-comment-minimize-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("migrates minimization metadata onto an existing comments table", async () => {
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
    const comment = await insertIssueComment(dbPath, issue.id, "Old comment", "alice");

    expect(await setIssueCommentMinimized(dbPath, issue.id, comment.id, "owner", "off-topic")).toBe("minimized");
    expect((await getIssueDetail(dbPath, issue.id))?.timeline).toContainEqual(expect.objectContaining({
      kind: "comment",
      comment: expect.objectContaining({ id: comment.id, minimized_at: expect.any(String), minimized_by: "owner", minimized_reason: "off-topic" }),
    }));
  });

  it.each(["abuse", "off-topic", "outdated", "resolved", "duplicate", "spam"] as const)("stores and restores the %s reason with audit history", async (reason) => {
    const issue = await insertIssue(dbPath, `Reason ${reason}`, "", "bug", "owner");
    const comment = await insertIssueComment(dbPath, issue.id, "Keep the body", "alice");

    expect(await setIssueCommentMinimized(dbPath, issue.id, comment.id, "owner", reason)).toBe("minimized");
    expect(await setIssueCommentMinimized(dbPath, issue.id, comment.id, "owner", reason)).toBe("unchanged");
    expect(await setIssueCommentMinimized(dbPath, issue.id, comment.id, "owner", null)).toBe("unminimized");
    expect(await setIssueCommentMinimized(dbPath, issue.id, comment.id, "owner", null)).toBe("unchanged");

    const detail = await getIssueDetail(dbPath, issue.id);
    expect(detail?.timeline).toContainEqual(expect.objectContaining({ kind: "comment", comment: expect.objectContaining({ body: "Keep the body", minimized_at: null, minimized_by: null, minimized_reason: null }) }));
    expect(detail?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "comment_minimized")).toHaveLength(1);
    expect(detail?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "comment_unminimized")).toHaveLength(1);
    expect(detail?.timeline).toContainEqual(expect.objectContaining({ kind: "event", event: expect.objectContaining({ payload_json: JSON.stringify({ commentId: comment.id, reason }) }) }));
  });

  it("rejects invalid targets and a pinned comment without partial writes", async () => {
    const firstIssue = await insertIssue(dbPath, "First", "", "bug", "owner");
    const secondIssue = await insertIssue(dbPath, "Second", "", "bug", "owner");
    const comment = await insertIssueComment(dbPath, firstIssue.id, "Important", "alice");
    await setIssueCommentPin(dbPath, firstIssue.id, comment.id, "owner", true);

    expect(await setIssueCommentMinimized(dbPath, firstIssue.id, comment.id, "owner", "spam")).toBe("pinned_conflict");
    expect(await setIssueCommentMinimized(dbPath, secondIssue.id, comment.id, "owner", "spam")).toBe("not_found");
    expect(await setIssueCommentMinimized(dbPath, firstIssue.id, comment.id, "owner", "invalid" as never)).toBe("invalid_reason");
    expect((await getIssueDetail(dbPath, firstIssue.id))?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "comment_minimized")).toHaveLength(0);
  });

  it("clears current minimization metadata when the author deletes the comment", async () => {
    const issue = await insertIssue(dbPath, "Delete", "", "bug", "owner");
    const comment = await insertIssueComment(dbPath, issue.id, "Remove later", "alice");
    await setIssueCommentMinimized(dbPath, issue.id, comment.id, "owner", "outdated");

    expect(await deleteIssueComment(dbPath, comment.id, "alice")).toBe(true);
    expect((await getIssueDetail(dbPath, issue.id))?.timeline).toContainEqual(expect.objectContaining({
      kind: "comment",
      comment: expect.objectContaining({ id: comment.id, deleted_at: expect.any(String), minimized_at: null, minimized_by: null, minimized_reason: null }),
    }));
  });
});
