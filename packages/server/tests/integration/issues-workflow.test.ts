import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
import { closeAllConnections } from "../../src/lib/app-db.js";
import { registerAndLogin } from "../helpers/createUser.js";
import { listInbox } from "../../src/lib/notifications-db.js";

async function readIssueChanged(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let buffer = "";
  const deadline = Date.now() + 1_500;
  while (Date.now() < deadline) {
    const { value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const match = buffer.match(/event: issue:changed\ndata: (.+)\n\n/);
    if (match) return JSON.parse(match[1]);
  }
  throw new Error(`No Issue changed event received. Buffer: ${buffer}`);
}

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

describe("Issue workflow API", () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let dataDir: string;
  let ownerCookie: string;
  let commenterCookie: string;
  let subscriberCookie: string;
  let mentionedCookie: string;
  const owner = "issueowner";
  const pageName = "issue-app";
  const pagePath = `${owner}/${pageName}`;

  beforeAll(async () => {
    dataDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "localapp-issues-"));
    process.env.DATA_DIR = dataDir;
    process.env.BOOTSTRAP_API_KEY = "test-api-key-1234567890abcdef";
    process.env.JWT_SECRET = "issue-test-jwt-secret";
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
    commenterCookie = await registerAndLogin(baseUrl, "commenter");
    subscriberCookie = await registerAndLogin(baseUrl, "subscriber");
    mentionedCookie = await registerAndLogin(baseUrl, "mentioned");
    createPage(app, owner, pageName);
    createPage(app, owner, "private-app", { level: "authenticated" });
    createPage(app, owner, "owner-app", { level: "owner" });
    createPage(app, owner, "title-app");
  });

  afterAll(async () => {
    closeAllConnections();
    closeMetaDb();
    await app.close();
    await fs.promises.rm(dataDir, { recursive: true, force: true });
  });

  it("enforces a 256 Unicode-character title limit before create or update writes", async () => {
    const titlePagePath = `${owner}/title-app`;
    const validTitle = "😀".repeat(256);
    const invalidTitle = `${validTitle}😀`;
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath: titlePagePath, title: validTitle, description: "kept" }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json()).data;
    const rejectedCreate = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath: titlePagePath, title: invalidTitle }),
    });
    expect(rejectedCreate.status).toBe(400);
    await expect(rejectedCreate.json()).resolves.toMatchObject({ success: false, code: "issue_title_too_long", error: "Issue 标题不能超过 256 个字符" });
    const rejectedUpdate = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath: titlePagePath, title: invalidTitle }),
    });
    expect(rejectedUpdate.status).toBe(400);
    await expect(rejectedUpdate.json()).resolves.toMatchObject({ code: "issue_title_too_long" });
    const list = await fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(titlePagePath)}&status=open`);
    await expect(list.json()).resolves.toMatchObject({ meta: { total: 1 }, data: [expect.objectContaining({ title: validTitle })] });
  });

  it("streams minimal Issue invalidations and enforces app access", async () => {
    const denied = await fetch(`${baseUrl}/api/issues/events?pagePath=${encodeURIComponent(`${owner}/owner-app`)}`);
    expect(denied.status).toBe(401);

    const events = await fetch(`${baseUrl}/api/issues/events?pagePath=${encodeURIComponent(pagePath)}`);
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("text/event-stream");
    const reader = events.body!.getReader();

    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Realtime issue", description: "secret body", label: "bug" }),
    });
    const issue = (await created.json()).data;
    const event = await readIssueChanged(reader);

    expect(event).toEqual({
      type: "issue:changed",
      data: {
        pagePath,
        issueId: issue.id,
        kind: "created",
        updatedAt: expect.any(String),
      },
    });
    expect(JSON.stringify(event)).not.toContain("secret body");
    await reader.cancel();
  });

  it("returns an issue with its timeline and attachments", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Timeline detail", description: "Original description", label: "feature" }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json()).data;

    const response = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        issue: { id: issue.id, title: "Timeline detail", description: "Original description" },
        timeline: [{ kind: "event", event: expect.objectContaining({ event_type: "opened", actor_id: owner }) }],
        attachments: [],
      },
    });
  });

  it("creates owner-selected labels and assignees atomically and rejects metadata escalation", async () => {
    const labelResponse = await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, name: "创建时分配", color: "1f6feb" }),
    });
    expect(labelResponse.status).toBe(201);
    const customLabel = (await labelResponse.json()).data as { id: string };
    const duplicateLabel = await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, name: "创建时分配", color: "ff0000" }),
    });
    expect(duplicateLabel.status).toBe(400);
    const builtInEdit = await fetch(`${baseUrl}/api/issues/labels/bug`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, name: "Changed", color: "ff0000" }),
    });
    expect(builtInEdit.status).toBe(404);

    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        pagePath,
        title: "Atomic creation metadata",
        description: "Ready for triage",
        issueType: "feature",
        labelIds: [customLabel.id, customLabel.id],
        assigneeIds: ["commenter", "commenter"],
      }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json()).data as { id: number };

    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: ownerCookie } });
    const detailBody = await detail.json();
    expect(detailBody).toMatchObject({
      success: true,
      data: {
        collaboration: {
          labels: expect.arrayContaining([
            expect.objectContaining({ id: customLabel.id }),
          ]),
          assignee_ids: ["commenter"],
        },
        timeline: expect.arrayContaining([
          { kind: "event", event: expect.objectContaining({ event_type: "opened", actor_id: owner }) },
          { kind: "event", event: expect.objectContaining({ event_type: "labels_changed", actor_id: owner }) },
          { kind: "event", event: expect.objectContaining({ event_type: "assignees_changed", actor_id: owner }) },
        ]),
      },
    });
    expect(detailBody.data.issue).toMatchObject({ issue_type: "feature" });
    expect(detailBody.data.collaboration.labels.map((item: { id: string }) => item.id)).toEqual([customLabel.id]);
    const assignedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(assignedDetail.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["commenter"] } } });

    const denied = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, title: "Metadata escalation", labelIds: [customLabel.id], assigneeIds: ["commenter"] }),
    });
    expect(denied.status).toBe(403);

    const invalid = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Rolled back creation", labelIds: ["missing-label"] }),
    });
    expect(invalid.status).toBe(400);
    const missing = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "Rolled back creation" })}`);
    await expect(missing.json()).resolves.toMatchObject({ success: true, meta: { total: 0 }, data: [] });
  });

  it("manages milestones, filters Issues, and enforces owner writes", async () => {
    const createdMilestone = await fetch(`${baseUrl}/api/issues/milestones`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "v2.0", description: "Next release", dueOn: "2026-09-01" }),
    });
    expect(createdMilestone.status).toBe(201);
    const milestone = (await createdMilestone.json()).data as { id: number };

    const duplicate = await fetch(`${baseUrl}/api/issues/milestones`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "v2.0" }),
    });
    expect(duplicate.status).toBe(400);
    const denied = await fetch(`${baseUrl}/api/issues/milestones`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, title: "Denied" }),
    });
    expect(denied.status).toBe(403);

    const createdIssue = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Milestoned work", milestoneId: milestone.id }),
    });
    expect(createdIssue.status).toBe(200);
    const issue = (await createdIssue.json()).data;
    expect(issue).toMatchObject({ milestone_id: milestone.id });

    const filtered = await fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(pagePath)}&milestone=${milestone.id}`);
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id: issue.id })]) });

    const updated = await fetch(`${baseUrl}/api/issues/milestones/${milestone.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "v2", description: "Release", dueOn: null, state: "closed" }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ data: { title: "v2", due_on: null, state: "closed", open_issues: 1 } });

    const removed = await fetch(`${baseUrl}/api/issues/milestones/${milestone.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      method: "DELETE", headers: { Cookie: ownerCookie },
    });
    expect(removed.status).toBe(200);
    const unassigned = await fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(pagePath)}&milestone=none`);
    await expect(unassigned.json()).resolves.toMatchObject({ data: expect.arrayContaining([expect.objectContaining({ id: issue.id, milestone_id: null })]) });
  });

  it("rejects malformed numeric ids and unsupported list filters", async () => {
    const malformed = await fetch(`${baseUrl}/api/issues/1abc?pagePath=${encodeURIComponent(pagePath)}`);
    expect(malformed.status).toBe(400);
    const status = await fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(pagePath)}&status=archived`);
    expect(status.status).toBe(400);
    const longLabel = await fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(pagePath)}&label=${"x".repeat(101)}`);
    expect(longLabel.status).toBe(400);
    const reason = await fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(pagePath)}&reason=wontfix`);
    expect(reason.status).toBe(400);
  });

  it("lists Issues with structured filters, sorting, pagination, and metadata", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Upload query target", description: "Upload fails", label: "bug" }),
    });
    const issue = (await created.json()).data;

    for (const body of ["First upload comment", "Second upload comment"]) {
      const comment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: commenterCookie },
        body: JSON.stringify({ pagePath, body }),
      });
      expect(comment.status).toBe(201);
    }
    const assigned = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, userIds: ["commenter"] }),
    });
    expect(assigned.status).toBe(200);

    const unassignedCreated = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Unassigned triage target", description: "Needs metadata" }),
    });
    expect(unassignedCreated.status).toBe(200);
    const unassignedIssue = (await unassignedCreated.json()).data;
    const clearedLabels = await fetch(`${baseUrl}/api/issues/${unassignedIssue.id}/labels`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, labelIds: [] }),
    });
    expect(clearedLabels.status).toBe(200);

    const response = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({
      pagePath,
      q: "upload",
      status: "open",
      type: "bug",
      author: owner,
      participant: "commenter",
      assignee: "commenter",
      sort: "comments",
      direction: "desc",
      limit: "10",
      offset: "0",
    })}`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining({
        id: issue.id,
        issue_number: expect.any(Number),
        title: "Upload query target",
        comment_count: 2,
        last_activity_at: expect.any(String),
        participant_ids: expect.arrayContaining([owner, "commenter"]),
      })],
      meta: { limit: 10, offset: 0, total: 1, open: expect.any(Number), closed: expect.any(Number) },
    });

    const unassignedResponse = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({
      pagePath,
      q: "Unassigned triage target",
      assignee: "none",
      label: "none",
    })}`);
    expect(unassignedResponse.status).toBe(200);
    await expect(unassignedResponse.json()).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining({ id: unassignedIssue.id, labels: [], assignee_ids: [] })],
      meta: { total: 1 },
    });
  });

  it("searches current Issue comment bodies through the Hosted API", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Hosted discussion search" }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json()).data;
    const comment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "HOSTED-COMMENT-SEARCH-261" }),
    });
    expect(comment.status).toBe(201);

    const searched = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "HOSTED-COMMENT-SEARCH-261" })}`);
    expect(searched.status).toBe(200);
    await expect(searched.json()).resolves.toMatchObject({ success: true, data: [expect.objectContaining({ id: issue.id })], meta: { total: 1, open: 1 } });
    const commentsOnly = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "HOSTED-COMMENT-SEARCH-261", in: "comments" })}`);
    await expect(commentsOnly.json()).resolves.toMatchObject({ success: true, data: [expect.objectContaining({ id: issue.id })], meta: { total: 1 } });
    const titleOnly = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "HOSTED-COMMENT-SEARCH-261", in: "title" })}`);
    await expect(titleOnly.json()).resolves.toMatchObject({ success: true, data: [], meta: { total: 0 } });
    expect((await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "x", in: "comments,title" })}`)).status).toBe(400);
  });

  it("lets only the app owner pin up to three Issues and exposes pinned cards independently of filters", async () => {
    const issues = [] as Array<{ id: number }>;
    for (let index = 0; index < 4; index += 1) {
      const response = await fetch(`${baseUrl}/api/issues`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
        body: JSON.stringify({ pagePath, title: `Hosted pin ${index + 1}` }),
      });
      issues.push((await response.json()).data);
    }
    const denied = await fetch(`${baseUrl}/api/issues/${issues[0].id}/pin`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, pinned: true }),
    });
    expect(denied.status).toBe(403);

    for (const issue of issues.slice(0, 3)) {
      const response = await fetch(`${baseUrl}/api/issues/${issue.id}/pin`, {
        method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
        body: JSON.stringify({ pagePath, pinned: true }),
      });
      expect(response.status).toBe(200);
    }
    const limited = await fetch(`${baseUrl}/api/issues/${issues[3].id}/pin`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, pinned: true }),
    });
    expect(limited.status).toBe(409);
    await expect(limited.json()).resolves.toMatchObject({ success: false, code: "issue_pin_limit_exceeded" });

    const list = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "no-normal-result" })}`);
    await expect(list.json()).resolves.toMatchObject({ success: true, data: [], pinned: expect.arrayContaining(issues.slice(0, 3).map(({ id }) => expect.objectContaining({ id, pinned_by: owner }))) });

    expect((await fetch(`${baseUrl}/api/issues/${issues[0].id}/pin`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, pinned: false }),
    })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/issues/${issues[3].id}/pin`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, pinned: true }),
    })).status).toBe(200);
  });

  it("creates, links, audits, and removes Sub-issues with owner-only mutations", async () => {
    const create = async (title: string, parentIssueId?: number, cookie = ownerCookie) => {
      const response = await fetch(`${baseUrl}/api/issues`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ pagePath, title, ...(parentIssueId === undefined ? {} : { parentIssueId }) }),
      });
      return { response, body: await response.json() };
    };
    const parent = await create("Hosted Sub-issue parent");
    const child = await create("Hosted atomic child", parent.body.data.id);
    expect(child.response.status).toBe(200);

    const parentDetail = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(parentDetail.json()).resolves.toMatchObject({
      data: {
        subIssues: [expect.objectContaining({ id: child.body.data.id, title: "Hosted atomic child" })],
        subIssueSummary: { total: 1, completed: 0, percent: 0 },
      },
    });
    const childDetail = await fetch(`${baseUrl}/api/issues/${child.body.data.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(childDetail.json()).resolves.toMatchObject({ data: { parent: { id: parent.body.data.id } } });

    const existing = await create("Hosted existing child");
    const denied = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: commenterCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(denied.status).toBe(403);
    const linked = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(linked.status).toBe(200);
    await expect(linked.json()).resolves.toMatchObject({ data: { subIssueSummary: { total: 2 } } });
    const children = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    expect(children.status).toBe(200);
    await expect(children.json()).resolves.toMatchObject({ data: {
      summary: { total: 2, completed: 0, percent: 0 },
      items: expect.arrayContaining([expect.objectContaining({ id: child.body.data.id, child_count: 0, completed_child_count: 0, child_percent: 0 })]),
    } });
    const duplicate = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ code: "issue_sub_issue_duplicate" });

    expect((await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/priority`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: commenterCookie }, body: JSON.stringify({ pagePath, childIssueId: existing.body.data.id, afterIssueId: null }),
    })).status).toBe(403);
    const priority = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/priority`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath, childIssueId: existing.body.data.id, afterIssueId: null }),
    });
    expect(priority.status).toBe(200);
    await expect(priority.json()).resolves.toMatchObject({ data: { subIssues: [{ id: existing.body.data.id, position: 0 }, { id: child.body.data.id, position: 1 }] } });

    const removed = await fetch(`${baseUrl}/api/issues/${parent.body.data.id}/sub-issues/${existing.body.data.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ data: { subIssueSummary: { total: 1 } } });

    const missingParent = await create("Must roll back", 999999);
    expect(missingParent.response.status).toBe(404);
    const searched = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "Must roll back" })}`);
    await expect(searched.json()).resolves.toMatchObject({ data: [], meta: { total: 0 } });
  });

  it("converts an Issue body task into a Sub-issue with owner-only atomic semantics", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Conversion parent", description: "- [ ] **Build** the hosted API" }),
    });
    const parent = (await created.json()).data;
    const endpoint = `${baseUrl}/api/issues/${parent.id}/tasks/0/convert`;

    const denied = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, expectedUpdatedAt: parent.updated_at }),
    });
    expect(denied.status).toBe(403);

    const converted = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, expectedUpdatedAt: parent.updated_at, title: "Build hosted API" }),
    });
    expect(converted.status).toBe(200);
    const detail = (await converted.json()).data;
    expect(detail).toMatchObject({
      issue: { description: expect.stringMatching(/^- \[ \] #\d+$/) },
      subIssueSummary: { total: 1 },
      subIssues: [expect.objectContaining({ title: "Build hosted API", reporter_id: owner })],
      timeline: expect.arrayContaining([expect.objectContaining({ kind: "event", event: expect.objectContaining({ event_type: "task_converted_to_sub_issue" }) })]),
    });

    const stale = await fetch(`${baseUrl}/api/issues/${parent.id}/tasks/0/convert`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, expectedUpdatedAt: parent.updated_at }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ code: "issue_content_conflict" });
  });

  it("adds and removes owner-managed Issue dependencies with dual detail views", async () => {
    const create = async (title: string) => {
      const response = await fetch(`${baseUrl}/api/issues`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
        body: JSON.stringify({ pagePath, title }),
      });
      return (await response.json()).data as { id: number };
    };
    const blocked = await create("Hosted blocked work");
    const blocker = await create("Hosted blocking work");
    const denied = await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: commenterCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(denied.status).toBe(403);
    const added = await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(added.status).toBe(200);
    await expect(added.json()).resolves.toMatchObject({ data: { blockedBy: [expect.objectContaining({ id: blocker.id })], dependencySummary: { unresolvedBlockers: 1, isBlocked: true } } });
    const blockingDetail = await fetch(`${baseUrl}/api/issues/${blocker.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(blockingDetail.json()).resolves.toMatchObject({ data: { blocking: [expect.objectContaining({ id: blocked.id })] } });
    const duplicate = await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({ code: "issue_dependency_duplicate" });
    const removed = await fetch(`${baseUrl}/api/issues/${blocked.id}/dependencies/blocked-by/${blocker.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toMatchObject({ data: { blockedBy: [], dependencySummary: { isBlocked: false } } });
  });

  it("returns minimal potential duplicate suggestions without blocking creation", async () => {
    const existingResponse = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Hosted screenshot upload JSON error", description: "Unexpected token HTML response while uploading a screenshot" }),
    });
    const existing = (await existingResponse.json()).data as { id: number };
    const body = "Unexpected token HTML response while uploading a screenshot".padEnd(100, " x");
    const query = new URLSearchParams({ pagePath, title: "Screenshot upload JSON error", body });
    const response = await fetch(`${baseUrl}/api/issues/potential-duplicates?${query}`, { headers: { Cookie: commenterCookie } });
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: Array<Record<string, unknown>> };
    expect(payload.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: existing.id, score: expect.any(Number), matched_in: expect.any(String) })]));
    expect(payload.data.length).toBeLessThanOrEqual(3);
    for (const candidate of payload.data) expect(candidate).not.toHaveProperty("description");
    const short = await fetch(`${baseUrl}/api/issues/potential-duplicates?${new URLSearchParams({ pagePath, title: "Screenshot upload", body: "short" })}`);
    await expect(short.json()).resolves.toMatchObject({ data: [] });
    const duplicateParam = await fetch(`${baseUrl}/api/issues/potential-duplicates?${query}&title=other`);
    expect(duplicateParam.status).toBe(400);
  });

  it("returns versioned Issue templates through the application access boundary", async () => {
    const metaPath = path.join(dataDir, owner, pageName, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    meta.issues = { templates: [{ id: "bug-report", name: "Bug report", description: "Report a defect", titlePrefix: "[Bug] ", body: "## Steps", type: "bug", labels: ["triage"] }] };
    fs.writeFileSync(metaPath, JSON.stringify(meta));
    const response = await fetch(`${baseUrl}/api/issues/config?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { templates: meta.issues.templates } });

    const ownerOnly = await fetch(`${baseUrl}/api/issues/config?pagePath=${encodeURIComponent(`${owner}/owner-app`)}`, { headers: { Cookie: commenterCookie } });
    expect(ownerOnly.status).toBe(403);
    const invalid = await fetch(`${baseUrl}/api/issues/config?pagePath=${encodeURIComponent(pagePath)}&pagePath=other`, { headers: { Cookie: commenterCookie } });
    expect(invalid.status).toBe(400);
  });

  it("manages private saved views with session ownership and strict queries", async () => {
    const create = await fetch(`${baseUrl}/api/issues/views`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, name: "待验收", description: "本周", query: { status: "open", label: "bug", offset: 75 } }),
    });
    expect(create.status).toBe(200);
    const view = (await create.json()).data;
    expect(view).toMatchObject({ name: "待验收", user_id: "commenter", query: { status: "open", label: "bug", offset: 0 } });

    const ownerList = await fetch(`${baseUrl}/api/issues/views?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: ownerCookie } });
    await expect(ownerList.json()).resolves.toEqual({ success: true, data: [] });
    const anonymous = await fetch(`${baseUrl}/api/issues/views?pagePath=${encodeURIComponent(pagePath)}`);
    expect(anonymous.status).toBe(401);

    const update = await fetch(`${baseUrl}/api/issues/views/${view.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, name: "准备发布", query: { status: "closed", reason: "completed" } }),
    });
    await expect(update.json()).resolves.toMatchObject({ data: { name: "准备发布", description: "本周", query: { status: "closed", reason: "completed", offset: 0 } } });
    const copy = await fetch(`${baseUrl}/api/issues/views/${view.id}/copy`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: commenterCookie }, body: JSON.stringify({ pagePath }),
    });
    await expect(copy.json()).resolves.toMatchObject({ data: { name: "准备发布 copy" } });

    const denied = await fetch(`${baseUrl}/api/issues/views/${view.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json", Cookie: ownerCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(denied.status).toBe(404);
    const invalid = await fetch(`${baseUrl}/api/issues/views`, {
      method: "POST", headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, name: "坏查询", query: { ownerId: owner } }),
    });
    expect(invalid.status).toBe(400);
    const removed = await fetch(`${baseUrl}/api/issues/views/${view.id}`, {
      method: "DELETE", headers: { "Content-Type": "application/json", Cookie: commenterCookie }, body: JSON.stringify({ pagePath }),
    });
    expect(removed.status).toBe(200);
  });

  it("manages platform-wide saved replies with session ownership", async () => {
    const create = await fetch(`${baseUrl}/api/issues/saved-replies`, {
      method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: " Need details ", body: "Please add logs.\n\n%cursor%" }),
    });
    expect(create.status).toBe(201);
    const savedReply = (await create.json()).data;
    expect(savedReply).toMatchObject({ title: "Need details", body: "Please add logs.\n\n%cursor%" });
    expect(savedReply).not.toHaveProperty("userId");

    await expect(fetch(`${baseUrl}/api/issues/saved-replies`, { headers: { Cookie: ownerCookie } }).then((response) => response.json())).resolves.toMatchObject({ data: [expect.objectContaining({ id: savedReply.id })] });
    await expect(fetch(`${baseUrl}/api/issues/saved-replies`, { headers: { Cookie: commenterCookie } }).then((response) => response.json())).resolves.toEqual({ success: true, data: [] });
    expect((await fetch(`${baseUrl}/api/issues/saved-replies/${savedReply.id}`, { method: "DELETE", headers: { Cookie: commenterCookie } })).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/issues/saved-replies`, {
      method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Need details", body: "Duplicate" }),
    })).status).toBe(409);
    expect((await fetch(`${baseUrl}/api/issues/saved-replies`, {
      method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Unknown", body: "Body", ownerId: "commenter" }),
    })).status).toBe(400);
    expect((await fetch(`${baseUrl}/api/issues/saved-replies`)).status).toBe(401);
  });

  it("marks duplicate Issues only from owner comments and supports owner undo", async () => {
    const createIssue = async (title: string) => {
      const response = await fetch(`${baseUrl}/api/issues`, { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title, description: "", label: "bug" }) });
      return (await response.json()).data as { id: number; issue_number: number };
    };
    const canonical = await createIssue("Canonical duplicate target");
    const duplicate = await createIssue("Duplicate report");
    const ordinary = await fetch(`${baseUrl}/api/issues/${duplicate.id}/comments`, {
      method: "POST", headers: { Cookie: commenterCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, body: `Duplicate of #${canonical.issue_number}` }),
    });
    expect(ordinary.status).toBe(201);
    expect((await ordinary.json()).data.duplicateOf).toBeNull();

    const marked = await fetch(`${baseUrl}/api/issues/${duplicate.id}/comments`, {
      method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, body: `Duplicate of #${canonical.issue_number}` }),
    });
    expect(marked.status).toBe(201);
    expect((await marked.json()).data).toMatchObject({ duplicateOf: { id: canonical.id }, issue: { status: "open" } });
    await expect(fetch(`${baseUrl}/api/issues/${canonical.id}?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json())).resolves.toMatchObject({ data: { duplicates: [expect.objectContaining({ id: duplicate.id })] } });

    expect((await fetch(`${baseUrl}/api/issues/${duplicate.id}/duplicate/${canonical.id}`, { method: "DELETE", headers: { Cookie: commenterCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/issues/${duplicate.id}/duplicate/${canonical.id}`, { method: "DELETE", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(200);
    await expect(fetch(`${baseUrl}/api/issues/${duplicate.id}?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json())).resolves.toMatchObject({ data: { duplicateOf: null } });
  });

  it("reconciles Issue cross references from create, comment edit, and comment delete", async () => {
    const create = async (title: string, description = "") => {
      const response = await fetch(`${baseUrl}/api/issues`, { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title, description, label: "bug" }) });
      return (await response.json()).data as { id: number; issue_number: number; updated_at: string };
    };
    const target = await create("Cross reference target");
    const source = await create("Cross reference source", `Initial context for #${target.issue_number}`);
    const readTarget = () => fetch(`${baseUrl}/api/issues/${target.id}?pagePath=${encodeURIComponent(pagePath)}`).then((response) => response.json());
    await expect(readTarget()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "cross_reference", crossReference: expect.objectContaining({ source_issue_id: source.id, source_comment_id: null }) })]) } });

    const commentResponse = await fetch(`${baseUrl}/api/issues/${source.id}/comments`, {
      method: "POST", headers: { Cookie: commenterCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, body: `Comment context for #${target.issue_number}` }),
    });
    const commentDetail = (await commentResponse.json()).data;
    const comment = commentDetail.timeline.find((item: { kind: string }) => item.kind === "comment").comment;
    await expect(readTarget()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "cross_reference", crossReference: expect.objectContaining({ source_comment_id: comment.id }) })]) } });

    const removedResponse = await fetch(`${baseUrl}/api/issues/${source.id}/comments/${comment.id}`, {
      method: "PATCH", headers: { Cookie: commenterCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, body: "Reference removed", expectedUpdatedAt: comment.updated_at }),
    });
    expect((await readTarget()).data.timeline.filter((item: { kind: string; crossReference?: { source_comment_id: number | null } }) => item.kind === "cross_reference" && item.crossReference?.source_comment_id === comment.id)).toHaveLength(0);

    const removedComment = (await removedResponse.json()).data.timeline.find((item: { kind: string; comment?: { id: number } }) => item.kind === "comment" && item.comment?.id === comment.id).comment;
    await fetch(`${baseUrl}/api/issues/${source.id}/comments/${comment.id}`, {
      method: "PATCH", headers: { Cookie: commenterCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, body: `Referenced again in #${target.issue_number}`, expectedUpdatedAt: removedComment.updated_at }),
    });
    expect((await readTarget()).data.timeline.some((item: { kind: string; crossReference?: { source_comment_id: number | null } }) => item.kind === "cross_reference" && item.crossReference?.source_comment_id === comment.id)).toBe(true);
    await fetch(`${baseUrl}/api/issues/${source.id}/comments/${comment.id}?pagePath=${encodeURIComponent(pagePath)}`, { method: "DELETE", headers: { Cookie: commenterCookie } });
    expect((await readTarget()).data.timeline.filter((item: { kind: string; crossReference?: { source_comment_id: number | null } }) => item.kind === "cross_reference" && item.crossReference?.source_comment_id === comment.id)).toHaveLength(0);
  });

  it("lets only the app owner pin one Issue comment and unpin it", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, title: "Pinned decision", description: "", label: "bug" }),
    });
    const issue = (await created.json()).data as { id: number };
    const addComment = async (body: string) => {
      const response = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
        method: "POST", headers: { Cookie: commenterCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath, body }),
      });
      const detail = (await response.json()).data;
      return detail.timeline.filter((item: { kind: string }) => item.kind === "comment").at(-1).comment as { id: number };
    };
    const first = await addComment("First conclusion");
    const second = await addComment("Second conclusion");
    const endpoint = (commentId: number) => `${baseUrl}/api/issues/${issue.id}/comments/${commentId}/pin`;

    expect((await fetch(endpoint(first.id), { method: "PUT", headers: { Cookie: commenterCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(403);
    const pinned = await fetch(endpoint(first.id), { method: "PUT", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
    expect(pinned.status).toBe(200);
    await expect(pinned.json()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "comment", comment: expect.objectContaining({ id: first.id, pinned_by: owner, pinned_at: expect.any(String) }) })]) } });

    const conflict = await fetch(endpoint(second.id), { method: "PUT", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({ code: "issue_comment_pin_conflict" });

    expect((await fetch(endpoint(first.id), { method: "DELETE", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(200);
    expect((await fetch(endpoint(second.id), { method: "PUT", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) })).status).toBe(200);
  });

  it("lets only the app owner minimize and restore an unpinned comment", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, { method: "POST", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, title: "Moderation", description: "", label: "bug" }) });
    const issue = (await created.json()).data as { id: number };
    const commentResponse = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, { method: "POST", headers: { Cookie: commenterCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, body: "Off-topic content" }) });
    const comment = (await commentResponse.json()).data.timeline.find((item: { kind: string }) => item.kind === "comment").comment as { id: number };
    const endpoint = `${baseUrl}/api/issues/${issue.id}/comments/${comment.id}/minimize`;

    expect((await fetch(endpoint, { method: "PUT", headers: { Cookie: commenterCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, reason: "off-topic" }) })).status).toBe(403);
    expect((await fetch(endpoint, { method: "PUT", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, reason: "unknown" }) })).status).toBe(400);
    const minimized = await fetch(endpoint, { method: "PUT", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath, reason: "off-topic" }) });
    expect(minimized.status).toBe(200);
    await expect(minimized.json()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "comment", comment: expect.objectContaining({ id: comment.id, body: "Off-topic content", minimized_by: owner, minimized_reason: "off-topic", minimized_at: expect.any(String) }) })]) } });
    const restored = await fetch(endpoint, { method: "DELETE", headers: { Cookie: ownerCookie, "Content-Type": "application/json" }, body: JSON.stringify({ pagePath }) });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({ data: { timeline: expect.arrayContaining([expect.objectContaining({ kind: "comment", comment: expect.objectContaining({ id: comment.id, minimized_at: null, minimized_reason: null }) })]) } });
  });

  it("rejects duplicate scalar and invalid list query parameters with JSON 400 responses", async () => {
    const duplicateParameters = [
      ["pagePath", pagePath],
      ["q", "upload"],
      ["in", "comments"],
      ["status", "open"],
      ["label", "bug"],
      ["author", owner],
      ["participant", "commenter"],
      ["assignee", "commenter"],
      ["subscribed", "true"],
      ["mentioned", "true"],
      ["sort", "activity"],
      ["direction", "desc"],
      ["limit", "25"],
      ["offset", "0"],
    ] as const;
    for (const [name, value] of duplicateParameters) {
      const query = new URLSearchParams();
      if (name !== "pagePath") query.append("pagePath", pagePath);
      query.append(name, value);
      query.append(name, value);
      const response = await fetch(`${baseUrl}/api/issues?${query}`);
      expect(response.status, `duplicate ${name}`).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ success: false });
    }

    const invalidQueries = [
      { sort: "priority" },
      { direction: "sideways" },
      { limit: "0" },
      { limit: "101" },
      { limit: "1.5" },
      { offset: "-1" },
      { offset: "1.5" },
      { locked: "yes" },
      { subscribed: "subscriber" },
      { mentioned: "mentioned" },
      { unknown: "value" },
    ];
    for (const invalid of invalidQueries) {
      const query = new URLSearchParams({ pagePath, ...invalid });
      const response = await fetch(`${baseUrl}/api/issues?${query}`);
      expect(response.status, JSON.stringify(invalid)).toBe(400);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toMatchObject({ success: false });
    }
  });

  it("lists only the authenticated user's subscribed Issues", async () => {
    const firstCreated = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Subscriber private list one" }),
    });
    const first = (await firstCreated.json()).data;
    const secondCreated = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Subscriber private list two" }),
    });
    const second = (await secondCreated.json()).data;
    await fetch(`${baseUrl}/api/issues/${first.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: subscriberCookie },
      body: JSON.stringify({ pagePath, subscribed: true }),
    });
    await fetch(`${baseUrl}/api/issues/${second.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, subscribed: true }),
    });

    const own = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, subscribed: "true" })}`, {
      headers: { Cookie: subscriberCookie },
    });
    expect(own.status).toBe(200);
    await expect(own.json()).resolves.toMatchObject({ data: [expect.objectContaining({ id: first.id })], meta: { total: 1 } });

    const anonymous = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, subscribed: "true" })}`);
    expect(anonymous.status).toBe(401);
  });

  it("lists only Issues that currently mention the authenticated user", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Mentioned private queue", description: "Please review @mentioned" }),
    });
    const issue = (await created.json()).data;
    const listed = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "Mentioned private queue", mentioned: "true" })}`, { headers: { Cookie: mentionedCookie } });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ data: [expect.objectContaining({ id: issue.id })], meta: { total: 1 } });

    const removed = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, description: "Mention removed", expectedUpdatedAt: issue.updated_at }),
    });
    expect(removed.status).toBe(200);
    const after = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, q: "Mentioned private queue", mentioned: "true" })}`, { headers: { Cookie: mentionedCookie } });
    await expect(after.json()).resolves.toMatchObject({ data: [], meta: { total: 0 } });
  });

  it("updates issue fields and records edit and status events", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Before", description: "Before body", label: "bug" }),
    });
    const issue = (await created.json()).data;

    const updated = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        pagePath,
        title: "After",
        description: "After body",
        label: "feature",
        status: "closed",
        stateReason: "not_planned",
      }),
    });

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      success: true,
      data: { title: "After", description: "After body", issue_type: "feature", status: "closed", state_reason: "not_planned" },
    });

    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`);
    const detailBody = await detail.json();
    expect(detailBody.success).toBe(true);
    expect(detailBody.data.timeline).toEqual(expect.arrayContaining([
      { kind: "event", event: expect.objectContaining({ event_type: "edited", actor_id: owner }) },
      { kind: "event", event: expect.objectContaining({ event_type: "type_changed", actor_id: owner, payload_json: expect.stringContaining("feature") }) },
      { kind: "event", event: expect.objectContaining({ event_type: "closed", actor_id: owner, payload_json: expect.stringContaining("not_planned") }) },
    ]));
    expect(detailBody.data.issue.revision_count).toBe(1);

    const history = await fetch(`${baseUrl}/api/issues/${issue.id}/history?pagePath=${encodeURIComponent(pagePath)}`);
    expect(history.status).toBe(200);
    await expect(history.json()).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining({ target_type: "issue", target_id: issue.id, editor_id: owner, title: "Before", body: "Before body" })],
    });

    const noChange = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "After", description: "After body" }),
    });
    expect(noChange.status).toBe(200);
    const unchangedHistory = await fetch(`${baseUrl}/api/issues/${issue.id}/history?pagePath=${encodeURIComponent(pagePath)}`);
    expect((await unchangedHistory.json()).data).toHaveLength(1);

    const reopened = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, status: "open" }),
    });
    expect(reopened.status).toBe(200);
    await expect(reopened.json()).resolves.toMatchObject({ data: { status: "open", state_reason: null } });
    const invalidReason = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, stateReason: "not_planned" }),
    });
    expect(invalidReason.status).toBe(400);

    const staleUpdate = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, description: "stale task toggle", expectedUpdatedAt: issue.updated_at }),
    });
    expect(staleUpdate.status).toBe(409);
    await expect(staleUpdate.json()).resolves.toMatchObject({ success: false, code: "issue_content_conflict" });
    const afterConflict = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`);
    await expect(afterConflict.json()).resolves.toMatchObject({ data: { issue: { description: "After body", revision_count: 1 } } });
  });

  it("enforces owner-managed labels and assignees while users manage their own subscription", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Collaboration metadata", label: "bug" }),
    });
    const issue = (await created.json()).data;

    const deniedLabel = await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, name: "紧急", color: "b60205" }),
    });
    expect(deniedLabel.status).toBe(403);

    const createdLabel = await fetch(`${baseUrl}/api/issues/labels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, name: "紧急", color: "b60205", description: "立即处理" }),
    });
    expect(createdLabel.status).toBe(201);
    const label = (await createdLabel.json()).data;

    const labelsUpdated = await fetch(`${baseUrl}/api/issues/${issue.id}/labels`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, labelIds: [label.id] }),
    });
    expect(labelsUpdated.status).toBe(200);
    const filteredByCustomLabel = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, label: label.id })}`);
    expect(filteredByCustomLabel.status).toBe(200);
    expect((await filteredByCustomLabel.json()).data).toEqual([
      expect.objectContaining({ id: issue.id, labels: expect.arrayContaining([expect.objectContaining({ id: label.id })]) }),
    ]);

    const deniedAssignees = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, userIds: ["commenter"] }),
    });
    expect(deniedAssignees.status).toBe(403);

    const assigneesUpdated = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, userIds: ["commenter"] }),
    });
    expect(assigneesUpdated.status).toBe(200);
    expect(listInbox("commenter").items[0]).toMatchObject({
      user_id: "commenter",
      title: expect.stringContaining("Collaboration metadata"),
    });

    const subscribed = await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, subscribed: true, userId: owner }),
    });
    expect(subscribed.status).toBe(200);

    const publicDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`);
    const publicDetailBody = await publicDetail.json();
    expect(publicDetailBody.data.collaboration.subscriber_ids).toEqual([]);
    expect(publicDetailBody.data.timeline).not.toEqual(expect.arrayContaining([
      { kind: "event", event: expect.objectContaining({ event_type: "subscribed" }) },
    ]));

    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      headers: { Cookie: commenterCookie },
    });
    const detailBody = await detail.json();
    expect(detailBody).toMatchObject({
      success: true,
      data: {
        collaboration: {
          labels: expect.arrayContaining([expect.objectContaining({ id: label.id, name: "紧急" })]),
          assignee_ids: ["commenter"],
          subscriber_ids: ["commenter"],
          participant_ids: expect.arrayContaining([owner, "commenter"]),
        },
        timeline: expect.arrayContaining([
          { kind: "event", event: expect.objectContaining({ event_type: "labels_changed", actor_id: owner }) },
          { kind: "event", event: expect.objectContaining({ event_type: "assignees_changed", actor_id: owner }) },
        ]),
      },
    });
    expect(detailBody.data.timeline).not.toEqual(expect.arrayContaining([
      { kind: "event", event: expect.objectContaining({ event_type: "subscribed", actor_id: "commenter" }) },
    ]));
  });

  it("notifies Issue subscribers once for comments and status changes", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Subscriber activity", description: "", label: "bug" }),
    });
    const issue = (await created.json()).data;
    const subscribed = await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: subscriberCookie },
      body: JSON.stringify({ pagePath, subscribed: true }),
    });
    expect(subscribed.status).toBe(200);
    const before = listInbox("subscriber").items.length;

    const mentioned = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Please review @subscriber", draftId: "mentioned-subscriber", attachmentIds: [] }),
    });
    expect(mentioned.status).toBe(201);
    expect(listInbox("subscriber").items).toHaveLength(before + 1);
    expect(JSON.parse(listInbox("subscriber").items[0].data!)).toMatchObject({ type: "issue_mentioned", issueId: issue.id });

    const commented = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "A subscriber-only update", draftId: "subscriber-only", attachmentIds: [] }),
    });
    expect(commented.status).toBe(201);
    const commentBody = await commented.json();
    const comment = commentBody.data.timeline.filter((item: { kind: string }) => item.kind === "comment").at(-1).comment;
    expect(listInbox("subscriber").items).toHaveLength(before + 2);
    expect(listInbox("subscriber").items[0]).toMatchObject({
      user_id: "subscriber",
      url: expect.stringContaining(`localappIssueCommentId=${comment.id}`),
    });
    expect(JSON.parse(listInbox("subscriber").items[0].data!)).toMatchObject({ type: "issue_commented", issueId: issue.id, commentId: comment.id });

    const ownComment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: subscriberCookie },
      body: JSON.stringify({ pagePath, body: "My own activity", draftId: "subscriber-self", attachmentIds: [] }),
    });
    expect(ownComment.status).toBe(201);
    expect(listInbox("subscriber").items).toHaveLength(before + 2);

    const closed = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, status: "closed" }),
    });
    expect(closed.status).toBe(200);
    expect(listInbox("subscriber").items).toHaveLength(before + 3);
    expect(JSON.parse(listInbox("subscriber").items[0].data!)).toMatchObject({ type: "issue_status_changed", issueId: issue.id, status: "closed", stateReason: "completed" });
  });

  it("automatically subscribes newly assigned users without unsubscribing them when removed", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Assignment subscription", label: "bug" }),
    });
    const issue = (await created.json()).data;
    const assigned = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, userIds: ["commenter"] }),
    });
    expect(assigned.status).toBe(200);
    const assignedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(assignedDetail.json()).resolves.toMatchObject({ data: { collaboration: { assignee_ids: ["commenter"], subscriber_ids: ["commenter"] } } });
    const inboxBeforeComment = listInbox("commenter").items.length;
    const followUp = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Assignment follow-up", draftId: "assignment-follow-up", attachmentIds: [] }),
    });
    expect(followUp.status).toBe(201);
    expect(listInbox("commenter").items).toHaveLength(inboxBeforeComment + 1);
    expect(JSON.parse(listInbox("commenter").items[0].data!)).toMatchObject({ type: "issue_commented", issueId: issue.id });

    const removed = await fetch(`${baseUrl}/api/issues/${issue.id}/assignees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, userIds: [] }),
    });
    expect(removed.status).toBe(200);
    const removedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(removedDetail.json()).resolves.toMatchObject({ data: { collaboration: { assignee_ids: [], subscriber_ids: ["commenter"] } } });
  });

  it("automatically subscribes Issue creators and comment participants while preserving manual unsubscribe", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Participating subscription", description: "Follow replies", label: "bug" }),
    });
    const issue = (await created.json()).data;
    const creatorDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: ownerCookie } });
    await expect(creatorDetail.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: [owner] } } });

    const commented = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "I am participating", draftId: "participating-subscription", attachmentIds: [] }),
    });
    expect(commented.status).toBe(201);
    await expect(commented.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["commenter"] } } });
    expect(listInbox(owner).items[0]).toMatchObject({ title: expect.stringContaining("评论了你订阅的 Issue") });

    const unsubscribed = await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, subscribed: false }),
    });
    expect(unsubscribed.status).toBe(200);
    await expect(unsubscribed.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: [] } } });
  });

  it("automatically subscribes newly mentioned users without reviving unchanged mentions after unsubscribe", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Mention subscription", description: "Please review @commenter", label: "bug" }),
    });
    const issue = (await created.json()).data;
    const mentionedDetail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(mentionedDetail.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["commenter"] } } });

    await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, subscribed: false }),
    });
    const edited = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, description: "Please review @commenter when ready", expectedUpdatedAt: issue.updated_at }),
    });
    expect(edited.status).toBe(200);
    const afterUnchangedMention = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(afterUnchangedMention.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: [] } } });

    const comment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "A new thread for @commenter", draftId: "mention-subscription", attachmentIds: [] }),
    });
    expect(comment.status).toBe(201);
    const commentBody = await comment.json();
    const record = commentBody.data.timeline.filter((item: { kind: string }) => item.kind === "comment").at(-1).comment;
    const afterNewMention = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(afterNewMention.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: ["commenter"] } } });

    await fetch(`${baseUrl}/api/issues/${issue.id}/subscription`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, subscribed: false }),
    });
    const editedComment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${record.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "A new thread for @commenter with context", expectedUpdatedAt: record.updated_at, draftId: "mention-edit", attachmentIds: [] }),
    });
    expect(editedComment.status).toBe(200);
    const afterUnchangedCommentMention = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: commenterCookie } });
    await expect(afterUnchangedCommentMention.json()).resolves.toMatchObject({ data: { collaboration: { subscriber_ids: [] } } });
  });

  it("creates comments with status actions and enforces author-only comment changes", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Comment target", description: "", label: "bug" }),
    });
    const issue = (await created.json()).data;

    const deniedStatusAction = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "I can reproduce this.", draftId: "comment-draft", attachmentIds: [], statusAction: "closed" }),
    });
    expect(deniedStatusAction.status).toBe(403);

    const commented = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "I can reproduce this.", draftId: "comment-draft", attachmentIds: [] }),
    });

    expect(commented.status).toBe(201);
    const commentDetail = await commented.json();
    expect(commentDetail.success).toBe(true);
    expect(commentDetail.data.issue).toMatchObject({ status: "open" });
    expect(commentDetail.data.timeline).toEqual(expect.arrayContaining([
      { kind: "comment", comment: expect.objectContaining({ body: "I can reproduce this.", author_id: "commenter" }) },
    ]));
    const comment = commentDetail.data.timeline.find((item: { kind: string }) => item.kind === "comment").comment;

    const invalidReason = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Invalid close reason.", statusAction: "closed", stateReason: "duplicate" }),
    });
    expect(invalidReason.status).toBe(400);

    const closedByReporter = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Closing after review.", draftId: "owner-comment-draft", attachmentIds: [], statusAction: "closed", stateReason: "not_planned" }),
    });
    expect(closedByReporter.status).toBe(201);
    const closedDetail = await closedByReporter.json();
    expect(closedDetail.data.issue).toMatchObject({ status: "closed", state_reason: "not_planned" });
    expect(closedDetail.data.timeline).toEqual(expect.arrayContaining([
      { kind: "event", event: expect.objectContaining({ event_type: "closed", actor_id: owner, payload_json: expect.stringContaining('"stateReason":"not_planned"') }) },
    ]));

    const ownerEdit = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Owner cannot rewrite this." }),
    });
    expect(ownerEdit.status).toBe(403);

    const edited = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "Updated reproduction." }),
    });
    expect(edited.status).toBe(200);
    const editedDetail = await edited.json();
    expect(editedDetail.success).toBe(true);
    expect(editedDetail.data.timeline).toEqual(expect.arrayContaining([
      { kind: "comment", comment: expect.objectContaining({ id: comment.id, body: "Updated reproduction.", revision_count: 1 }) },
    ]));

    const commentHistory = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}/history?pagePath=${encodeURIComponent(pagePath)}`);
    expect(commentHistory.status).toBe(200);
    await expect(commentHistory.json()).resolves.toMatchObject({
      success: true,
      data: [expect.objectContaining({ target_type: "comment", target_id: comment.id, editor_id: "commenter", body: "I can reproduce this." })],
    });

    const otherIssue = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Other Issue", label: "bug" }),
    }).then((response) => response.json());
    const crossIssueHistory = await fetch(`${baseUrl}/api/issues/${otherIssue.data.id}/comments/${comment.id}/history?pagePath=${encodeURIComponent(pagePath)}`);
    expect(crossIssueHistory.status).toBe(404);

    const ownerDelete = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      method: "DELETE",
      headers: { Cookie: ownerCookie },
    });
    expect(ownerDelete.status).toBe(403);

    const deleted = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      method: "DELETE",
      headers: { Cookie: commenterCookie },
    });
    expect(deleted.status).toBe(200);
    const deletedDetail = await deleted.json();
    expect(deletedDetail.success).toBe(true);
    expect(deletedDetail.data.timeline).toEqual(expect.arrayContaining([
      { kind: "comment", comment: expect.objectContaining({ id: comment.id, body: "", deleted_at: expect.any(String) }) },
    ]));
  });

  it("notifies only valid newly added Markdown mentions with target deep links", async () => {
    const mentionItems = (userId: string) => listInbox(userId, { limit: 100 }).items.filter((item) => {
      try { return JSON.parse(item.data ?? "{}").type === "issue_mentioned"; } catch { return false; }
    });
    const beforeMentioned = mentionItems("mentioned").length;
    const beforeCommenter = mentionItems("commenter").length;
    const beforeOwner = mentionItems(owner).length;
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({
        pagePath,
        title: "Mention workflow",
        description: "Hello @mentioned and @mentioned. `@commenter` [@commenter](/users/commenter) unknown @missing",
        label: "bug",
      }),
    });
    expect(created.status).toBe(200);
    const issue = (await created.json()).data;
    expect(mentionItems("mentioned")).toHaveLength(beforeMentioned + 1);
    expect(mentionItems("mentioned")[0]).toMatchObject({
      title: expect.stringContaining("Mention workflow"),
      url: expect.stringContaining(`localappIssueId=${issue.id}`),
    });
    expect(mentionItems("commenter")).toHaveLength(beforeCommenter);

    const edited = await fetch(`${baseUrl}/api/issues/${issue.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, description: "Still @mentioned, now @commenter" }),
    });
    expect(edited.status).toBe(200);
    expect(mentionItems("mentioned")).toHaveLength(beforeMentioned + 1);
    expect(mentionItems("commenter")).toHaveLength(beforeCommenter + 1);

    const commented = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Review @mentioned @mentioned and `@commenter`", draftId: "mention-comment", attachmentIds: [] }),
    });
    expect(commented.status).toBe(201);
    const comment = (await commented.json()).data.timeline.find((item: { kind: string }) => item.kind === "comment").comment;
    expect(mentionItems("mentioned")).toHaveLength(beforeMentioned + 2);
    expect(mentionItems("mentioned")[0].url).toContain(`localappIssueCommentId=${comment.id}`);

    const commentEdited = await fetch(`${baseUrl}/api/issues/${issue.id}/comments/${comment.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, body: "Review @mentioned and newly @commenter" }),
    });
    expect(commentEdited.status).toBe(200);
    expect(mentionItems("commenter")).toHaveLength(beforeCommenter + 2);
    expect(mentionItems(owner)).toHaveLength(beforeOwner);
  });

  it("toggles body and comment reactions with authentication and target validation", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Reaction target", description: "React here" }),
    });
    const issue = (await created.json()).data;
    const commented = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "Comment reaction", draftId: "reaction-comment", attachmentIds: [] }),
    });
    const commentDetail = await commented.json();
    const comment = commentDetail.data.timeline.find((item: { kind: string }) => item.kind === "comment").comment;

    const anonymous = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pagePath, content: "+1", reacted: true }),
    });
    expect(anonymous.status).toBe(401);

    const invalid = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, content: "fire", reacted: true }),
    });
    expect(invalid.status).toBe(400);

    for (const cookieValue of [ownerCookie, ownerCookie, commenterCookie]) {
      const reacted = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookieValue },
        body: JSON.stringify({ pagePath, content: "+1", reacted: true }),
      });
      expect(reacted.status).toBe(200);
    }
    const commentReaction = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, commentId: comment.id, content: "heart", reacted: true }),
    });
    expect(commentReaction.status).toBe(200);
    await expect(commentReaction.json()).resolves.toMatchObject({
      success: true,
      data: { reactions: expect.arrayContaining([
        expect.objectContaining({ comment_id: 0, user_id: owner, content: "+1" }),
        expect.objectContaining({ comment_id: 0, user_id: "commenter", content: "+1" }),
        expect.objectContaining({ comment_id: comment.id, user_id: owner, content: "heart" }),
      ]) },
    });

    const wrongTarget = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, commentId: 999999, content: "eyes", reacted: true }),
    });
    expect(wrongTarget.status).toBe(404);

    const removed = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, content: "+1", reacted: false }),
    });
    expect(removed.status).toBe(200);
    const removedDetail = await removed.json();
    expect(removedDetail.data.reactions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ comment_id: 0, user_id: owner, content: "+1" }),
    ]));
    expect(removedDetail.data.reactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ comment_id: 0, user_id: "commenter", content: "+1" }),
    ]));
  });

  it("locks conversations atomically and rejects new comments and reactions", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Lock target", description: "Keep history" }),
    });
    const issue = (await created.json()).data;

    const denied = await fetch(`${baseUrl}/api/issues/${issue.id}/lock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, locked: true }),
    });
    expect(denied.status).toBe(403);

    const invalidReason = await fetch(`${baseUrl}/api/issues/${issue.id}/lock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, locked: true, reason: "other" }),
    });
    expect(invalidReason.status).toBe(400);

    const locked = await fetch(`${baseUrl}/api/issues/${issue.id}/lock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, locked: true, reason: "resolved" }),
    });
    expect(locked.status).toBe(200);
    await expect(locked.json()).resolves.toMatchObject({
      success: true,
      data: {
        issue: { locked_at: expect.any(String), locked_by: owner, lock_reason: "resolved" },
        timeline: expect.arrayContaining([{ kind: "event", event: expect.objectContaining({ event_type: "locked", actor_id: owner, payload_json: JSON.stringify({ reason: "resolved" }) }) }]),
      },
    });
    const lockedList = await fetch(`${baseUrl}/api/issues?${new URLSearchParams({ pagePath, status: "open", locked: "true" })}`);
    expect((await lockedList.json()).data).toEqual(expect.arrayContaining([expect.objectContaining({ id: issue.id, locked_at: expect.any(String) })]));

    const comment = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "Must not persist", draftId: "locked-comment", attachmentIds: [] }),
    });
    expect(comment.status).toBe(409);
    await expect(comment.json()).resolves.toMatchObject({ success: false, code: "issue_locked" });

    const reaction = await fetch(`${baseUrl}/api/issues/${issue.id}/reactions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, content: "+1", reacted: true }),
    });
    expect(reaction.status).toBe(409);
    await expect(reaction.json()).resolves.toMatchObject({ success: false, code: "issue_locked" });

    const detail = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, { headers: { Cookie: ownerCookie } });
    const lockedDetail = await detail.json();
    expect(lockedDetail.data.timeline.filter((item: { kind: string }) => item.kind === "comment")).toHaveLength(0);
    expect(lockedDetail.data.reactions).toHaveLength(0);

    const unlocked = await fetch(`${baseUrl}/api/issues/${issue.id}/lock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, locked: false }),
    });
    expect(unlocked.status).toBe(200);
    await expect(unlocked.json()).resolves.toMatchObject({ data: { issue: { locked_at: null, locked_by: null, lock_reason: null } } });

    const resumed = await fetch(`${baseUrl}/api/issues/${issue.id}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: commenterCookie },
      body: JSON.stringify({ pagePath, body: "Conversation resumed", draftId: "unlocked-comment", attachmentIds: [] }),
    });
    expect(resumed.status).toBe(201);
  });

  it("enforces authenticated and owner page access across Issue workflows", async () => {
    const privatePath = `${owner}/private-app`;
    const privateCreated = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath: privatePath, title: "Private issue" }),
    });
    const privateIssue = (await privateCreated.json()).data;

    const anonymousPrivateRequests = [
      fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(privatePath)}`),
      fetch(`${baseUrl}/api/issues/${privateIssue.id}?pagePath=${encodeURIComponent(privatePath)}`),
      fetch(`${baseUrl}/api/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: privatePath, title: "Denied create" }),
      }),
      fetch(`${baseUrl}/api/issues/${privateIssue.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pagePath: privatePath, body: "Denied comment" }),
      }),
    ];
    for (const response of await Promise.all(anonymousPrivateRequests)) {
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ success: false });
    }

    const ownerPath = `${owner}/owner-app`;
    const ownerCreated = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath: ownerPath, title: "Owner issue" }),
    });
    const ownerIssue = (await ownerCreated.json()).data;
    const nonOwnerRequests = [
      fetch(`${baseUrl}/api/issues?pagePath=${encodeURIComponent(ownerPath)}`, { headers: { Cookie: commenterCookie } }),
      fetch(`${baseUrl}/api/issues/${ownerIssue.id}?pagePath=${encodeURIComponent(ownerPath)}`, { headers: { Cookie: commenterCookie } }),
      fetch(`${baseUrl}/api/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: commenterCookie },
        body: JSON.stringify({ pagePath: ownerPath, title: "Denied create" }),
      }),
      fetch(`${baseUrl}/api/issues/${ownerIssue.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: commenterCookie },
        body: JSON.stringify({ pagePath: ownerPath, body: "Denied comment" }),
      }),
    ];
    for (const response of await Promise.all(nonOwnerRequests)) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ success: false });
    }
  });

  it("allows only the app owner to permanently delete an Issue", async () => {
    const created = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath, title: "Delete me", description: "temporary" }),
    });
    const issue = (await created.json()).data as { id: number };

    const denied = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      method: "DELETE", headers: { Cookie: commenterCookie },
    });
    expect(denied.status).toBe(403);
    expect((await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`)).status).toBe(200);

    const removed = await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`, {
      method: "DELETE", headers: { Cookie: ownerCookie },
    });
    expect(removed.status).toBe(200);
    await expect(removed.json()).resolves.toEqual({ success: true, data: { id: issue.id } });
    expect((await fetch(`${baseUrl}/api/issues/${issue.id}?pagePath=${encodeURIComponent(pagePath)}`)).status).toBe(404);
  });

  it("returns stable JSON validation errors for malformed Issue creation payloads", async () => {
    const malformed = await fetch(`${baseUrl}/api/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: ownerCookie },
      body: JSON.stringify({ pagePath: { owner: true }, title: ["not", "text"], description: 42 }),
    });

    expect(malformed.status).toBe(400);
    expect(malformed.headers.get("content-type")).toContain("application/json");
    expect(await malformed.json()).toMatchObject({ success: false });
  });
});
