import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addIssueDependency,
  closeAllConnections,
  deleteIssue,
  getIssueDetail,
  insertIssue,
  listIssues,
  MAX_ISSUE_DEPENDENCIES,
  removeIssueDependency,
  updateIssue,
} from "../app-db.js";

describe("Issue dependencies", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-dependencies-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns both directions, unresolved blocker state, and audit events", async () => {
    const blocked = await insertIssue(dbPath, "Blocked work", "", "feature", "alice");
    const blocker = await insertIssue(dbPath, "Blocking work", "", "bug", "bob");

    expect(await addIssueDependency(dbPath, blocked.id, blocker.id, "owner")).toBe("added");
    const blockedDetail = await getIssueDetail(dbPath, blocked.id);
    const blockerDetail = await getIssueDetail(dbPath, blocker.id);
    expect(blockedDetail?.blockedBy.map((issue) => issue.id)).toEqual([blocker.id]);
    expect(blockerDetail?.blocking.map((issue) => issue.id)).toEqual([blocked.id]);
    expect(blockedDetail?.dependencySummary).toEqual({ blockedBy: 1, blocking: 0, unresolvedBlockers: 1, isBlocked: true });
    expect((await listIssues(dbPath)).data.find((issue) => issue.id === blocked.id)?.is_blocked).toBe(1);
    expect(blockedDetail?.timeline.some((item) => item.kind === "event" && item.event.event_type === "dependency_blocked_by_added")).toBe(true);
    expect(blockerDetail?.timeline.some((item) => item.kind === "event" && item.event.event_type === "dependency_blocking_added")).toBe(true);

    await updateIssue(dbPath, blocker.id, { status: "closed", stateReason: "completed" });
    expect((await getIssueDetail(dbPath, blocked.id))?.dependencySummary).toEqual({ blockedBy: 1, blocking: 0, unresolvedBlockers: 0, isBlocked: false });
    expect((await listIssues(dbPath)).data.find((issue) => issue.id === blocked.id)?.is_blocked).toBe(0);

    expect(await removeIssueDependency(dbPath, blocked.id, blocker.id, "owner")).toBe("removed");
    expect((await getIssueDetail(dbPath, blocked.id))?.blockedBy).toEqual([]);
  });

  it("rejects self references, duplicates, and dependency cycles without partial events", async () => {
    const first = await insertIssue(dbPath, "First", "", "bug", "owner");
    const second = await insertIssue(dbPath, "Second", "", "bug", "owner");
    const third = await insertIssue(dbPath, "Third", "", "bug", "owner");

    expect(await addIssueDependency(dbPath, first.id, first.id, "owner")).toBe("self_reference");
    expect(await addIssueDependency(dbPath, second.id, first.id, "owner")).toBe("added");
    expect(await addIssueDependency(dbPath, second.id, first.id, "owner")).toBe("duplicate");
    expect(await addIssueDependency(dbPath, third.id, second.id, "owner")).toBe("added");
    expect(await addIssueDependency(dbPath, first.id, third.id, "owner")).toBe("cycle");

    expect((await getIssueDetail(dbPath, first.id))?.blockedBy).toEqual([]);
    expect((await getIssueDetail(dbPath, first.id))?.timeline.filter((item) => item.kind === "event" && item.event.event_type.includes("dependency"))).toHaveLength(1);
  });

  it("cleans relationships when either endpoint is deleted without deleting the other Issue", async () => {
    const blocked = await insertIssue(dbPath, "Disposable", "", "bug", "owner");
    const blocker = await insertIssue(dbPath, "Persistent", "", "bug", "owner");
    await addIssueDependency(dbPath, blocked.id, blocker.id, "owner");

    expect(await deleteIssue(dbPath, blocked.id)).toEqual([]);
    const blockerDetail = await getIssueDetail(dbPath, blocker.id);
    expect(blockerDetail?.issue.title).toBe("Persistent");
    expect(blockerDetail?.blocking).toEqual([]);
  });

  it("enforces the direct dependency limit under concurrent requests", async () => {
    const blocked = await insertIssue(dbPath, "Large blocked work", "", "feature", "owner");
    const blockers = [];
    for (let index = 0; index < MAX_ISSUE_DEPENDENCIES + 1; index += 1) {
      blockers.push(await insertIssue(dbPath, `Blocker ${index + 1}`, "", "bug", "owner"));
    }
    for (const blocker of blockers.slice(0, MAX_ISSUE_DEPENDENCIES - 1)) {
      expect(await addIssueDependency(dbPath, blocked.id, blocker.id, "owner")).toBe("added");
    }
    const concurrent = await Promise.all([
      addIssueDependency(dbPath, blocked.id, blockers[MAX_ISSUE_DEPENDENCIES - 1].id, "owner"),
      addIssueDependency(dbPath, blocked.id, blockers[MAX_ISSUE_DEPENDENCIES].id, "owner"),
    ]);
    expect(concurrent.sort()).toEqual(["added", "limit"]);
    expect((await getIssueDetail(dbPath, blocked.id))?.blockedBy).toHaveLength(MAX_ISSUE_DEPENDENCIES);
  });
});
