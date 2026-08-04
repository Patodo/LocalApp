import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  closeAllConnections,
  deleteIssue,
  extractIssueReferenceNumbers,
  getIssueDetail,
  insertIssue,
  insertIssueComment,
  reconcileIssueCrossReferences,
} from "../app-db.js";

describe("Issue cross references", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "localapp-issue-cross-references-"));
    dbPath = path.join(tempDir, "app.db");
  });

  afterEach(() => {
    closeAllConnections();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("extracts unique prose references while ignoring code and escapes", () => {
    expect(extractIssueReferenceNumbers([
      "Related to #12 and #12.",
      "`ignore #13` and \\#14",
      "```ts",
      "const issue = '#15'",
      "```",
      "Keep #16.",
    ].join("\n"))).toEqual([12, 16]);
  });

  it("projects one navigable target timeline item for a comment reference", async () => {
    const source = await insertIssue(dbPath, "Source discussion", "", "bug", "alice");
    const target = await insertIssue(dbPath, "Target issue", "", "bug", "bob");
    const comment = await insertIssueComment(dbPath, source.id, `Observed while working on #${target.issueNumber}. More context follows.`, "alice");

    const result = await reconcileIssueCrossReferences(dbPath, {
      sourceIssueId: source.id,
      sourceType: "comment",
      sourceId: comment.id,
      actorId: "alice",
      markdown: comment.body,
    });

    expect(result).toEqual({ addedTargetIssueIds: [target.id], removedTargetIssueIds: [] });
    const reference = (await getIssueDetail(dbPath, target.id))?.timeline.find((item) => item.kind === "cross_reference");
    expect(reference).toMatchObject({
      kind: "cross_reference",
      crossReference: {
        actor_id: "alice",
        source_issue_id: source.id,
        source_issue_number: source.issueNumber,
        source_issue_title: "Source discussion",
        source_comment_id: comment.id,
      },
    });
    expect(reference?.kind === "cross_reference" && reference.crossReference.excerpt).toContain(`#${target.issueNumber}`);
  });

  it("deduplicates targets and removes stale references when source content changes", async () => {
    const source = await insertIssue(dbPath, "Source", "", "bug", "alice");
    const target = await insertIssue(dbPath, "Target", "", "bug", "bob");
    const markdown = `#${source.issueNumber} #${target.issueNumber} #9999 #${target.issueNumber}`;
    await reconcileIssueCrossReferences(dbPath, { sourceIssueId: source.id, sourceType: "issue", sourceId: source.id, actorId: "alice", markdown });
    expect((await getIssueDetail(dbPath, target.id))?.timeline.filter((item) => item.kind === "cross_reference")).toHaveLength(1);

    const removed = await reconcileIssueCrossReferences(dbPath, { sourceIssueId: source.id, sourceType: "issue", sourceId: source.id, actorId: "alice", markdown: "No longer related." });
    expect(removed).toEqual({ addedTargetIssueIds: [], removedTargetIssueIds: [target.id] });
    expect((await getIssueDetail(dbPath, target.id))?.timeline.filter((item) => item.kind === "cross_reference")).toHaveLength(0);
  });

  it("cleans inbound and outbound references when either Issue is deleted", async () => {
    const source = await insertIssue(dbPath, "Source", "", "bug", "alice");
    const target = await insertIssue(dbPath, "Target", "", "bug", "bob");
    await reconcileIssueCrossReferences(dbPath, { sourceIssueId: source.id, sourceType: "issue", sourceId: source.id, actorId: "alice", markdown: `See #${target.issueNumber}` });
    await deleteIssue(dbPath, source.id);
    expect((await getIssueDetail(dbPath, target.id))?.timeline.filter((item) => item.kind === "cross_reference")).toHaveLength(0);
  });
});
