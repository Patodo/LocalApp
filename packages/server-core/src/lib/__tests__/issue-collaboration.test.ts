import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeAllConnections,
  createIssueMilestone,
  createIssueLabel,
  deleteIssueMilestone,
  deleteIssueLabel,
  ensureIssueTables,
  getConnection,
  getIssueDetail,
  getIssueCollaborationMetadata,
  insertIssue,
  listIssueMilestones,
  listIssues,
  listIssueLabels,
  replaceIssueAssignees,
  replaceIssueLabels,
  setIssueSubscription,
  setIssueMilestone,
  updateIssueMilestone,
  updateIssueLabel,
} from "../app-db.js";

describe("Issue collaboration metadata", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-collaboration-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates collaboration tables idempotently without treating types as labels", async () => {
    const bug = await insertIssue(dbPath, "Broken upload", "", "bug", "alice");
    const feature = await insertIssue(dbPath, "Add export", "", "feature", "bob");

    await ensureIssueTables(dbPath);
    await ensureIssueTables(dbPath);

    const db = await getConnection(dbPath);
    const tableNames = (db.exec(`SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '_issue_%'`)[0]?.values ?? [])
      .map(([name]) => String(name));
    expect(tableNames).toEqual(expect.arrayContaining([
      "_issue_labels",
      "_issue_label_links",
      "_issue_assignees",
      "_issue_subscriptions",
    ]));
    expect(await listIssueLabels(dbPath)).toEqual([]);
    expect((await getIssueCollaborationMetadata(dbPath, bug.id)).labels).toEqual([]);
    expect((await getIssueCollaborationMetadata(dbPath, feature.id)).labels).toEqual([]);
    expect((await getIssueDetail(dbPath, bug.id))?.issue.issue_type).toBe("bug");
    expect((await getIssueDetail(dbPath, feature.id))?.issue.issue_type).toBe("feature");
  });

  it("replaces labels and assignees without duplicates and tracks subscriptions per user", async () => {
    const issue = await insertIssue(dbPath, "Collaborate", "", "bug", "alice");
    await createIssueLabel(dbPath, { id: "backend", name: "后端", color: "0052cc" });
    await createIssueLabel(dbPath, { id: "urgent", name: "紧急", color: "ff0000" });
    await replaceIssueLabels(dbPath, issue.id, ["backend", "urgent", "backend"]);
    await replaceIssueAssignees(dbPath, issue.id, ["bob", "carol", "bob"], "owner");
    await setIssueSubscription(dbPath, issue.id, "alice", true);
    await setIssueSubscription(dbPath, issue.id, "alice", true);
    await setIssueSubscription(dbPath, issue.id, "bob", true);

    expect(await getIssueCollaborationMetadata(dbPath, issue.id)).toMatchObject({
      assignee_ids: ["bob", "carol"],
      subscriber_ids: ["alice", "bob"],
      participant_ids: ["alice", "bob", "carol"],
    });
    expect((await getIssueCollaborationMetadata(dbPath, issue.id)).labels.map(({ id }) => id)).toEqual(["backend", "urgent"]);
    expect(await getIssueDetail(dbPath, issue.id)).toMatchObject({
      collaboration: {
        assignee_ids: ["bob", "carol"],
        subscriber_ids: ["alice", "bob"],
        participant_ids: ["alice", "bob", "carol"],
      },
    });

    await replaceIssueAssignees(dbPath, issue.id, ["carol"], "owner");
    await setIssueSubscription(dbPath, issue.id, "alice", false);
    expect(await getIssueCollaborationMetadata(dbPath, issue.id)).toMatchObject({
      assignee_ids: ["carol"],
      subscriber_ids: ["bob"],
      participant_ids: ["alice", "carol"],
    });
  });

  it("rejects unknown labels and missing Issues atomically", async () => {
    const issue = await insertIssue(dbPath, "Atomic metadata", "", "bug", "alice");

    await expect(replaceIssueLabels(dbPath, issue.id, ["missing"])).rejects.toThrow(/label/i);
    expect((await getIssueCollaborationMetadata(dbPath, issue.id)).labels).toEqual([]);
    await expect(replaceIssueAssignees(dbPath, 999, ["bob"], "owner")).rejects.toThrow(/issue/i);
    await expect(setIssueSubscription(dbPath, 999, "bob", true)).rejects.toThrow(/issue/i);
  });

  it("manages custom label definitions without reserved type labels", async () => {
    await createIssueLabel(dbPath, {
      id: "priority-high",
      name: "高优先级",
      color: "b60205",
      description: "需要尽快处理",
    });
    await updateIssueLabel(dbPath, "priority-high", {
      name: "紧急",
      color: "e99695",
      description: "立即处理",
    });
    expect(await listIssueLabels(dbPath)).toContainEqual(expect.objectContaining({
      id: "priority-high",
      name: "紧急",
      color: "e99695",
      description: "立即处理",
      built_in: 0,
    }));

    expect(await updateIssueLabel(dbPath, "bug", { name: "Changed" })).toBeNull();
    expect(await deleteIssueLabel(dbPath, "bug")).toBe(false);
    expect(await deleteIssueLabel(dbPath, "priority-high")).toBe(true);
    expect((await listIssueLabels(dbPath)).map(({ id }) => id)).not.toContain("priority-high");
  });

  it("manages milestones with progress and idempotent schema migration", async () => {
    await ensureIssueTables(dbPath);
    await ensureIssueTables(dbPath);
    const milestone = await createIssueMilestone(dbPath, {
      title: "v1.0",
      description: "First stable release",
      dueOn: "2026-08-01",
      createdBy: "owner",
    });
    const openIssue = await insertIssue(dbPath, "Open work", "", "feature", "alice");
    const closedIssue = await insertIssue(dbPath, "Done work", "", "bug", "bob");
    await setIssueMilestone(dbPath, openIssue.id, milestone.id);
    await setIssueMilestone(dbPath, closedIssue.id, milestone.id);
    const db = await getConnection(dbPath);
    db.run("UPDATE _issues SET status = 'closed' WHERE id = ?", [closedIssue.id]);

    expect(await listIssueMilestones(dbPath)).toEqual([
      expect.objectContaining({
        id: milestone.id,
        title: "v1.0",
        description: "First stable release",
        due_on: "2026-08-01",
        state: "open",
        open_issues: 1,
        closed_issues: 1,
      }),
    ]);
    expect((await listIssues(dbPath, { milestone: milestone.id })).data.map(({ id }) => id).sort()).toEqual([openIssue.id, closedIssue.id].sort());
    expect((await listIssues(dbPath, { milestone: "none" })).meta.total).toBe(0);
  });

  it("updates milestones, rejects duplicate titles, and clears Issue links on delete", async () => {
    const milestone = await createIssueMilestone(dbPath, { title: "Sprint 1", createdBy: "owner" });
    const issue = await insertIssue(dbPath, "Scoped work", "", "bug", "alice");
    await setIssueMilestone(dbPath, issue.id, milestone.id);

    await expect(createIssueMilestone(dbPath, { title: "Sprint 1", createdBy: "owner" })).rejects.toThrow();
    await updateIssueMilestone(dbPath, milestone.id, { title: "Sprint 01", state: "closed", dueOn: null });
    expect(await listIssueMilestones(dbPath)).toContainEqual(expect.objectContaining({ title: "Sprint 01", state: "closed", due_on: null }));
    await expect(setIssueMilestone(dbPath, issue.id, 999)).rejects.toThrow(/milestone/i);

    expect(await deleteIssueMilestone(dbPath, milestone.id)).toBe(true);
    expect((await listIssues(dbPath, { milestone: "none" })).data).toContainEqual(expect.objectContaining({ id: issue.id, milestone_id: null }));
  });
});
