import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueActionMenu } from "./issue-action-menu";

const action = (label: string) => ({ label, onSelect: vi.fn() });

describe("IssueActionMenu dynamic items", () => {
  it("connects each trigger to a unique menu id", () => {
    render(<><IssueActionMenu label="Issue 操作" items={[action("编辑 Issue")]} /><IssueActionMenu label="评论操作" items={[action("复制链接")]} /></>);
    const issueTrigger = screen.getByRole("button", { name: "Issue 操作" });
    const commentTrigger = screen.getByRole("button", { name: "评论操作" });
    expect(issueTrigger.getAttribute("aria-controls")).not.toBe(commentTrigger.getAttribute("aria-controls"));

    fireEvent.click(issueTrigger);
    expect(screen.getByRole("menu", { name: "Issue 操作" })).toHaveAttribute("id", issueTrigger.getAttribute("aria-controls"));
    fireEvent.click(commentTrigger);
    expect(screen.getByRole("menu", { name: "评论操作" })).toHaveAttribute("id", commentTrigger.getAttribute("aria-controls"));
  });

  it("moves focus to the first available item when the focused action disappears", async () => {
    const { rerender } = render(<IssueActionMenu label="评论操作" items={[action("复制链接"), action("引用回复")]} />);
    fireEvent.click(screen.getByRole("button", { name: "评论操作" }));
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "复制链接" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "复制链接" }), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "引用回复" })).toHaveFocus();

    rerender(<IssueActionMenu label="评论操作" items={[action("复制链接")]} />);
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "复制链接" })).toHaveFocus());
  });

  it("closes an empty menu and does not reopen it when actions return", async () => {
    const { rerender } = render(<IssueActionMenu label="Issue 操作" items={[action("编辑 Issue")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Issue 操作" }));
    expect(screen.getByRole("menu", { name: "Issue 操作" })).toBeInTheDocument();

    rerender(<IssueActionMenu label="Issue 操作" items={[]} />);
    expect(screen.queryByRole("menu", { name: "Issue 操作" })).not.toBeInTheDocument();
    rerender(<IssueActionMenu label="Issue 操作" items={[action("编辑 Issue")]} />);
    expect(screen.queryByRole("menu", { name: "Issue 操作" })).not.toBeInTheDocument();
  });

  it("restores focus after an immediate command unless a follow-up workflow owns focus", async () => {
    const { rerender } = render(<IssueActionMenu label="评论操作" items={[action("复制链接")]} />);
    const trigger = screen.getByRole("button", { name: "评论操作" });
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "复制链接" }));
    await waitFor(() => expect(trigger).toHaveFocus());

    rerender(<IssueActionMenu label="评论操作" items={[{ ...action("编辑评论"), restoreFocus: false }]} />);
    fireEvent.click(trigger);
    const editItem = await screen.findByRole("menuitem", { name: "编辑评论" });
    await waitFor(() => expect(editItem).toHaveFocus());
    fireEvent.click(editItem);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(trigger).not.toHaveFocus();
  });
});
