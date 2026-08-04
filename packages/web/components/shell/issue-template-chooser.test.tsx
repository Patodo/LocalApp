import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueTemplateChooser } from "./issue-template-chooser";

const template = { id: "bug-report", name: "Bug report", description: "Report a reproducible defect", titlePrefix: "[Bug] ", body: "## Steps", type: "bug" as const, labels: ["triage"] };

describe("IssueTemplateChooser", () => {
  it("offers configured templates and an always-available blank Issue", () => {
    const onSelect = vi.fn();
    const onBlank = vi.fn();
    render(<IssueTemplateChooser templates={[template]} loading={false} error={null} onSelect={onSelect} onBlank={onBlank} onRetry={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    expect(onSelect).toHaveBeenCalledWith(template);
    fireEvent.click(screen.getByRole("button", { name: "打开空白 Issue" }));
    expect(onBlank).toHaveBeenCalledTimes(1);
  });

  it("keeps the blank entry available when loading fails", () => {
    const onRetry = vi.fn();
    render(<IssueTemplateChooser templates={[]} loading={false} error="模板暂不可用" onSelect={vi.fn()} onBlank={vi.fn()} onRetry={onRetry} />);
    expect(screen.getByRole("button", { name: "打开空白 Issue" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
