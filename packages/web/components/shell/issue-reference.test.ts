import { unified } from "unified";
import remarkParse from "remark-parse";
import { describe, expect, it } from "vitest";
import { ISSUE_REFERENCE_PREFIX, readIssueReference, remarkIssueReferences } from "./issue-reference";

describe("Issue references", () => {
  it("links plain references while preserving code and existing links", () => {
    const markdown = "See #12 and (#34), `#56`, [#78](https://example.com), and \\#90.";
    const tree = unified().use(remarkParse).use(remarkIssueReferences).runSync(unified().use(remarkParse).parse(markdown), markdown) as unknown as { children: unknown[] };
    expect(JSON.stringify(tree)).toContain(`\"url\":\"${ISSUE_REFERENCE_PREFIX}12\"`);
    expect(JSON.stringify(tree)).toContain(`\"url\":\"${ISSUE_REFERENCE_PREFIX}34\"`);
    expect(JSON.stringify(tree)).not.toContain(`${ISSUE_REFERENCE_PREFIX}56`);
    expect(JSON.stringify(tree)).not.toContain(`${ISSUE_REFERENCE_PREFIX}78`);
    expect(JSON.stringify(tree)).not.toContain(`${ISSUE_REFERENCE_PREFIX}90`);
  });

  it("validates internal reference hrefs", () => {
    expect(readIssueReference(`${ISSUE_REFERENCE_PREFIX}42`)).toBe(42);
    expect(readIssueReference(`${ISSUE_REFERENCE_PREFIX}0`)).toBeNull();
    expect(readIssueReference("https://example.com/#42")).toBeNull();
  });
});
