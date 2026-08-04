import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssuePotentialDuplicates } from "./issue-potential-duplicates";

const candidate = { id: 2, issue_number: 2, title: "Existing upload error", status: "open" as const, updated_at: "2026-01-01T00:00:00.000Z", last_activity_at: "2026-01-02T00:00:00.000Z", score: 0.8, matched_in: "title,body" as const };

describe("IssuePotentialDuplicates", () => {
  it("renders accessible candidates and opens a plain-click deep link", () => {
    const onOpenIssue = vi.fn();
    render(<IssuePotentialDuplicates candidates={[candidate]} loading={false} error={null} getIssueHref={(number) => `/?issue=${number}`} onOpenIssue={onOpenIssue} onRetry={vi.fn()} />);
    const link = screen.getByRole("link", { name: /Existing upload error/ });
    expect(link).toHaveAttribute("href", "/?issue=2");
    fireEvent.click(link);
    expect(onOpenIssue).toHaveBeenCalledWith(2);
  });

  it("keeps retry available while suggestion failure remains non-blocking", () => {
    const onRetry = vi.fn();
    render(<IssuePotentialDuplicates candidates={[]} loading={false} error="重复项建议暂不可用" getIssueHref={() => "#"} onOpenIssue={vi.fn()} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: /重试/ }));
    expect(onRetry).toHaveBeenCalled();
  });

  it("stays absent for a completed empty lookup", () => {
    const { container } = render(<IssuePotentialDuplicates candidates={[]} loading={false} error={null} getIssueHref={() => "#"} onOpenIssue={vi.fn()} onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
