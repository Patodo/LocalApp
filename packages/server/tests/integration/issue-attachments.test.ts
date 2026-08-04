import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/s3-client.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/s3-client.js")>(),
  putObject: vi.fn(),
  getObject: vi.fn(),
  deleteObject: vi.fn(),
}));

import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { storagePlugin } from "../../src/plugins/storage.js";
import { sessionPlugin } from "../../src/plugins/session.js";
import { authRoutes } from "../../src/routes/auth.js";
import { issuesRoutes } from "../../src/routes/issues.js";
import { closeMetaDb } from "../../src/lib/meta-sqlite.js";
import { closeAllConnections, getConnection, getDbPath, getIssueAttachment, insertIssueAttachment, listExpiredUnboundIssueAttachments } from "../../src/lib/app-db.js";
import { deleteObject, getObject, putObject } from "../../src/lib/s3-client.js";
import { registerAndLogin } from "../helpers/createUser.js";

const mockGetObject = vi.mocked(getObject);
const mockPutObject = vi.mocked(putObject);
const mockDeleteObject = vi.mocked(deleteObject);
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

function getAppUrl(app: FastifyInstance): string {
  const address = app.addresses()[0];
  if (!address || typeof address === "string") throw new Error("Test server is not listening");
  return `http://127.0.0.1:${address.port}`;
}

function createPage(
  app: FastifyInstance,
  owner: string,
  name: string,
  pageAccess?: { level: "public" | "authenticated" | "owner" },
): void {
  const pageDir = path.join(app.config.dataDir, owner, name);
  fs.mkdirSync(pageDir, { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(pageDir, "meta.json"), JSON.stringify({
    name,
    userId: owner,
    description: "",
    currentVersion: 1,
    createdAt: now,
    updatedAt: now,
    versions: [],
    metadata: {},
    ...(pageAccess ? { pageAccess } : {}),
  }));
}

describe("Issue attachment API", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let ownerCookie: string;
  let outsiderCookie: string;
  const owner = "attachmentowner";
  const pageName = "attachments-app";
  const pagePath = `${owner}/${pageName}`;

  beforeAll(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-issue-attachments-"));
    process.env.DATA_DIR = dataDir;
    process.env.BOOTSTRAP_API_KEY = "test-api-key-1234567890abcdef";
    process.env.JWT_SECRET = "issue-attachment-test-jwt-secret";
    process.env.TEMPLATE_REPO_URL = "https://github.com/example/template.git";

    app = Fastify({ ignoreTrailingSlash: true });
    await app.register(storagePlugin);
    await app.register(cookie);
    await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024 } });
    await app.register(sessionPlugin);
    app.register(authRoutes);
    app.register(issuesRoutes);
    await app.listen({ port: 0, host: "127.0.0.1" });
    baseUrl = getAppUrl(app);

    ownerCookie = await registerAndLogin(baseUrl, owner);
    outsiderCookie = await registerAndLogin(baseUrl, "attachmentoutsider");
    createPage(app, owner, pageName);
    createPage(app, owner, "other-app");
    createPage(app, owner, "private-app", { level: "authenticated" });
    createPage(app, owner, "owner-app", { level: "owner" });
  });

  afterAll(async () => {
    closeAllConnections();
    closeMetaDb();
    await app.close();
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  async function uploadDraft(
    draftId: string,
    fileName: string,
    content: string | Uint8Array,
    mimeType = "application/octet-stream",
    targetPagePath = pagePath,
    requestCookie = ownerCookie,
  ): Promise<Response> {
    const form = new FormData();
    form.set("pagePath", targetPagePath);
    form.set("draftId", draftId);
    form.set("file", new Blob([content], { type: mimeType }), fileName);
    return fetch(`${baseUrl}/api/issues/attachments`, {
      method: "POST",
      headers: { Cookie: requestCookie },
      body: form,
    });
  }

  it("stores a draft PNG under a server-generated key, binds it, and reads it inline", async () => {
    const form = new FormData();
    form.set("pagePath", pagePath);
    form.set("draftId", "issue-draft");
    form.set("file", new Blob([Buffer.from("png bytes")], { type: "image/png" }), "../../screen.png");

    const uploaded = await fetch(`${baseUrl}/api/issues/attachments`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
      body: form,
    });

    expect(uploaded.status).toBe(201);
    const attachment = (await uploaded.json()).data;
    expect(attachment).toMatchObject({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      file_name: "screen.png",
      mime_type: "image/png",
      size_bytes: 9,
      url: `/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}`,
    });
    expect(attachment).not.toHaveProperty("storage_key");
    expect(mockPutObject).toHaveBeenCalledWith(
      `issues/${owner}/${pageName}/${attachment.id}/content`,
      Buffer.from("png bytes"),
      "image/png",
    );

    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        pagePath,
        title: "Screenshot attached",
        description: "See image",
        label: "bug",
        draftId: "issue-draft",
        attachmentIds: [attachment.id],
      }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json()).data;

    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`);
    const detailBody = await detail.json();
    expect(detailBody.data.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: attachment.id, issue_id: issue.id }),
    ]));
    expect(detailBody.data.attachments[0]).not.toHaveProperty("storage_key");

    mockGetObject.mockResolvedValueOnce({ body: Buffer.from("png bytes"), contentType: "image/png" });
    const read = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}`);
    expect(read.status).toBe(200);
    expect(read.headers.get("content-type")).toContain("image/png");
    expect(read.headers.get("content-disposition")).toMatch(/^inline/);
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await read.arrayBuffer())).toEqual(Buffer.from("png bytes"));

    const wrongPage = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(`${owner}/other-app`)}`);
    expect(wrongPage.status).toBe(404);
    expect(await wrongPage.json()).toMatchObject({ success: false });

    mockGetObject.mockResolvedValueOnce({ body: Buffer.from("png bytes"), contentType: "image/png" });
    const traversal = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(`not-the-owner/../${pagePath}`)}`);
    expect(traversal.status).toBe(404);
    expect(await traversal.json()).toMatchObject({ success: false });
  });

  it("deletes bound MinIO objects when the owner deletes an Issue", async () => {
    const draftId = "delete-issue-attachment";
    const uploaded = await uploadDraft(draftId, "evidence.png", "image", "image/png");
    const attachment = (await uploaded.json()).data as { id: string };
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Delete attachment owner", draftId, attachmentIds: [attachment.id] }),
    });
    const issue = (await created.json()).data as { id: number };
    mockDeleteObject.mockClear();

    const removed = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      method: "DELETE", headers: { Cookie: ownerCookie },
    });

    expect(removed.status).toBe(200);
    expect(mockDeleteObject).toHaveBeenCalledWith(`issues/${owner}/${pageName}/${attachment.id}/content`);
    expect((await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}`)).status).toBe(404);
  });

  it("releases only the current uploader's matching unbound draft object", async () => {
    const draftId = "discard-upload";
    const uploaded = await uploadDraft(draftId, "discard.png", "discard", "image/png");
    const attachment = (await uploaded.json()).data as { id: string };
    mockDeleteObject.mockClear();

    const wrongDraft = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}&draftId=wrong`, {
      method: "DELETE", headers: { Cookie: ownerCookie },
    });
    expect(wrongDraft.status).toBe(404);
    const wrongUser = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}&draftId=${draftId}`, {
      method: "DELETE", headers: { Cookie: outsiderCookie },
    });
    expect(wrongUser.status).toBe(404);
    expect(mockDeleteObject).not.toHaveBeenCalled();

    const released = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}&draftId=${draftId}`, {
      method: "DELETE", headers: { Cookie: ownerCookie },
    });
    expect(released.status).toBe(200);
    expect(mockDeleteObject).toHaveBeenCalledWith(`issues/${owner}/${pageName}/${attachment.id}/content`);
    expect(await getIssueAttachment(getDbPath(path.join(dataDir, owner, pageName)), attachment.id)).toBeNull();

    const boundDraftId = "bound-release";
    const boundUpload = await uploadDraft(boundDraftId, "bound.png", "bound", "image/png");
    const boundAttachment = (await boundUpload.json()).data as { id: string };
    await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Bound release guard", draftId: boundDraftId, attachmentIds: [boundAttachment.id] }),
    });
    mockDeleteObject.mockClear();
    const boundRelease = await fetch(`${baseUrl}/api/issues/attachments/${boundAttachment.id}?pagePath=${encodeURIComponent(pagePath)}&draftId=${boundDraftId}`, {
      method: "DELETE", headers: { Cookie: ownerCookie },
    });
    expect(boundRelease.status).toBe(404);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("restores an unbound draft when MinIO deletion fails so expiry cleanup can retry", async () => {
    const draftId = "failed-discard";
    const uploaded = await uploadDraft(draftId, "retry.png", "retry", "image/png");
    const attachment = (await uploaded.json()).data as { id: string };
    mockDeleteObject.mockRejectedValueOnce(new Error("MinIO unavailable"));

    const released = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}&draftId=${draftId}`, {
      method: "DELETE", headers: { Cookie: ownerCookie },
    });
    expect(released.status).toBe(503);
    expect(await released.json()).toMatchObject({ success: false });

    const dbPath = getDbPath(path.join(dataDir, owner, pageName));
    expect(await getIssueAttachment(dbPath, attachment.id)).toMatchObject({ id: attachment.id, draft_id: draftId, issue_id: null });
    const connection = await getConnection(dbPath);
    connection.run("UPDATE _issue_attachments SET created_at = ? WHERE id = ?", ["2026-07-01T00:00:00.000Z", attachment.id]);
    expect(await listExpiredUnboundIssueAttachments(dbPath, "2026-07-02T00:00:00.000Z")).toEqual([
      expect.objectContaining({ id: attachment.id }),
    ]);
  });

  it("forces ordinary files to download and enforces the route-specific 25 MiB limit", async () => {
    const documentForm = new FormData();
    documentForm.set("pagePath", pagePath);
    documentForm.set("draftId", "document-draft");
    documentForm.set("file", new Blob(["<script>alert(1)</script>"], { type: "text/html" }), "report.html");

    const uploaded = await fetch(`${baseUrl}/api/issues/attachments`, {
      method: "POST",
      headers: { Cookie: ownerCookie },
      body: documentForm,
    });
    expect(uploaded.status).toBe(201);
    const document = (await uploaded.json()).data;

    mockGetObject.mockResolvedValueOnce({ body: Buffer.from("<script>alert(1)</script>"), contentType: "text/html" });
    const read = await fetch(`${baseUrl}/api/issues/attachments/${document.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      headers: { Cookie: ownerCookie },
    });
    expect(read.status).toBe(200);
    expect(read.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(read.headers.get("x-content-type-options")).toBe("nosniff");

    const exactLimit = await uploadDraft("exact-limit-draft", "exact.bin", Buffer.alloc(MAX_ATTACHMENT_BYTES));
    expect(exactLimit.status).toBe(201);

    mockPutObject.mockClear();
    const oversized = await uploadDraft("oversized-draft", "large.bin", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ success: false });
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("enforces page access and keeps unbound drafts private to their uploader", async () => {
    const privatePath = `${owner}/private-app`;
    const privateUpload = await uploadDraft("private-draft", "private.txt", "private", "text/plain", privatePath);
    expect(privateUpload.status).toBe(201);
    const privateAttachment = (await privateUpload.json()).data;

    const anonymousPrivateRead = await fetch(`${baseUrl}/api/issues/attachments/${privateAttachment.id}?pagePath=${encodeURIComponent(privatePath)}`);
    expect([403, 404]).toContain(anonymousPrivateRead.status);
    expect(anonymousPrivateRead.status).not.toBe(401);
    expect(await anonymousPrivateRead.json()).toMatchObject({ success: false });

    const anonymousUploadForm = new FormData();
    anonymousUploadForm.set("pagePath", privatePath);
    anonymousUploadForm.set("draftId", "anonymous-private-draft");
    anonymousUploadForm.set("file", new Blob(["denied"], { type: "text/plain" }), "denied.txt");
    const anonymousPrivateUpload = await fetch(`${baseUrl}/api/issues/attachments`, { method: "POST", body: anonymousUploadForm });
    expect(anonymousPrivateUpload.status).toBe(401);

    const ownerPath = `${owner}/owner-app`;
    const ownerUpload = await uploadDraft("owner-draft", "owner.txt", "owner", "text/plain", ownerPath);
    expect(ownerUpload.status).toBe(201);
    const ownerAttachment = (await ownerUpload.json()).data;

    const outsiderOwnerUpload = await uploadDraft("outsider-owner-draft", "denied.txt", "denied", "text/plain", ownerPath, outsiderCookie);
    expect(outsiderOwnerUpload.status).toBe(403);
    const outsiderOwnerRead = await fetch(`${baseUrl}/api/issues/attachments/${ownerAttachment.id}?pagePath=${encodeURIComponent(ownerPath)}`, {
      headers: { Cookie: outsiderCookie },
    });
    expect(outsiderOwnerRead.status).toBe(403);

    const publicDraftUpload = await uploadDraft("uploader-only-draft", "draft.txt", "draft", "text/plain");
    const publicDraft = (await publicDraftUpload.json()).data;
    const outsiderDraftRead = await fetch(`${baseUrl}/api/issues/attachments/${publicDraft.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      headers: { Cookie: outsiderCookie },
    });
    expect(outsiderDraftRead.status).toBe(404);
    expect(await outsiderDraftRead.json()).toMatchObject({ success: false, error: "Attachment not found" });
  });

  it("rolls back Issue and comment writes when any attachment id is invalid", async () => {
    const issueDraftId = "partial-invalid-issue-draft";
    const issueUpload = await uploadDraft(issueDraftId, "issue.txt", "issue attachment", "text/plain");
    const issueAttachment = (await issueUpload.json()).data;
    const invalidIssue = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        pagePath,
        title: "Must roll back",
        draftId: issueDraftId,
        attachmentIds: [issueAttachment.id, "missing-attachment"],
      }),
    });
    expect(invalidIssue.status).toBe(400);

    const listed = await fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(pagePath)}`);
    const listedBody = await listed.json();
    expect(listedBody.data).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Must roll back" }),
    ]));

    const retriedIssue = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Valid retry", draftId: issueDraftId, attachmentIds: [issueAttachment.id] }),
    });
    expect(retriedIssue.status).toBe(200);
    const retriedIssueRecord = (await retriedIssue.json()).data;
    const retriedDetail = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}?pagePath=${encodeURIComponent(pagePath)}`);
    expect((await retriedDetail.json()).data.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: issueAttachment.id, issue_id: retriedIssueRecord.id }),
    ]));

    const commentDraftId = "partial-invalid-comment-draft";
    const commentUpload = await uploadDraft(commentDraftId, "comment.txt", "comment attachment", "text/plain");
    const commentAttachment = (await commentUpload.json()).data;
    const invalidComment = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        pagePath,
        body: "Must also roll back",
        draftId: commentDraftId,
        attachmentIds: [commentAttachment.id, "missing-comment-attachment"],
      }),
    });
    expect(invalidComment.status).toBe(400);

    const detailAfterInvalidComment = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}?pagePath=${encodeURIComponent(pagePath)}`);
    const detailAfterInvalidCommentBody = (await detailAfterInvalidComment.json()).data;
    expect(detailAfterInvalidCommentBody.timeline).not.toEqual(expect.arrayContaining([
      { kind: "comment", comment: expect.objectContaining({ body: "Must also roll back" }) },
    ]));
    expect(detailAfterInvalidCommentBody.attachments).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: commentAttachment.id }),
    ]));

    const retriedComment = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "", draftId: commentDraftId, attachmentIds: [commentAttachment.id] }),
    });
    expect(retriedComment.status).toBe(201);
    const retriedCommentDetail = (await retriedComment.json()).data;
    expect(retriedCommentDetail.timeline).toEqual(expect.arrayContaining([
      { kind: "comment", comment: expect.objectContaining({ body: "" }) },
    ]));
    expect(retriedCommentDetail.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: commentAttachment.id, comment_id: expect.any(Number) }),
    ]));
    const attachmentOnlyComment = retriedCommentDetail.timeline.find((item: { kind: string; comment?: { body: string } }) => item.kind === "comment" && item.comment?.body === "").comment;
    const attachmentOnlyEdit = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}/comments/${attachmentOnlyComment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "", expectedUpdatedAt: attachmentOnlyComment.updated_at, draftId: "attachment-only-edit", attachmentIds: [] }),
    });
    expect(attachmentOnlyEdit.status).toBe(200);
    for (const removedAttachmentIds of [["missing-bound-attachment"], [commentAttachment.id, commentAttachment.id]]) {
      const invalidRemoval = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}/comments/${attachmentOnlyComment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: ownerCookie },
        body: JSON.stringify({ pagePath, body: "Must not partially remove", expectedUpdatedAt: attachmentOnlyComment.updated_at, draftId: "attachment-only-edit", attachmentIds: [], removedAttachmentIds }),
      });
      expect(invalidRemoval.status).toBe(400);
    }
    const removeBoundAttachment = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}/comments/${attachmentOnlyComment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Removed obsolete attachment", expectedUpdatedAt: attachmentOnlyComment.updated_at, draftId: "attachment-only-edit", attachmentIds: [], removedAttachmentIds: [commentAttachment.id] }),
    });
    expect(removeBoundAttachment.status).toBe(200);
    expect((await removeBoundAttachment.json()).data.attachments).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: commentAttachment.id })]));
    const removedRead = await fetch(`${baseUrl}/api/issues/attachments/${commentAttachment.id}?pagePath=${encodeURIComponent(pagePath)}`);
    expect(removedRead.status).toBe(404);

    const currentIssueDetail = (await (await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}?pagePath=${encodeURIComponent(pagePath)}`)).json()).data;
    const removeIssueAttachment = await fetch(`${baseUrl}/api/issues/${retriedIssueRecord.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, description: "Removed obsolete Issue attachment", expectedUpdatedAt: currentIssueDetail.issue.updated_at, draftId: "issue-attachment-edit", attachmentIds: [], removedAttachmentIds: [issueAttachment.id] }),
    });
    expect(removeIssueAttachment.status).toBe(200);
    const removedIssueAttachmentRead = await fetch(`${baseUrl}/api/issues/attachments/${issueAttachment.id}?pagePath=${encodeURIComponent(pagePath)}`);
    expect(removedIssueAttachmentRead.status).toBe(404);
  });

  it("atomically binds edit attachments and leaves conflict uploads unbound", async () => {
    const createdResponse = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Editable attachments", description: "Before" }),
    });
    const issue = (await createdResponse.json()).data;

    const issueDraftId = "edit-existing-issue";
    const issueUpload = await uploadDraft(issueDraftId, "edit.png", "edited image", "image/png");
    const issueAttachment = (await issueUpload.json()).data;
    const editedIssue = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, description: "After", expectedUpdatedAt: issue.updated_at, draftId: issueDraftId, attachmentIds: [issueAttachment.id] }),
    });
    expect(editedIssue.status).toBe(200);
    const issueAfterEdit = (await editedIssue.json()).data;
    expect((await getIssueAttachment(getDbPath(path.join(dataDir, owner, pageName)), issueAttachment.id))?.issue_id).toBe(issue.id);

    const invalidDraftId = "invalid-edit-existing-issue";
    const invalidUpload = await uploadDraft(invalidDraftId, "rollback.txt", "rollback", "text/plain");
    const invalidAttachment = (await invalidUpload.json()).data;
    const invalidEdit = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, description: "Must roll back", expectedUpdatedAt: issueAfterEdit.updated_at, draftId: invalidDraftId, attachmentIds: [invalidAttachment.id, "missing-edit-attachment"] }),
    });
    expect(invalidEdit.status).toBe(400);
    const detailAfterRollback = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`);
    expect((await detailAfterRollback.json()).data.issue.description).toBe("After");
    expect((await getIssueAttachment(getDbPath(path.join(dataDir, owner, pageName)), invalidAttachment.id))?.issue_id).toBeNull();

    const commentResponse = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Comment before", draftId: "comment-before", attachmentIds: [] }),
    });
    const commentDetail = (await commentResponse.json()).data;
    const comment = commentDetail.timeline.find((item: { kind: string }) => item.kind === "comment").comment;
    const commentDraftId = "edit-existing-comment";
    const commentUpload = await uploadDraft(commentDraftId, "comment.png", "comment image", "image/png");
    const commentAttachment = (await commentUpload.json()).data;
    const editedComment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Comment after", expectedUpdatedAt: comment.updated_at, draftId: commentDraftId, attachmentIds: [commentAttachment.id] }),
    });
    expect(editedComment.status).toBe(200);
    expect((await getIssueAttachment(getDbPath(path.join(dataDir, owner, pageName)), commentAttachment.id))?.comment_id).toBe(comment.id);

    const conflictDraftId = "conflict-edit-comment";
    const conflictUpload = await uploadDraft(conflictDraftId, "conflict.txt", "conflict", "text/plain");
    const conflictAttachment = (await conflictUpload.json()).data;
    const conflict = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Stale edit", expectedUpdatedAt: comment.updated_at, draftId: conflictDraftId, attachmentIds: [conflictAttachment.id] }),
    });
    expect(conflict.status).toBe(409);
    expect((await getIssueAttachment(getDbPath(path.join(dataDir, owner, pageName)), conflictAttachment.id))?.issue_id).toBeNull();
  });

  it("encodes hostile filenames in Content-Disposition", async () => {
    const uploaded = await uploadDraft("hostile-name-draft", "report\"; foo=bar (final).html", "<script>bad()</script>", "text/html");
    expect(uploaded.status).toBe(201);
    const attachment = (await uploaded.json()).data;
    expect(attachment.file_name).not.toContain("\"");

    mockGetObject.mockResolvedValueOnce({ body: Buffer.from("<script>bad()</script>"), contentType: "text/html" });
    const read = await fetch(`${baseUrl}/api/issues/attachments/${attachment.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      headers: { Cookie: ownerCookie },
    });
    expect(read.status).toBe(200);
    const disposition = read.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment; filename\*=UTF-8''/);
    expect(disposition).not.toContain("foo=bar");
    expect(disposition).not.toContain("\"");
    expect(disposition).not.toMatch(/[\r\n]/);
    expect(disposition).toContain("%3B%20foo%3Dbar%20%28final%29.html");
  });

  it("removes unbound attachment drafts older than 24 hours on the next upload", async () => {
    const dbPath = getDbPath(path.join(dataDir, owner, pageName));
    await insertIssueAttachment(dbPath, {
      id: "expired-hosted-draft",
      pagePath,
      draftId: "expired-draft",
      uploaderId: owner,
      storageKey: `issues/${owner}/${pageName}/expired-hosted-draft/content`,
      fileName: "expired.txt",
      mimeType: "text/plain",
      sizeBytes: 7,
    });
    const db = await getConnection(dbPath);
    db.run("UPDATE _issue_attachments SET created_at = ? WHERE id = ?", ["2026-07-01T00:00:00.000Z", "expired-hosted-draft"]);
    mockDeleteObject.mockClear();

    const uploaded = await uploadDraft("cleanup-trigger", "fresh.txt", "fresh", "text/plain");

    expect(uploaded.status).toBe(201);
    expect(mockDeleteObject).toHaveBeenCalledWith(`issues/${owner}/${pageName}/expired-hosted-draft/content`);
    expect(await getIssueAttachment(dbPath, "expired-hosted-draft")).toBeNull();
  });

  it("rejects a 21st draft attachment and compensates the MinIO object", async () => {
    const dbPath = getDbPath(path.join(dataDir, owner, pageName));
    for (let index = 0; index < 20; index += 1) {
      await insertIssueAttachment(dbPath, {
        id: `hosted-limit-${index}`, pagePath, draftId: "hosted-limit", uploaderId: owner,
        storageKey: `issues/${owner}/${pageName}/hosted-limit-${index}/content`,
        fileName: `${index}.txt`, mimeType: "text/plain", sizeBytes: 1,
      });
    }
    mockPutObject.mockClear();
    mockDeleteObject.mockClear();

    const response = await uploadDraft("hosted-limit", "overflow.txt", "x", "text/plain");
    const responseBody = await response.json();

    expect({ status: response.status, body: responseBody }).toMatchObject({
      status: 409,
      body: {
        success: false,
        code: "attachment_limit_exceeded",
        error: "每个草稿最多添加 20 个附件",
      },
    });
    expect(mockPutObject).toHaveBeenCalledOnce();
    expect(mockDeleteObject).toHaveBeenCalledWith(mockPutObject.mock.calls[0][0]);
  });
});
