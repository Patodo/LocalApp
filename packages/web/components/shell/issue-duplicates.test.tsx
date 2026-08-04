import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueDuplicates } from "./issue-duplicates";
import type { Issue } from "./issue-types";

const issue = (id: number, issue_number: number, title: string): Issue => ({ id, issue_number, title, description: "", status: "open", state_reason: null, label: "bug", reporter_id: "owner", locked_at: null, locked_by: null, lock_reason: null, milestone_id: null, pinned_at: null, pinned_by: null, created_at: "2026-07-13T00:00:00.000Z", updated_at: "2026-07-13T00:00:00.000Z" });

describe("IssueDuplicates", () => {
  it("links the canonical Issue and lets the owner undo with focus recovery", async () => {
    const canonical = { ...issue(1, 1, "Canonical"), marked_by: "owner", comment_id: 9, relation_created_at: "2026-07-13T00:00:00.000Z" };
    const onUnmark = vi.fn().mockResolvedValue(undefined);
    render(<><h3 data-localapp-issue-title tabIndex={-1}>Duplicate issue</h3><IssueDuplicates duplicateOf={canonical} duplicates={[]} canManage getIssueHref={(number) => `?issue=${number}`} onOpenIssue={vi.fn()} onUnmark={onUnmark} /></>);
    expect(screen.getByRole("link", { name: "Canonical Issue #1 Canonical" })).toHaveAttribute("href", "?issue=1");
    const undo = screen.getByRole("button", { name: "撤销重复标记" });
    fireEvent.click(undo);
    await waitFor(() => expect(onUnmark).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Duplicate issue" })).toHaveFocus());
  });

  it("shows reverse duplicates and keeps a failed undo retryable", async () => {
    const duplicate = { ...issue(2, 2, "Duplicate"), marked_by: "owner", comment_id: 10, relation_created_at: "2026-07-13T00:00:00.000Z" };
    const onUnmark = vi.fn().mockRejectedValue(new Error("撤销失败"));
    render(<IssueDuplicates duplicateOf={duplicate} duplicates={[duplicate]} canManage getIssueHref={(number) => `?issue=${number}`} onOpenIssue={vi.fn()} onUnmark={onUnmark} />);
    fireEvent.click(screen.getByRole("button", { name: "撤销重复标记" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("撤销失败");
    expect(screen.getByRole("button", { name: "撤销重复标记" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "重复 Issue #2 Duplicate" })).toBeInTheDocument();
  });
});
