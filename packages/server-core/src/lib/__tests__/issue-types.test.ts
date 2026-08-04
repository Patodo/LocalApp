import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeAllConnections,
  createIssueLabel,
  ensureIssueTables,
  getConnection,
  getIssueDetail,
  insertIssue,
  isIssueType,
  listIssueLabels,
  listIssues,
  replaceIssueLabels,
  updateIssue,
} from "../app-db.js";

describe("Issue types", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-types-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("recognizes exactly the three public Issue types", () => {
    expect(["task", "bug", "feature"].every(isIssueType)).toBe(true);
    expect(["", "request", "Bug", null].some(isIssueType)).toBe(false);
  });

  it("migrates legacy classifications without retaining built-in label relations", async () => {
    const db = await getConnection(dbPath);
    db.run(`CREATE TABLE _issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT, issue_number INTEGER NOT NULL, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', label TEXT NOT NULL DEFAULT 'bug',
      reporter_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    )`);
    db.run("INSERT INTO _issues (issue_number, title, label, reporter_id, created_at, updated_at) VALUES (1, 'Legacy bug', 'bug', 'owner', '2026-01-01', '2026-01-01'), (2, 'Legacy feature', 'feature', 'owner', '2026-01-01', '2026-01-01')");
    db.run("CREATE TABLE _issue_labels (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', built_in INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    db.run("CREATE TABLE _issue_label_links (issue_id INTEGER NOT NULL, label_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (issue_id, label_id))");
    db.run("INSERT INTO _issue_labels VALUES ('bug', '缺陷', 'd73a4a', '', 1, '2026-01-01', '2026-01-01'), ('feature', '需求', 'a2eeef', '', 1, '2026-01-01', '2026-01-01'), ('urgent', '紧急', 'ff0000', '', 0, '2026-01-01', '2026-01-01')");
    db.run("INSERT INTO _issue_label_links VALUES (1, 'bug', '2026-01-01'), (1, 'urgent', '2026-01-01'), (2, 'feature', '2026-01-01')");

    await ensureIssueTables(dbPath);

    expect((await listIssues(dbPath, { issueType: "bug" })).data).toEqual([expect.objectContaining({ title: "Legacy bug", issue_type: "bug" })]);
    expect((await listIssues(dbPath, { issueType: "feature" })).data).toEqual([expect.objectContaining({ title: "Legacy feature", issue_type: "feature" })]);
    expect((await listIssueLabels(dbPath)).map((label) => label.id)).toEqual(["urgent"]);
    expect((await getIssueDetail(dbPath, 1))?.collaboration.labels.map((label) => label.id)).toEqual(["urgent"]);
  });

  it("defaults new Issues to task and filters types independently from labels", async () => {
    await createIssueLabel(dbPath, { id: "urgent", name: "紧急", color: "ff0000", description: "" });
    const task = await insertIssue(dbPath, "Task", "", "task", "owner");
    const bug = await insertIssue(dbPath, "Bug", "", "bug", "owner");
    const feature = await insertIssue(dbPath, "Feature", "", "feature", "owner");
    await replaceIssueLabels(dbPath, bug.id, ["urgent"]);

    expect((await listIssues(dbPath, { issueType: "task" })).data.map((issue) => issue.id)).toEqual([task.id]);
    expect((await listIssues(dbPath, { issueType: "bug", label: "urgent" })).data.map((issue) => issue.id)).toEqual([bug.id]);
    expect((await listIssues(dbPath, { issueType: "feature", label: "urgent" })).meta.total).toBe(0);
    expect((await getIssueDetail(dbPath, feature.id))?.issue).toMatchObject({ issue_type: "feature" });
  });

  it("updates type without changing custom labels", async () => {
    await createIssueLabel(dbPath, { id: "urgent", name: "紧急", color: "ff0000", description: "" });
    const issue = await insertIssue(dbPath, "Typed", "", "task", "owner");
    await replaceIssueLabels(dbPath, issue.id, ["urgent"]);
    await updateIssue(dbPath, issue.id, { issueType: "bug" });

    expect((await getIssueDetail(dbPath, issue.id))?.issue.issue_type).toBe("bug");
    expect((await getIssueDetail(dbPath, issue.id))?.collaboration.labels.map((label) => label.id)).toEqual(["urgent"]);
  });
});
