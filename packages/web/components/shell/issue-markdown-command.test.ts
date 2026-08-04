import { describe, expect, it } from "vitest";
import { applyMarkdownCommand, type MarkdownCommand } from "./issue-markdown-command";

describe("applyMarkdownCommand", () => {
  it.each([
    ["bold", "selected", "**selected**", 2, 10],
    ["italic", "selected", "_selected_", 1, 9],
    ["code", "selected", "`selected`", 1, 9],
  ] satisfies Array<[MarkdownCommand, string, string, number, number]>)
  ("wraps selected text for %s", (command, selected, value, selectionStart, selectionEnd) => {
    expect(applyMarkdownCommand(selected, 0, selected.length, command)).toEqual({ value, selectionStart, selectionEnd });
  });

  it("inserts placeholders for collapsed inline selections", () => {
    expect(applyMarkdownCommand("before after", 7, 7, "bold")).toEqual({
      value: "before **粗体文本**after",
      selectionStart: 9,
      selectionEnd: 13,
    });
  });

  it("inserts links and selects the URL placeholder", () => {
    expect(applyMarkdownCommand("LocalApp", 0, 8, "link")).toEqual({
      value: "[LocalApp](url)",
      selectionStart: 11,
      selectionEnd: 14,
    });
  });

  it.each([
    ["heading", "alpha\nbeta", "## alpha\n## beta"],
    ["quote", "alpha\nbeta", "> alpha\n> beta"],
    ["bullet-list", "alpha\nbeta", "- alpha\n- beta"],
    ["ordered-list", "alpha\nbeta", "1. alpha\n2. beta"],
    ["task-list", "alpha\nbeta", "- [ ] alpha\n- [ ] beta"],
  ] satisfies Array<[MarkdownCommand, string, string]>)
  ("transforms every selected line for %s", (command, source, value) => {
    expect(applyMarkdownCommand(source, 0, source.length, command)).toEqual({
      value,
      selectionStart: 0,
      selectionEnd: value.length,
    });
  });

  it("normalizes existing block prefixes instead of stacking them", () => {
    const source = "### alpha\n> beta\n- [x] gamma\n12. delta";
    expect(applyMarkdownCommand(source, 0, source.length, "bullet-list").value).toBe(
      "- alpha\n- beta\n- gamma\n- delta",
    );
  });

  it("expands a partial selection to whole lines", () => {
    const source = "zero\none\ntwo\nthree";
    expect(applyMarkdownCommand(source, 6, 13, "quote")).toEqual({
      value: "zero\n> one\n> two\nthree",
      selectionStart: 5,
      selectionEnd: 16,
    });
  });

  it("uses UTF-16-safe browser selection offsets around Unicode text", () => {
    const source = "A😀中B";
    expect(applyMarkdownCommand(source, 1, 4, "code")).toEqual({
      value: "A`😀中`B",
      selectionStart: 2,
      selectionEnd: 5,
    });
  });
});
