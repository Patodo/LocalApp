import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  closeAllConnections,
  deleteIssueComment,
  ensureIssueTables,
  getConnection,
  getIssueDetail,
  insertIssue,
  insertIssueComment,
  isIssueReactionContent,
  setIssueReaction,
} from "../app-db.js";

describe("Issue reactions storage", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-reactions-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the reaction table and accepts only GitHub reaction types", async () => {
    await ensureIssueTables(dbPath);
    const db = await getConnection(dbPath);
    const tables = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_issue_reactions'")[0]?.values.flat() ?? [];

    expect(tables).toContain("_issue_reactions");
    for (const content of ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"]) {
      expect(isIssueReactionContent(content)).toBe(true);
    }
    expect(isIssueReactionContent("fire")).toBe(false);
  });

  it("stores body and comment reactions idempotently and removes only the current user", async () => {
    const issue = await insertIssue(dbPath, "Reaction support", "Body", "feature", "alice");
    const comment = await insertIssueComment(dbPath, issue.id, "Looks good", "bob");

    expect(await setIssueReaction(dbPath, { issueId: issue.id, userId: "alice", content: "+1", reacted: true })).toBe("changed");
    expect(await setIssueReaction(dbPath, { issueId: issue.id, userId: "alice", content: "+1", reacted: true })).toBe("unchanged");
    await setIssueReaction(dbPath, { issueId: issue.id, userId: "bob", content: "+1", reacted: true });
    await setIssueReaction(dbPath, { issueId: issue.id, commentId: comment.id, userId: "alice", content: "heart", reacted: true });

    expect((await getIssueDetail(dbPath, issue.id))?.reactions).toEqual([
      expect.objectContaining({ comment_id: 0, user_id: "alice", content: "+1" }),
      expect.objectContaining({ comment_id: 0, user_id: "bob", content: "+1" }),
      expect.objectContaining({ comment_id: comment.id, user_id: "alice", content: "heart" }),
    ]);

    expect(await setIssueReaction(dbPath, { issueId: issue.id, userId: "alice", content: "+1", reacted: false })).toBe("changed");
    expect(await setIssueReaction(dbPath, { issueId: issue.id, userId: "alice", content: "+1", reacted: false })).toBe("unchanged");
    expect((await getIssueDetail(dbPath, issue.id))?.reactions).toEqual([
      expect.objectContaining({ comment_id: 0, user_id: "bob", content: "+1" }),
      expect.objectContaining({ comment_id: comment.id, user_id: "alice", content: "heart" }),
    ]);
  });

  it("rejects cross-Issue and deleted comment targets without changing activity", async () => {
    const issue = await insertIssue(dbPath, "First", "", "bug", "alice");
    const other = await insertIssue(dbPath, "Second", "", "bug", "bob");
    const otherComment = await insertIssueComment(dbPath, other.id, "Other", "bob");
    const deleted = await insertIssueComment(dbPath, issue.id, "Delete me", "alice");
    await deleteIssueComment(dbPath, deleted.id, "alice");
    const before = await getIssueDetail(dbPath, issue.id);

    expect(await setIssueReaction(dbPath, { issueId: issue.id, commentId: otherComment.id, userId: "alice", content: "eyes", reacted: true })).toBe("target_not_found");
    expect(await setIssueReaction(dbPath, { issueId: issue.id, commentId: deleted.id, userId: "alice", content: "eyes", reacted: true })).toBe("target_not_found");
    expect(await setIssueReaction(dbPath, { issueId: 9999, userId: "alice", content: "eyes", reacted: true })).toBe("target_not_found");

    const after = await getIssueDetail(dbPath, issue.id);
    expect(after?.issue.updated_at).toBe(before?.issue.updated_at);
    expect(after?.timeline).toEqual(before?.timeline);
    expect(after?.reactions).toEqual([]);
  });
});
