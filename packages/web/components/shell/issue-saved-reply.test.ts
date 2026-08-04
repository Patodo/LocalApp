import { describe, expect, it } from "vitest";
import { insertIssueSavedReply } from "./issue-saved-reply";

describe("insertIssueSavedReply", () => {
  it("replaces the current selection and places the caret at the first cursor marker", () => {
    expect(insertIssueSavedReply("before SELECT after", 7, 13, "Please check %cursor%this. %cursor%")).toEqual({
      body: "before Please check this. %cursor% after",
      selectionStart: 20,
      selectionEnd: 20,
    });
  });

  it("inserts at the caret without changing surrounding draft content", () => {
    expect(insertIssueSavedReply("existing draft", 8, 8, "saved reply")).toEqual({
      body: "existingsaved reply draft",
      selectionStart: 19,
      selectionEnd: 19,
    });
  });
});
