import { describe, expect, it } from "vitest";
import { applyIssueSearchSuggestion, getIssueSearchSuggestions, parseIssueSearchInput } from "./issue-search-query";

const labels = [
  { id: "bug", name: "缺陷" },
  { id: "needs-review", name: "Needs Review" },
];
const milestones = [
  { id: 7, title: "Phase 2" },
  { id: 9, title: "Backlog" },
];

describe("parseIssueSearchInput", () => {
  it("extracts GitHub-style qualifiers and keeps free text", () => {
    expect(parseIssueSearchInput(
      'upload failed is:closed label:"Needs Review" author:@me sort:comments-desc',
      { currentUserId: "alice", labels },
    )).toEqual({
      q: "upload failed",
      status: "closed",
      label: "needs-review",
      author: "alice",
      sort: "comments",
      direction: "desc",
      offset: 0,
    });
  });

  it("supports involves and case-insensitive names and values", () => {
    expect(parseIssueSearchInput('IS:OPEN LABEL:"needs review" INVOLVES:@Bob SORT:UPDATED-ASC', {
      currentUserId: "alice",
      labels,
    })).toEqual({
      q: "",
      status: "open",
      label: "needs-review",
      participant: "Bob",
      sort: "updated",
      direction: "asc",
      offset: 0,
    });
  });

  it("parses Issue Type independently from labels", () => {
    expect(parseIssueSearchInput("type:BUG label:bug", { labels })).toEqual({
      q: "",
      issueType: "bug",
      label: "bug",
      offset: 0,
    });
    expect(parseIssueSearchInput("type:epic", { labels })).toEqual({ q: "type:epic", offset: 0 });
  });

  it("uses the last valid duplicate qualifier", () => {
    expect(parseIssueSearchInput("is:open is:locked is:closed is:unlocked sort:created-asc sort:activity-desc", { labels })).toEqual({
      q: "",
      status: "closed",
      locked: "unlocked",
      sort: "activity",
      direction: "desc",
      offset: 0,
    });
  });

  it("preserves unknown, invalid, colon, and unclosed tokens as free text", () => {
    expect(parseIssueSearchInput('is:merged project:core http://localhost:3000 label:"Needs Review', { labels })).toEqual({
      q: 'is:merged project:core http://localhost:3000 label:"Needs Review',
      offset: 0,
    });
  });

  it("preserves @me qualifiers when no current user is available", () => {
    expect(parseIssueSearchInput("author:@me involves:@me", { labels })).toEqual({
      q: "author:@me involves:@me",
      offset: 0,
    });
  });

  it("parses milestone and current-user private queue qualifiers", () => {
    expect(parseIssueSearchInput('milestone:"phase 2" mentions:@me is:subscribed', {
      currentUserId: "alice", labels, milestones,
    })).toEqual({ q: "", milestone: "7", mentioned: true, subscribed: true, offset: 0 });
    expect(parseIssueSearchInput("milestone:9 no:milestone", { labels, milestones })).toEqual({
      q: "", milestone: "none", offset: 0,
    });
  });

  it("keeps private qualifiers as text when they could expose another user's queue", () => {
    expect(parseIssueSearchInput("mentions:@me mentions:bob is:subscribed", { labels, milestones })).toEqual({
      q: "mentions:@me mentions:bob is:subscribed", offset: 0,
    });
  });

  it("parses, combines, and canonicalizes search scopes", () => {
    expect(parseIssueSearchInput("timeout in:comments in:title,comments", { labels })).toEqual({
      q: "timeout",
      searchIn: "title,comments",
      offset: 0,
    });
    expect(parseIssueSearchInput("timeout in:body,title", { labels })).toEqual({
      q: "timeout",
      searchIn: "title,body",
      offset: 0,
    });
  });

  it("preserves invalid search scopes as free text", () => {
    expect(parseIssueSearchInput('timeout in:all in: in:"title', { labels })).toEqual({
      q: 'timeout in:all in: in:"title',
      offset: 0,
    });
  });
});

describe("Issue search suggestions", () => {
  const users = [
    { id: "alice", name: "Alice" },
    { id: "bob", name: "Bob Builder" },
  ];

  it("suggests qualifier keys for an empty or partial current token", () => {
    expect(getIssueSearchSuggestions("", 0, { currentUserId: "alice", labels, users }).items.map((item) => item.value)).toEqual([
      "is:", "in:", "label:", "type:", "author:", "assignee:", "involves:", "milestone:", "reason:", "mentions:", "no:", "sort:",
    ]);
    expect(getIssueSearchSuggestions("upload la", 9, { labels, users }).items.map((item) => item.value)).toEqual(["label:"]);
    expect(getIssueSearchSuggestions("type:", 5, { labels, users }).items.map((item) => item.value)).toEqual(["type:task", "type:bug", "type:feature"]);
  });

  it("suggests each searchable content scope", () => {
    expect(getIssueSearchSuggestions("in:", 3, { labels, users }).items.map((item) => item.value)).toEqual([
      "in:title", "in:body", "in:comments",
    ]);
    expect(getIssueSearchSuggestions("in:c", 4, { labels, users }).items.map((item) => item.value)).toEqual(["in:comments"]);
  });

  it("parses and suggests Closed reason qualifiers without swallowing invalid values", () => {
    expect(parseIssueSearchInput('reason:"not planned"', { labels })).toEqual({ q: "", status: "closed", reason: "not_planned", offset: 0 });
    expect(parseIssueSearchInput("reason:completed", { labels })).toEqual({ q: "", status: "closed", reason: "completed", offset: 0 });
    expect(parseIssueSearchInput("reason:wontfix", { labels })).toEqual({ q: "reason:wontfix", offset: 0 });
    expect(getIssueSearchSuggestions("reason:", 7, { labels, users: [] }).items).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: "reason:completed", label: "已完成" }),
      expect.objectContaining({ value: 'reason:"not planned"', label: "不计划处理" }),
    ]));
  });

  it("suggests milestone and private current-user values", () => {
    expect(getIssueSearchSuggestions("milestone:pha", 13, { currentUserId: "alice", labels, milestones, users }).items[0]).toMatchObject({
      value: 'milestone:"Phase 2"', label: "Phase 2", description: "#7",
    });
    expect(getIssueSearchSuggestions("mentions:", 9, { currentUserId: "alice", labels, milestones, users }).items.map((item) => item.value)).toEqual(["mentions:@me"]);
    expect(getIssueSearchSuggestions("is:s", 4, { currentUserId: "alice", labels, milestones, users }).items.map((item) => item.value)).toEqual(["is:subscribed"]);
    expect(getIssueSearchSuggestions("no:m", 4, { labels, milestones, users }).items.map((item) => item.value)).toEqual(["no:milestone"]);
  });

  it("suggests and filters status, labels, users, and sort values", () => {
    expect(getIssueSearchSuggestions("is:c", 4, { labels, users }).items.map((item) => item.value)).toEqual(["is:closed"]);
    expect(getIssueSearchSuggestions("is:l", 4, { labels, users }).items.map((item) => item.value)).toEqual(["is:locked"]);
    expect(getIssueSearchSuggestions("label:needs", 11, { labels, users }).items[0]).toMatchObject({ value: 'label:"Needs Review"', label: "Needs Review" });
    expect(getIssueSearchSuggestions("author:@", 8, { currentUserId: "alice", labels, users }).items.map((item) => item.value)).toEqual(["author:@me"]);
    expect(getIssueSearchSuggestions("involves:bo", 11, { labels, users }).items[0]).toMatchObject({ value: "involves:bob", label: "Bob Builder" });
    expect(getIssueSearchSuggestions("assignee:bo", 11, { labels, users }).items[0]).toMatchObject({ value: "assignee:bob", label: "Bob Builder" });
    expect(getIssueSearchSuggestions("sort:comments-d", 15, { labels, users }).items.map((item) => item.value)).toEqual(["sort:comments-desc"]);
  });

  it("parses assignee identities and @me", () => {
    expect(parseIssueSearchInput("assignee:@me", { currentUserId: "alice", labels })).toEqual({ q: "", assignee: "alice", offset: 0 });
    expect(parseIssueSearchInput("assignee:@Bob", { labels })).toEqual({ q: "", assignee: "Bob", offset: 0 });
  });

  it("parses and suggests missing metadata qualifiers", () => {
    expect(parseIssueSearchInput("triage no:assignee no:label", { labels })).toEqual({
      q: "triage",
      assignee: "none",
      label: "none",
      offset: 0,
    });
    expect(getIssueSearchSuggestions("no:", 3, { labels, users: [] }).items).toEqual([
      expect.objectContaining({ value: "no:assignee", label: "无负责人" }),
      expect.objectContaining({ value: "no:label", label: "无标签" }),
      expect.objectContaining({ value: "no:milestone", label: "无里程碑" }),
    ]);
  });

  it("deduplicates users, caps results, and preserves the current token range", () => {
    const manyUsers = Array.from({ length: 12 }, (_, index) => ({ id: `user-${index}`, name: `User ${index}` }));
    const result = getIssueSearchSuggestions("before author:u after", 15, { labels, users: [manyUsers[0], manyUsers[0], ...manyUsers] });

    expect(result.items).toHaveLength(8);
    expect(result).toMatchObject({ start: 7, end: 15 });
    expect(new Set(result.items.map((item) => item.value)).size).toBe(8);
  });

  it("replaces only the active token and leaves the caret ready for another qualifier", () => {
    expect(applyIssueSearchSuggestion("upload lab", 10, { start: 7, end: 10 }, "label:bug")).toEqual({
      value: "upload label:bug ",
      cursor: 17,
    });
    expect(applyIssueSearchSuggestion("lab trailing", 3, { start: 0, end: 3 }, "label:bug")).toEqual({
      value: "label:bug trailing",
      cursor: 10,
    });
  });
});
