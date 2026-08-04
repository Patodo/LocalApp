import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeAllConnections,
  getIssueDetail,
  insertIssue,
  insertIssueDuplicateComment,
  listIssues,
  parseIssueDuplicateReference,
  unmarkIssueDuplicate,
} from "../app-db.js";

describe("Issue duplicates", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-duplicates-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("parses only a standalone new-comment keyword line", () => {
    expect(parseIssueDuplicateReference("Duplicate of #42")).toBe(42);
    expect(parseIssueDuplicateReference("Context\n  duplicate OF #7  \nThanks")).toBe(7);
    expect(parseIssueDuplicateReference("> Duplicate of #7")).toBeNull();
    expect(parseIssueDuplicateReference("Duplicate of owner/app#7")).toBeNull();
    expect(parseIssueDuplicateReference("This is Duplicate of #7 maybe")).toBeNull();
  });

  it("atomically inserts the comment, relation and dual detail events", async () => {
    const duplicate = await insertIssue(dbPath, "Duplicate", "", "bug", "alice");
    const canonical = await insertIssue(dbPath, "Canonical", "", "bug", "bob");
    const result = await insertIssueDuplicateComment(dbPath, {
      duplicateIssueId: duplicate.id,
      canonicalIssueNumber: canonical.issueNumber,
      actorId: "owner",
      body: `Duplicate of #${canonical.issueNumber}`,
    });
    expect(result).toMatchObject({ status: "created", comment: { body: `Duplicate of #${canonical.issueNumber}` } });
    expect((await getIssueDetail(dbPath, duplicate.id))?.duplicateOf?.id).toBe(canonical.id);
    expect((await getIssueDetail(dbPath, canonical.id))?.duplicates.map((issue) => issue.id)).toEqual([duplicate.id]);
    expect((await listIssues(dbPath)).data.find((issue) => issue.id === duplicate.id)?.is_duplicate).toBe(1);
    expect((await listIssues(dbPath)).data.find((issue) => issue.id === canonical.id)?.is_duplicate).toBe(0);
    expect((await getIssueDetail(dbPath, duplicate.id))?.timeline.some((item) => item.kind === "event" && item.event.event_type === "marked_as_duplicate")).toBe(true);
  });

  it("rejects unsafe chains and self references without leaving comments", async () => {
    const first = await insertIssue(dbPath, "First", "", "bug", "owner");
    const second = await insertIssue(dbPath, "Second", "", "bug", "owner");
    const third = await insertIssue(dbPath, "Third", "", "bug", "owner");
    expect((await insertIssueDuplicateComment(dbPath, { duplicateIssueId: first.id, canonicalIssueNumber: first.issueNumber, actorId: "owner", body: `Duplicate of #${first.issueNumber}` })).status).toBe("self_reference");
    expect((await insertIssueDuplicateComment(dbPath, { duplicateIssueId: first.id, canonicalIssueNumber: second.issueNumber, actorId: "owner", body: `Duplicate of #${second.issueNumber}` })).status).toBe("created");
    expect((await insertIssueDuplicateComment(dbPath, { duplicateIssueId: third.id, canonicalIssueNumber: first.issueNumber, actorId: "owner", body: `Duplicate of #${first.issueNumber}` })).status).toBe("canonical_is_duplicate");
    expect((await getIssueDetail(dbPath, third.id))?.timeline.filter((item) => item.kind === "comment")).toHaveLength(0);
  });

  it("unmarks the current relation while retaining comment and audit history", async () => {
    const duplicate = await insertIssue(dbPath, "Duplicate", "", "bug", "owner");
    const canonical = await insertIssue(dbPath, "Canonical", "", "bug", "owner");
    await insertIssueDuplicateComment(dbPath, { duplicateIssueId: duplicate.id, canonicalIssueNumber: canonical.issueNumber, actorId: "owner", body: `Duplicate of #${canonical.issueNumber}` });
    expect(await unmarkIssueDuplicate(dbPath, duplicate.id, canonical.id, "owner")).toBe("removed");
    const detail = await getIssueDetail(dbPath, duplicate.id);
    expect(detail?.duplicateOf).toBeNull();
    expect(detail?.timeline.filter((item) => item.kind === "comment")).toHaveLength(1);
    expect(detail?.timeline.some((item) => item.kind === "event" && item.event.event_type === "unmarked_as_duplicate")).toBe(true);
    expect(await unmarkIssueDuplicate(dbPath, duplicate.id, canonical.id, "owner")).toBe("not_found");
  });
});
