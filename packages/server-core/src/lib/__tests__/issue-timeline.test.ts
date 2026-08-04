import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  IssueAttachmentDraftLimitError,
  bindIssueAttachments,
  closeAllConnections,
  deleteIssueComment,
  getIssueAttachment,
  getConnection,
  getIssueDetail,
  insertIssue,
  insertIssueAttachment,
  insertIssueComment,
  insertIssueEvent,
  listExpiredUnboundIssueAttachments,
  deleteIssueAttachmentMetadata,
  releaseUnboundIssueAttachment,
  restoreReleasedIssueAttachment,
  runDbTransaction,
  setIssueLock,
  updateIssue,
  updateIssueComment,
} from "../app-db.js";

describe("Issue timeline storage", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-timeline-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns comments and events in a stable chronological timeline", async () => {
    const created = await insertIssue(dbPath, "Upload fails", "Initial body", "bug", "alice");
    const comment = await insertIssueComment(dbPath, created.id, "I can reproduce this.", "bob");
    const event = await insertIssueEvent(dbPath, created.id, "alice", "closed", { from: "open", to: "closed" });

    const detail = await getIssueDetail(dbPath, created.id);

    expect(detail?.issue.title).toBe("Upload fails");
    expect(detail?.timeline).toEqual([
      expect.objectContaining({ kind: "comment", comment: expect.objectContaining({ id: comment.id }) }),
      expect.objectContaining({ kind: "event", event: expect.objectContaining({ id: event.id, event_type: "closed" }) }),
    ]);
  });

  it("updates Issue content and only lets a comment author edit or delete it", async () => {
    const created = await insertIssue(dbPath, "Old title", "Old body", "feature", "alice");
    await updateIssue(dbPath, created.id, { title: "New title", description: "New body" });
    const comment = await insertIssueComment(dbPath, created.id, "First draft", "bob");

    expect(await updateIssueComment(dbPath, comment.id, "Mallory edit", "mallory")).toBeNull();
    expect(await deleteIssueComment(dbPath, comment.id, "mallory")).toBe(false);

    const edited = await updateIssueComment(dbPath, comment.id, "Edited by Bob", "bob");
    expect(edited?.body).toBe("Edited by Bob");
    expect(await deleteIssueComment(dbPath, comment.id, "bob")).toBe(true);

    const detail = await getIssueDetail(dbPath, created.id);
    expect(detail?.issue).toMatchObject({ title: "New title", description: "New body" });
    expect(detail?.timeline[0]).toMatchObject({
      kind: "comment",
      comment: { body: "", deleted_at: expect.any(String) },
    });
  });

  it("stores closed reasons and clears them when reopening", async () => {
    const created = await insertIssue(dbPath, "Decision", "", "feature", "alice");
    await updateIssue(dbPath, created.id, { status: "closed", stateReason: "not_planned" });
    expect((await getIssueDetail(dbPath, created.id))?.issue).toMatchObject({ status: "closed", state_reason: "not_planned" });

    await updateIssue(dbPath, created.id, { status: "open", stateReason: null });
    expect((await getIssueDetail(dbPath, created.id))?.issue).toMatchObject({ status: "open", state_reason: null });
  });

  it("migrates and persists conversation lock metadata independently of status", async () => {
    const db = await getConnection(dbPath);
    db.run(`CREATE TABLE _issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      issue_number INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      label TEXT NOT NULL DEFAULT 'bug',
      reporter_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    const created = await insertIssue(dbPath, "Lock migration", "", "bug", "alice");

    expect((await getIssueDetail(dbPath, created.id))?.issue).toMatchObject({ locked_at: null, locked_by: null });
    expect(await setIssueLock(dbPath, created.id, "alice", "resolved")).toBe(true);
    expect((await getIssueDetail(dbPath, created.id))?.issue).toMatchObject({
      status: "open",
      locked_at: expect.any(String),
      locked_by: "alice",
      lock_reason: "resolved",
    });

    expect(await setIssueLock(dbPath, created.id, null)).toBe(true);
    expect((await getIssueDetail(dbPath, created.id))?.issue).toMatchObject({ locked_at: null, locked_by: null, lock_reason: null });
  });

  it("binds draft attachments only for the matching uploader and draft", async () => {
    const created = await insertIssue(dbPath, "Attachment", "", "bug", "alice");
    await insertIssueAttachment(dbPath, {
      id: "attachment-1",
      pagePath: "owner/app",
      draftId: "draft-alice",
      uploaderId: "alice",
      storageKey: "issues/attachment-1/content",
      fileName: "screen.png",
      mimeType: "image/png",
      sizeBytes: 12,
    });

    expect(await bindIssueAttachments(dbPath, {
      attachmentIds: ["attachment-1", "missing-attachment"],
      draftId: "draft-alice",
      uploaderId: "alice",
      issueId: created.id,
      pagePath: "owner/app",
    })).toEqual([]);
    expect(await getIssueAttachment(dbPath, "attachment-1")).toMatchObject({ issue_id: null });

    expect(await bindIssueAttachments(dbPath, {
      attachmentIds: ["attachment-1"],
      draftId: "draft-alice",
      uploaderId: "mallory",
      issueId: created.id,
      pagePath: "owner/app",
    })).toEqual([]);

    const bound = await bindIssueAttachments(dbPath, {
      attachmentIds: ["attachment-1"],
      draftId: "draft-alice",
      uploaderId: "alice",
      issueId: created.id,
      pagePath: "owner/app",
    });

    expect(bound).toHaveLength(1);
    expect(await getIssueAttachment(dbPath, "attachment-1")).toMatchObject({
      issue_id: created.id,
      uploader_id: "alice",
      file_name: "screen.png",
    });
  });

  it("does not persist Issue timeline writes from a rolled back transaction", async () => {
    const created = await insertIssue(dbPath, "Atomic comment", "", "bug", "alice");

    await expect(runDbTransaction(dbPath, async () => {
      await insertIssueComment(dbPath, created.id, "must roll back", "alice");
      await insertIssueEvent(dbPath, created.id, "alice", "closed", { to: "closed" });
      throw new Error("status update failed");
    })).rejects.toThrow("status update failed");

    closeAllConnections();
    const detail = await getIssueDetail(dbPath, created.id);
    expect(detail?.timeline).toEqual([]);
  });

  it("lists only expired unbound attachment drafts and soft-deletes their metadata", async () => {
    await insertIssueAttachment(dbPath, {
      id: "expired-draft", pagePath: "owner/app", draftId: "draft-old", uploaderId: "alice",
      storageKey: "issues/expired/content", fileName: "old.txt", mimeType: "text/plain", sizeBytes: 3,
    });
    await insertIssueAttachment(dbPath, {
      id: "fresh-draft", pagePath: "owner/app", draftId: "draft-new", uploaderId: "alice",
      storageKey: "issues/fresh/content", fileName: "new.txt", mimeType: "text/plain", sizeBytes: 3,
    });
    const connection = await getConnection(dbPath);
    connection.run("UPDATE _issue_attachments SET created_at = ? WHERE id = ?", ["2026-07-01T00:00:00.000Z", "expired-draft"]);

    expect(await listExpiredUnboundIssueAttachments(dbPath, "2026-07-02T00:00:00.000Z")).toEqual([
      expect.objectContaining({ id: "expired-draft", storage_key: "issues/expired/content" }),
    ]);
    expect(await deleteIssueAttachmentMetadata(dbPath, "expired-draft")).toBe(true);
    expect(await getIssueAttachment(dbPath, "expired-draft")).toBeNull();
    expect(await getIssueAttachment(dbPath, "fresh-draft")).not.toBeNull();
  });

  it("releases only an unbound attachment owned by the matching app draft uploader", async () => {
    await insertIssueAttachment(dbPath, {
      id: "discard-me", pagePath: "owner/app", draftId: "draft-alice", uploaderId: "alice",
      storageKey: "issues/discard/content", fileName: "discard.png", mimeType: "image/png", sizeBytes: 4,
    });

    expect(await releaseUnboundIssueAttachment(dbPath, { attachmentId: "discard-me", pagePath: "owner/app", draftId: "wrong", uploaderId: "alice" })).toBeNull();
    expect(await releaseUnboundIssueAttachment(dbPath, { attachmentId: "discard-me", pagePath: "owner/app", draftId: "draft-alice", uploaderId: "mallory" })).toBeNull();
    expect(await getIssueAttachment(dbPath, "discard-me")).not.toBeNull();

    expect(await releaseUnboundIssueAttachment(dbPath, { attachmentId: "discard-me", pagePath: "owner/app", draftId: "draft-alice", uploaderId: "alice" })).toMatchObject({
      id: "discard-me",
      storage_key: "issues/discard/content",
    });
    expect(await getIssueAttachment(dbPath, "discard-me")).toBeNull();

    const issue = await insertIssue(dbPath, "Bound attachment", "", "bug", "alice");
    await insertIssueAttachment(dbPath, {
      id: "bound", pagePath: "owner/app", draftId: "draft-bound", uploaderId: "alice",
      storageKey: "issues/bound/content", fileName: "bound.png", mimeType: "image/png", sizeBytes: 4,
    });
    await bindIssueAttachments(dbPath, { attachmentIds: ["bound"], draftId: "draft-bound", uploaderId: "alice", pagePath: "owner/app", issueId: issue.id });
    expect(await releaseUnboundIssueAttachment(dbPath, { attachmentId: "bound", pagePath: "owner/app", draftId: "draft-bound", uploaderId: "alice" })).toBeNull();
    expect(await getIssueAttachment(dbPath, "bound")).not.toBeNull();
  });

  it("atomically limits each app draft uploader to 20 unbound attachments and restores capacity", async () => {
    for (let index = 0; index < 20; index += 1) {
      await insertIssueAttachment(dbPath, {
        id: `limited-${index}`, pagePath: "owner/app", draftId: "draft-limited", uploaderId: "alice",
        storageKey: `issues/limited-${index}/content`, fileName: `${index}.txt`, mimeType: "text/plain", sizeBytes: 1,
      });
    }

    await expect(insertIssueAttachment(dbPath, {
      id: "limited-overflow", pagePath: "owner/app", draftId: "draft-limited", uploaderId: "alice",
      storageKey: "issues/limited-overflow/content", fileName: "overflow.txt", mimeType: "text/plain", sizeBytes: 1,
    })).rejects.toBeInstanceOf(IssueAttachmentDraftLimitError);

    await expect(insertIssueAttachment(dbPath, {
      id: "other-uploader", pagePath: "owner/app", draftId: "draft-limited", uploaderId: "bob",
      storageKey: "issues/other-uploader/content", fileName: "bob.txt", mimeType: "text/plain", sizeBytes: 1,
    })).resolves.toMatchObject({ id: "other-uploader" });

    await releaseUnboundIssueAttachment(dbPath, {
      attachmentId: "limited-0", pagePath: "owner/app", draftId: "draft-limited", uploaderId: "alice",
    });
    await expect(insertIssueAttachment(dbPath, {
      id: "limited-replacement", pagePath: "owner/app", draftId: "draft-limited", uploaderId: "alice",
      storageKey: "issues/limited-replacement/content", fileName: "replacement.txt", mimeType: "text/plain", sizeBytes: 1,
    })).resolves.toMatchObject({ id: "limited-replacement" });
  });

  it("restores only the exact failed release marker without reviving bound attachments", async () => {
    await insertIssueAttachment(dbPath, {
      id: "retry-release", pagePath: "owner/app", draftId: "draft-retry", uploaderId: "alice",
      storageKey: "issues/retry/content", fileName: "retry.png", mimeType: "image/png", sizeBytes: 4,
    });
    const released = await releaseUnboundIssueAttachment(dbPath, { attachmentId: "retry-release", pagePath: "owner/app", draftId: "draft-retry", uploaderId: "alice" });
    expect(released?.deleted_at).toEqual(expect.any(String));

    expect(await restoreReleasedIssueAttachment(dbPath, { attachmentId: "retry-release", pagePath: "owner/app", draftId: "draft-retry", uploaderId: "alice", releaseDeletedAt: "wrong-marker" })).toBe(false);
    expect(await restoreReleasedIssueAttachment(dbPath, { attachmentId: "retry-release", pagePath: "owner/app", draftId: "draft-retry", uploaderId: "mallory", releaseDeletedAt: released!.deleted_at! })).toBe(false);
    expect(await getIssueAttachment(dbPath, "retry-release")).toBeNull();

    expect(await restoreReleasedIssueAttachment(dbPath, { attachmentId: "retry-release", pagePath: "owner/app", draftId: "draft-retry", uploaderId: "alice", releaseDeletedAt: released!.deleted_at! })).toBe(true);
    expect(await getIssueAttachment(dbPath, "retry-release")).not.toBeNull();

    const issue = await insertIssue(dbPath, "Bound after retry", "", "bug", "alice");
    await bindIssueAttachments(dbPath, { attachmentIds: ["retry-release"], draftId: "draft-retry", uploaderId: "alice", pagePath: "owner/app", issueId: issue.id });
    expect(await restoreReleasedIssueAttachment(dbPath, { attachmentId: "retry-release", pagePath: "owner/app", draftId: "draft-retry", uploaderId: "alice", releaseDeletedAt: released!.deleted_at! })).toBe(false);
    expect(await getIssueAttachment(dbPath, "retry-release")).toMatchObject({ issue_id: issue.id });
  });

  it("returns a 200-entry timeline in stable chronological order", async () => {
    const issue = await insertIssue(dbPath, "Long discussion", "", "bug", "alice");
    const db = await getConnection(dbPath);
    for (let index = 0; index < 200; index += 1) {
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString();
      db.run(
        "INSERT INTO _issue_events (issue_id, actor_id, event_type, payload_json, created_at) VALUES (?, 'load-user', 'edited', '{}', ?)",
        [issue.id, createdAt],
      );
    }

    const detail = await getIssueDetail(dbPath, issue.id);
    expect(detail?.timeline).toHaveLength(200);
    expect(detail?.timeline[0]).toMatchObject({ kind: "event", event: { created_at: "2026-01-01T00:00:00.000Z" } });
    expect(detail?.timeline.at(-1)).toMatchObject({ kind: "event", event: { created_at: "2026-01-01T00:03:19.000Z" } });
  });
});
