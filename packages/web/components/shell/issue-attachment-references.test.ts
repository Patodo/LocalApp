import { describe, expect, it } from "vitest";
import { filterUnreferencedIssueAttachments } from "./issue-attachment-references";
import type { IssueAttachment } from "./issue-types";

function attachment(id: string): IssueAttachment {
  return { id, url: `/api/issues/attachments/${id}?pagePath=owner%2Fresearch`, issue_id: 12, comment_id: null, draft_id: "draft", uploader_id: "alice", file_name: `${id}.png`, mime_type: "image/png", size_bytes: 10, created_at: "2026-07-12T00:00:00.000Z" };
}

describe("filterUnreferencedIssueAttachments", () => {
  it("filters image and link references in nested source order", () => {
    const attachments = [attachment("screen"), attachment("report"), attachment("orphan")];
    const markdown = "![截图](/api/issues/attachments/screen?pagePath=owner%2Fresearch)\n\n- [报告](/api/issues/attachments/report?pagePath=owner%2Fresearch)";
    expect(filterUnreferencedIssueAttachments(markdown, attachments).map((item) => item.id)).toEqual(["orphan"]);
  });

  it("does not treat plain text or code as rendered attachment references", () => {
    const item = attachment("screen");
    const markdown = "`/api/issues/attachments/screen?pagePath=owner%2Fresearch`\n\n```text\n/api/issues/attachments/screen?pagePath=owner%2Fresearch\n```";
    expect(filterUnreferencedIssueAttachments(markdown, [item])).toEqual([item]);
  });
});
