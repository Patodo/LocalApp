import { describe, expect, it } from "vitest";
import { applyIssueMention, findIssueMentionQuery } from "./issue-mention";

describe("Issue mention editing", () => {
  it("finds only the token containing the caret", () => {
    expect(findIssueMentionQuery("Hello @ali world", 10)).toEqual({ start: 6, end: 10, query: "ali" });
    expect(findIssueMentionQuery("Hello @ali world", 16)).toBeNull();
    expect(findIssueMentionQuery("mail@example.com", 16)).toBeNull();
    expect(findIssueMentionQuery("path/@alice", 11)).toBeNull();
    expect(findIssueMentionQuery("(@alice)", 7)).toEqual({ start: 1, end: 7, query: "alice" });
  });

  it("replaces only the active token and returns the restored caret", () => {
    expect(applyIssueMention("Before @ali after @other", { start: 7, end: 11, query: "ali" }, "alice")).toEqual({
      value: "Before @alice  after @other",
      caret: 14,
    });
  });
});
