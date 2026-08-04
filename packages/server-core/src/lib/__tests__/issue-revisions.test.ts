import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeAllConnections,
  getConnection,
  getIssueDetail,
  insertIssue,
  insertIssueComment,
  insertIssueRevision,
  listIssueRevisions,
  runDbTransaction,
  updateIssue,
  updateIssueComment,
} from "../app-db.js";

describe("Issue revision storage", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-revisions-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stores scoped Issue and comment snapshots and exposes revision counts", async () => {
    const issue = await insertIssue(dbPath, "Old title", "Old body", "bug", "alice");
    const comment = await insertIssueComment(dbPath, issue.id, "Old comment", "bob");

    await insertIssueRevision(dbPath, {
      issueId: issue.id,
      targetType: "issue",
      targetId: issue.id,
      editorId: "alice",
      title: "Old title",
      body: "Old body",
      fields: ["title", "description"],
    });
    await updateIssue(dbPath, issue.id, { title: "New title", description: "New body" });
    await insertIssueRevision(dbPath, {
      issueId: issue.id,
      targetType: "comment",
      targetId: comment.id,
      editorId: "bob",
      body: comment.body,
      fields: ["body"],
    });
    await updateIssueComment(dbPath, comment.id, "New comment", "bob");

    expect(await listIssueRevisions(dbPath, issue.id, "issue", issue.id)).toEqual([
      expect.objectContaining({ target_type: "issue", target_id: issue.id, title: "Old title", body: "Old body", editor_id: "alice", fields_json: '["title","description"]' }),
    ]);
    expect(await listIssueRevisions(dbPath, issue.id, "comment", comment.id)).toEqual([
      expect.objectContaining({ target_type: "comment", target_id: comment.id, title: null, body: "Old comment", editor_id: "bob" }),
    ]);
    expect(await listIssueRevisions(dbPath, issue.id + 1, "comment", comment.id)).toEqual([]);

    const detail = await getIssueDetail(dbPath, issue.id);
    expect(detail?.issue.revision_count).toBe(1);
    expect(detail?.timeline.find((item) => item.kind === "comment")).toMatchObject({ comment: { revision_count: 1 } });
  });

  it("rejects mutation and deletion of revision rows at the database layer", async () => {
    const issue = await insertIssue(dbPath, "Title", "Body", "bug", "alice");
    const revision = await insertIssueRevision(dbPath, {
      issueId: issue.id,
      targetType: "issue",
      targetId: issue.id,
      editorId: "alice",
      title: "Title",
      body: "Body",
      fields: ["description"],
    });
    const db = await getConnection(dbPath);

    expect(() => db.run("UPDATE _issue_revisions SET body = 'tampered' WHERE id = ?", [revision.id])).toThrow(/immutable/i);
    expect(() => db.run("DELETE FROM _issue_revisions WHERE id = ?", [revision.id])).toThrow(/immutable/i);
    expect(await listIssueRevisions(dbPath, issue.id, "issue", issue.id)).toHaveLength(1);
  });

  it("rolls back a revision together with a failed content update", async () => {
    const issue = await insertIssue(dbPath, "Title", "Before", "bug", "alice");

    await expect(runDbTransaction(dbPath, async () => {
      await insertIssueRevision(dbPath, {
        issueId: issue.id,
        targetType: "issue",
        targetId: issue.id,
        editorId: "alice",
        title: "Title",
        body: "Before",
        fields: ["description"],
      });
      await updateIssue(dbPath, issue.id, { description: "After" });
      throw new Error("event write failed");
    })).rejects.toThrow("event write failed");

    closeAllConnections();
    expect(await listIssueRevisions(dbPath, issue.id, "issue", issue.id)).toEqual([]);
    expect((await getIssueDetail(dbPath, issue.id))?.issue.description).toBe("Before");
  });
});
