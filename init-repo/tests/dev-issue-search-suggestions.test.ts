import { describe, expect, it } from "vitest";
import { applyDevIssueSearchSuggestion, getDevIssueSearchSuggestions } from "@localapp/app-kit/dev-shell";

const context = {
  currentUserId: "alice",
  labels: [
    { id: "bug", name: "缺陷" },
    { id: "needs-review", name: "Needs Review" },
  ],
  users: [
    { id: "alice", displayName: "Alice" },
    { id: "bob", displayName: "Bob Builder" },
  ],
};

describe("Dev Issue search suggestions", () => {
  it("matches the hosted key and value suggestion contract", () => {
    expect(getDevIssueSearchSuggestions("la", 2, context).items.map((item) => item.value)).toEqual(["label:"]);
    expect(getDevIssueSearchSuggestions("label:needs", 11, context).items[0]).toMatchObject({
      value: 'label:"Needs Review"',
      label: "Needs Review",
    });
    expect(getDevIssueSearchSuggestions("type:", 5, context).items.map((item) => item.value)).toEqual(["type:task", "type:bug", "type:feature"]);
    expect(getDevIssueSearchSuggestions("author:@", 8, context).items.map((item) => item.value)).toEqual(["author:@me"]);
    expect(getDevIssueSearchSuggestions("involves:bo", 11, context).items[0]).toMatchObject({ value: "involves:bob" });
  });

  it("limits results and replaces only the current token", () => {
    const users = Array.from({ length: 12 }, (_, index) => ({ id: `user-${index}`, displayName: `User ${index}` }));
    expect(getDevIssueSearchSuggestions("author:", 7, { ...context, users }).items).toHaveLength(8);
    expect(applyDevIssueSearchSuggestion("upload lab", { start: 7, end: 10 }, "label:bug")).toEqual({
      value: "upload label:bug ",
      cursor: 17,
    });
  });
});
