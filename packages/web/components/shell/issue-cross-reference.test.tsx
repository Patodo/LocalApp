import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueCrossReference } from "./issue-cross-reference";

describe("IssueCrossReference", () => {
  it("links a source comment and opens it inside the Issue workspace", () => {
    const onOpen = vi.fn();
    render(<IssueCrossReference reference={{ id: 8, target_issue_id: 1, source_issue_id: 2, source_issue_number: 2, source_issue_title: "Source discussion", source_issue_status: "open", source_type: "comment", source_id: 9, source_comment_id: 9, actor_id: "alice", excerpt: "Investigated this while fixing #1", created_at: "2026-07-13T00:00:00.000Z", updated_at: "2026-07-13T00:00:00.000Z" }} actorName="Alice" href="?localappIssueNumber=2&localappIssueCommentId=9" onOpen={onOpen} />);
    const link = screen.getByRole("link", { name: "来源 Issue #2 Source discussion，评论 9" });
    expect(link).toHaveAttribute("href", "?localappIssueNumber=2&localappIssueCommentId=9");
    expect(screen.getByText("Investigated this while fixing #1")).toBeInTheDocument();
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledWith(2, 9);
  });
});
