import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addIssueSubIssue,
  closeAllConnections,
  deleteIssue,
  execRawSql,
  getIssueDetail,
  insertIssue,
  listIssueAncestorIds,
  listIssueSubIssues,
  removeIssueSubIssue,
  reprioritizeIssueSubIssue,
  updateIssue,
} from "../app-db.js";

describe("Issue sub-issues", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-sub-issues-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns ordered children, parent navigation, progress, and audit events", async () => {
    const parent = await insertIssue(dbPath, "Parent", "", "feature", "alice");
    const first = await insertIssue(dbPath, "First child", "", "bug", "bob");
    const second = await insertIssue(dbPath, "Second child", "", "bug", "carol");

    expect(await addIssueSubIssue(dbPath, parent.id, first.id, "owner")).toBe("added");
    expect(await addIssueSubIssue(dbPath, parent.id, second.id, "owner")).toBe("added");
    await updateIssue(dbPath, first.id, { status: "closed", stateReason: "completed" });

    const parentDetail = await getIssueDetail(dbPath, parent.id);
    expect(parentDetail?.subIssues.map((issue) => issue.id)).toEqual([first.id, second.id]);
    expect(parentDetail?.subIssueSummary).toEqual({ total: 2, completed: 1, percent: 50 });
    expect((await getIssueDetail(dbPath, first.id))?.parent?.id).toBe(parent.id);
    expect(parentDetail?.timeline.some((item) => item.kind === "event" && item.event.event_type === "sub_issue_added")).toBe(true);

    expect(await removeIssueSubIssue(dbPath, parent.id, first.id, "owner")).toBe("removed");
    expect((await getIssueDetail(dbPath, first.id))?.parent).toBeNull();
    expect((await getIssueDetail(dbPath, parent.id))?.subIssueSummary).toEqual({ total: 1, completed: 0, percent: 0 });
  });

  it("rejects self references, duplicates, second parents, and cycles without partial events", async () => {
    const root = await insertIssue(dbPath, "Root", "", "feature", "alice");
    const child = await insertIssue(dbPath, "Child", "", "bug", "bob");
    const other = await insertIssue(dbPath, "Other", "", "bug", "carol");

    expect(await addIssueSubIssue(dbPath, root.id, root.id, "owner")).toBe("self_reference");
    expect(await addIssueSubIssue(dbPath, root.id, child.id, "owner")).toBe("added");
    expect(await addIssueSubIssue(dbPath, root.id, child.id, "owner")).toBe("duplicate");
    expect(await addIssueSubIssue(dbPath, other.id, child.id, "owner")).toBe("has_parent");
    expect(await addIssueSubIssue(dbPath, child.id, root.id, "owner")).toBe("cycle");

    expect((await getIssueDetail(dbPath, root.id))?.subIssues.map((issue) => issue.id)).toEqual([child.id]);
    expect((await getIssueDetail(dbPath, other.id))?.subIssues).toEqual([]);
    expect((await getIssueDetail(dbPath, root.id))?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "sub_issue_added")).toHaveLength(1);
  });

  it("enforces eight hierarchy levels", async () => {
    const issues = [];
    for (let index = 0; index < 9; index += 1) issues.push(await insertIssue(dbPath, `Level ${index + 1}`, "", "bug", "owner"));
    for (let index = 0; index < 7; index += 1) {
      expect(await addIssueSubIssue(dbPath, issues[index].id, issues[index + 1].id, "owner")).toBe("added");
    }
    expect(await addIssueSubIssue(dbPath, issues[7].id, issues[8].id, "owner")).toBe("depth");
    expect((await getIssueDetail(dbPath, issues[8].id))?.parent).toBeNull();
  });

  it("enforces the direct child limit under concurrent requests", async () => {
    const parent = await insertIssue(dbPath, "Large parent", "", "feature", "owner");
    const children = [];
    for (let index = 0; index < 101; index += 1) children.push(await insertIssue(dbPath, `Child ${index + 1}`, "", "bug", "owner"));
    for (const child of children.slice(0, 99)) expect(await addIssueSubIssue(dbPath, parent.id, child.id, "owner")).toBe("added");

    const concurrent = await Promise.all([
      addIssueSubIssue(dbPath, parent.id, children[99].id, "owner"),
      addIssueSubIssue(dbPath, parent.id, children[100].id, "owner"),
    ]);
    expect(concurrent.sort()).toEqual(["added", "limit"]);
    expect((await getIssueDetail(dbPath, parent.id))?.subIssues).toHaveLength(100);
  });

  it("removes relationships without deleting the other Issue", async () => {
    const parent = await insertIssue(dbPath, "Disposable parent", "", "feature", "owner");
    const child = await insertIssue(dbPath, "Persistent child", "", "bug", "owner");
    await addIssueSubIssue(dbPath, parent.id, child.id, "owner");

    expect(await deleteIssue(dbPath, parent.id)).toEqual([]);
    const childDetail = await getIssueDetail(dbPath, child.id);
    expect(childDetail?.issue.title).toBe("Persistent child");
    expect(childDetail?.parent).toBeNull();
  });

  it("reprioritizes children at the start or after a sibling and compacts positions", async () => {
    const parent = await insertIssue(dbPath, "Parent", "", "feature", "owner");
    const children = await Promise.all(["A", "B", "C", "D"].map((title) => insertIssue(dbPath, title, "", "bug", "owner")));
    for (const child of children) await addIssueSubIssue(dbPath, parent.id, child.id, "owner");

    expect(await reprioritizeIssueSubIssue(dbPath, parent.id, children[3].id, null, "owner")).toBe("reordered");
    expect((await getIssueDetail(dbPath, parent.id))?.subIssues.map((item) => [item.id, item.position])).toEqual([
      [children[3].id, 0], [children[0].id, 1], [children[1].id, 2], [children[2].id, 3],
    ]);
    expect(await reprioritizeIssueSubIssue(dbPath, parent.id, children[0].id, children[1].id, "owner")).toBe("reordered");
    const detail = await getIssueDetail(dbPath, parent.id);
    expect(detail?.subIssues.map((item) => item.id)).toEqual([children[3].id, children[1].id, children[0].id, children[2].id]);
    expect(detail?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "sub_issue_reordered")).toHaveLength(2);
    expect(await reprioritizeIssueSubIssue(dbPath, parent.id, children[0].id, children[1].id, "owner")).toBe("unchanged");
    expect((await getIssueDetail(dbPath, parent.id))?.timeline.filter((item) => item.kind === "event" && item.event.event_type === "sub_issue_reordered")).toHaveLength(2);
  });

  it("rejects invalid reprioritize targets without changing either parent", async () => {
    const firstParent = await insertIssue(dbPath, "First parent", "", "feature", "owner");
    const secondParent = await insertIssue(dbPath, "Second parent", "", "feature", "owner");
    const first = await insertIssue(dbPath, "First", "", "bug", "owner");
    const second = await insertIssue(dbPath, "Second", "", "bug", "owner");
    const foreign = await insertIssue(dbPath, "Foreign", "", "bug", "owner");
    await addIssueSubIssue(dbPath, firstParent.id, first.id, "owner");
    await addIssueSubIssue(dbPath, firstParent.id, second.id, "owner");
    await addIssueSubIssue(dbPath, secondParent.id, foreign.id, "owner");

    expect(await reprioritizeIssueSubIssue(dbPath, firstParent.id, first.id, first.id, "owner")).toBe("self_after");
    expect(await reprioritizeIssueSubIssue(dbPath, firstParent.id, foreign.id, null, "owner")).toBe("child_not_found");
    expect(await reprioritizeIssueSubIssue(dbPath, firstParent.id, first.id, foreign.id, "owner")).toBe("after_not_found");
    expect((await getIssueDetail(dbPath, firstParent.id))?.subIssues.map((item) => item.id)).toEqual([first.id, second.id]);
    expect((await getIssueDetail(dbPath, secondParent.id))?.subIssues.map((item) => item.id)).toEqual([foreign.id]);
  });

  it("preserves concurrent additions and compacts positions after removal", async () => {
    const parent = await insertIssue(dbPath, "Concurrent parent", "", "feature", "owner");
    const children = await Promise.all(["A", "B", "C", "D"].map((title) => insertIssue(dbPath, title, "", "bug", "owner")));
    for (const child of children.slice(0, 3)) await addIssueSubIssue(dbPath, parent.id, child.id, "owner");

    await Promise.all([
      addIssueSubIssue(dbPath, parent.id, children[3].id, "owner"),
      reprioritizeIssueSubIssue(dbPath, parent.id, children[2].id, null, "owner"),
    ]);
    let items = (await getIssueDetail(dbPath, parent.id))!.subIssues;
    expect(items.map((item) => item.id)).toEqual([children[2].id, children[0].id, children[1].id, children[3].id]);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2, 3]);

    expect(await removeIssueSubIssue(dbPath, parent.id, children[0].id, "owner")).toBe("removed");
    items = (await getIssueDetail(dbPath, parent.id))!.subIssues;
    expect(items.map((item) => item.id)).toEqual([children[2].id, children[1].id, children[3].id]);
    expect(items.map((item) => item.position)).toEqual([0, 1, 2]);
  });

  it("returns lightweight direct children summaries and ordered ancestor ids", async () => {
    const root = await insertIssue(dbPath, "Root", "", "feature", "owner");
    const child = await insertIssue(dbPath, "Child", "", "bug", "owner");
    const sibling = await insertIssue(dbPath, "Sibling", "", "bug", "owner");
    const grandchild = await insertIssue(dbPath, "Grandchild", "", "bug", "owner");
    const completed = await insertIssue(dbPath, "Completed grandchild", "", "bug", "owner");
    await addIssueSubIssue(dbPath, root.id, child.id, "owner");
    await addIssueSubIssue(dbPath, root.id, sibling.id, "owner");
    await addIssueSubIssue(dbPath, child.id, grandchild.id, "owner");
    await addIssueSubIssue(dbPath, child.id, completed.id, "owner");
    await updateIssue(dbPath, completed.id, { status: "closed", stateReason: "completed" });

    const rootChildren = await listIssueSubIssues(dbPath, root.id);
    expect(rootChildren.summary).toEqual({ total: 2, completed: 0, percent: 0 });
    expect(rootChildren.items.map((item) => [item.id, item.child_count, item.completed_child_count, item.child_percent])).toEqual([
      [child.id, 2, 1, 50], [sibling.id, 0, 0, 0],
    ]);
    expect((await listIssueSubIssues(dbPath, child.id)).items.map((item) => item.id)).toEqual([grandchild.id, completed.id]);
    expect(await listIssueAncestorIds(dbPath, grandchild.id)).toEqual([child.id, root.id]);
  });

  it("terminates ancestor traversal when corrupted data contains a cycle", async () => {
    const root = await insertIssue(dbPath, "Cycle root", "", "feature", "owner");
    const child = await insertIssue(dbPath, "Cycle child", "", "bug", "owner");
    await addIssueSubIssue(dbPath, root.id, child.id, "owner");
    await execRawSql(dbPath, `INSERT INTO _issue_sub_issues (parent_issue_id, child_issue_id, position, added_by, created_at) VALUES (${child.id}, ${root.id}, 0, 'corrupt', '2026-07-12T00:00:00.000Z')`);
    expect(await listIssueAncestorIds(dbPath, child.id)).toEqual([root.id]);
  });
});
