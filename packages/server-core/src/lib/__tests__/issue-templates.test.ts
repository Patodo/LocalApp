import { describe, expect, it } from "vitest";
import { IssueTemplateConfigError, parseIssueTemplatesConfig } from "../issue-templates.js";

describe("Issue template manifest config", () => {
  it("normalizes valid templates and preserves declaration order", () => {
    expect(parseIssueTemplatesConfig({
      issues: {
        templates: [
          {
            id: "bug-report",
            name: " Bug report ",
            description: " Report a reproducible defect ",
            titlePrefix: "[Bug] ",
            body: "## Steps\n\n1. ",
            type: "bug",
            labels: ["triage", "frontend", "triage"],
          },
          { id: "feature-request", name: "Feature request", description: "Suggest an improvement" },
        ],
      },
    })).toEqual([
      {
        id: "bug-report",
        name: "Bug report",
        description: "Report a reproducible defect",
        titlePrefix: "[Bug] ",
        body: "## Steps\n\n1. ",
        type: "bug",
        labels: ["triage", "frontend"],
      },
      {
        id: "feature-request",
        name: "Feature request",
        description: "Suggest an improvement",
        titlePrefix: "",
        body: "",
        type: "task",
        labels: [],
      },
    ]);
  });

  it("treats a missing issues config as no templates", () => {
    expect(parseIssueTemplatesConfig({ name: "demo" })).toEqual([]);
    expect(parseIssueTemplatesConfig({ issues: {} })).toEqual([]);
  });

  it.each([
    [{ issues: { templates: {} } }, "issues.templates"],
    [{ issues: { templates: Array.from({ length: 11 }, (_, index) => ({ id: `template-${index}`, name: "Template", description: "Description" })) } }, "issues.templates"],
    [{ issues: { templates: [{ id: "Bug_Report", name: "Template", description: "Description" }] } }, "issues.templates[0].id"],
    [{ issues: { templates: [{ id: "duplicate", name: "One", description: "Description" }, { id: "duplicate", name: "Two", description: "Description" }] } }, "issues.templates[1].id"],
    [{ issues: { templates: [{ id: "bug", name: "", description: "Description" }] } }, "issues.templates[0].name"],
    [{ issues: { templates: [{ id: "bug", name: "Bug", description: "Description", type: "request" }] } }, "issues.templates[0].type"],
    [{ issues: { templates: [{ id: "bug", name: "Bug", description: "Description", labels: Array.from({ length: 11 }, (_, index) => `label-${index}`) }] } }, "issues.templates[0].labels"],
  ])("rejects invalid config at %s", (manifest, expectedPath) => {
    expect(() => parseIssueTemplatesConfig(manifest)).toThrow(IssueTemplateConfigError);
    try {
      parseIssueTemplatesConfig(manifest);
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_issue_templates", path: expectedPath });
    }
  });
});
