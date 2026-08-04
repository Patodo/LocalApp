import { describe, expect, it } from "vitest";
import { referenceIssueComment } from "./issue-comment-reference";

describe("referenceIssueComment", () => {
  it("creates a quote with source and permalink", () => {
    expect(referenceIssueComment("第一行\n\n第二行", "alice", 12, "/issue#comment")).toBe("> 第一行\n> \n> 第二行\n\n来源：#12\n\n[查看 @alice 的原评论](/issue#comment)");
  });

  it("removes attachment markdown and uses a private fallback", () => {
    const result = referenceIssueComment("![secret.png](/api/issues/attachments/private-id)", "alice", 12, "/issue#comment");
    expect(result).toContain("> @alice 的附件评论");
    expect(result).not.toContain("private-id");
  });

  it("caps excerpts by Unicode characters", () => {
    const result = referenceIssueComment("😀".repeat(501), "alice", 12, "/issue#comment");
    expect(result.split("\n\n来源：", 1)[0]).toBe(`> ${"😀".repeat(499)}…`);
  });
});
