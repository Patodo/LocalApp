import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectConvertibleIssueTasks,
  replaceIssueTaskContent,
} from "../issue-task-conversion.js";
import {
  addIssueSubIssue,
  closeAllConnections,
  convertIssueTaskToSubIssue,
  getIssueById,
  getIssueDetail,
  getNextIssueNumber,
  insertIssue,
} from "../app-db.js";

describe("Issue task conversion", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-task-conversion-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("locates GFM tasks in source order while ignoring fenced code", () => {
    const markdown = [
      "- [ ] First task",
      "  1. [x] **Finished** task",
      "```md",
      "- [ ] Not a task",
      "```",
      "+ [ ] [Linked title](https://example.test)",
    ].join("\n");

    expect(collectConvertibleIssueTasks(markdown)).toEqual([
      expect.objectContaining({ index: 0, checked: false, title: "First task", convertible: true }),
      expect.objectContaining({ index: 1, checked: true, title: "Finished task", convertible: false }),
      expect.objectContaining({ index: 2, checked: false, title: "Linked title", convertible: true }),
    ]);
  });

  it("rejects empty and pure Issue-reference tasks without changing their stable indexes", () => {
    const tasks = collectConvertibleIssueTasks("- [ ]   \n- [ ] #42\n- [ ] Do the work");

    expect(tasks).toMatchObject([
      { index: 0, title: "", convertible: false },
      { index: 1, title: "#42", convertible: false },
      { index: 2, title: "Do the work", convertible: true },
    ]);
  });

  it("replaces only task content and preserves marker, indentation, and CRLF", () => {
    const markdown = "Intro\r\n  - [ ] **Build** the API  \r\nOutro\r\n";

    expect(replaceIssueTaskContent(markdown, 0, "#17")).toBe("Intro\r\n  - [ ] #17  \r\nOutro\r\n");
  });

  it("refuses completed, invalid, and missing task targets", () => {
    expect(() => replaceIssueTaskContent("- [x] Done", 0, "#2")).toThrow("issue_task_not_convertible");
    expect(() => replaceIssueTaskContent("- [ ] #2", 0, "#3")).toThrow("issue_task_not_convertible");
    expect(() => replaceIssueTaskContent("- [ ] Ready", 1, "#3")).toThrow("issue_task_not_found");
  });

  it("atomically creates a child, replaces the task, and records revision and audit", async () => {
    const parent = await insertIssue(dbPath, "Parent", "Before\n- [ ] **Build** the API\nAfter", "feature", "owner");
    const before = await getIssueById(dbPath, parent.id);

    const result = await convertIssueTaskToSubIssue(dbPath, {
      parentIssueId: parent.id,
      taskIndex: 0,
      expectedUpdatedAt: before!.updated_at,
      actorId: "owner",
    });

    expect(result).toMatchObject({ status: "converted", childIssueNumber: 2, title: "Build the API" });
    const detail = await getIssueDetail(dbPath, parent.id);
    expect(detail?.issue.description).toBe("Before\n- [ ] #2\nAfter");
    expect(detail?.subIssues).toHaveLength(1);
    expect(detail?.subIssues[0]).toMatchObject({ issue_number: 2, title: "Build the API", reporter_id: "owner" });
    expect(detail?.issue.revision_count).toBe(1);
    expect(detail?.timeline.some((item) => item.kind === "event" && item.event.event_type === "task_converted_to_sub_issue")).toBe(true);
  });

  it("does not write anything when the parent content version is stale", async () => {
    const parent = await insertIssue(dbPath, "Parent", "- [ ] Build it", "feature", "owner");

    expect(await convertIssueTaskToSubIssue(dbPath, {
      parentIssueId: parent.id,
      taskIndex: 0,
      expectedUpdatedAt: "stale",
      actorId: "owner",
    })).toEqual({ status: "content_conflict" });
    expect(await getNextIssueNumber(dbPath)).toBe(2);
    expect((await getIssueDetail(dbPath, parent.id))?.subIssues).toEqual([]);
  });

  it("rolls back the allocated child when the hierarchy depth rejects the relation", async () => {
    const chain = [];
    for (let index = 0; index < 8; index += 1) {
      chain.push(await insertIssue(dbPath, `Level ${index + 1}`, index === 7 ? "- [ ] Too deep" : "", "feature", "owner"));
      if (index > 0) expect(await addIssueSubIssue(dbPath, chain[index - 1].id, chain[index].id, "owner")).toBe("added");
    }
    const leaf = await getIssueById(dbPath, chain[7].id);
    const nextBefore = await getNextIssueNumber(dbPath);

    expect(await convertIssueTaskToSubIssue(dbPath, {
      parentIssueId: chain[7].id,
      taskIndex: 0,
      expectedUpdatedAt: leaf!.updated_at,
      actorId: "owner",
    })).toEqual({ status: "relation_conflict", reason: "depth" });
    expect(await getNextIssueNumber(dbPath)).toBe(nextBefore);
    expect((await getIssueDetail(dbPath, chain[7].id))?.subIssues).toEqual([]);
  });
});
