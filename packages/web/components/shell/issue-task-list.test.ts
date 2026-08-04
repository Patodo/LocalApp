import { describe, expect, it } from "vitest";
import { collectIssueTasks, toggleIssueTask } from "./issue-task-list";

describe("Issue Markdown task lists", () => {
  const markdown = [
    "Plan",
    "- [ ] first",
    "  - [x] nested",
    "1. [X] numbered",
    "",
    "```md",
    "- [ ] not a task",
    "```",
    "",
    "Inline `- [ ] nope`",
  ].join("\n");

  it("collects GFM task items in AST order and ignores code", () => {
    expect(collectIssueTasks(markdown)).toEqual([
      expect.objectContaining({ index: 0, checked: false }),
      expect.objectContaining({ index: 1, checked: true }),
      expect.objectContaining({ index: 2, checked: true }),
    ]);
  });

  it("toggles only the selected marker without rewriting surrounding Markdown", () => {
    expect(toggleIssueTask(markdown, 1, false)).toBe(markdown.replace("  - [x] nested", "  - [ ] nested"));
    expect(toggleIssueTask(markdown, 0, true)).toBe(markdown.replace("- [ ] first", "- [x] first"));
  });

  it("preserves CRLF and rejects stale or invalid task coordinates", () => {
    const crlf = "- [ ] one\r\n- [x] two\r\n";
    expect(toggleIssueTask(crlf, 1, false)).toBe("- [ ] one\r\n- [ ] two\r\n");
    expect(() => toggleIssueTask(crlf, 1, true)).toThrow("Task state changed");
    expect(() => toggleIssueTask(crlf, 9, true)).toThrow("Task not found");
  });
});
