import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueReactions } from "./issue-reactions";

describe("IssueReactions", () => {
  it("closes an open picker when additions become unavailable", () => {
    const props = { reactions: [], currentUserId: "alice", onToggle: vi.fn().mockResolvedValue(undefined) };
    const { rerender } = render(<IssueReactions {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "添加表态" }));
    expect(screen.getByRole("menu", { name: "选择表态" })).toBeInTheDocument();

    rerender(<IssueReactions {...props} additionsDisabled />);
    expect(screen.queryByRole("menu", { name: "选择表态" })).not.toBeInTheDocument();

    rerender(<IssueReactions {...props} />);
    expect(screen.queryByRole("menu", { name: "选择表态" })).not.toBeInTheDocument();
  });

  it("locks every picker item while a reaction mutation is pending", async () => {
    let resolve!: () => void;
    const onToggle = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<IssueReactions reactions={[]} currentUserId="alice" onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "添加表态" }));
    const first = screen.getByRole("menuitemcheckbox", { name: "添加 👍 表态" });
    const second = screen.getByRole("menuitemcheckbox", { name: "添加 👎 表态" });
    fireEvent.click(first);

    expect(first).toBeDisabled();
    expect(second).toBeDisabled();
    fireEvent.click(second);
    expect(onToggle).toHaveBeenCalledTimes(1);

    await act(async () => resolve());
    await waitFor(() => expect(screen.queryByRole("menu", { name: "选择表态" })).not.toBeInTheDocument());
  });

  it("keeps the picker retryable and reports a rejected mutation inline", async () => {
    const onToggle = vi.fn().mockRejectedValue(new Error("Reaction update failed"));
    const props = { reactions: [], currentUserId: "alice", onToggle };
    const { rerender } = render(<IssueReactions {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "添加表态" }));
    const option = screen.getByRole("menuitemcheckbox", { name: "添加 👍 表态" });
    fireEvent.click(option);

    expect(await screen.findByRole("alert")).toHaveTextContent("Reaction update failed");
    expect(screen.getByRole("menu", { name: "选择表态" })).toBeInTheDocument();
    expect(option).not.toBeDisabled();

    rerender(<IssueReactions {...props} additionsDisabled />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("exposes selected reactions and submits the opposite target state", async () => {
    const onToggle = vi.fn().mockResolvedValue(undefined);
    render(<IssueReactions reactions={[{ issue_id: 1, comment_id: 0, user_id: "alice", content: "+1", created_at: "2026-07-13T00:00:00.000Z" }]} currentUserId="alice" onToggle={onToggle} />);

    fireEvent.click(screen.getByRole("button", { name: "添加表态" }));
    const selected = screen.getByRole("menuitemcheckbox", { name: "取消 👍 表态" });
    const unselected = screen.getByRole("menuitemcheckbox", { name: "添加 👎 表态" });
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(unselected).toHaveAttribute("aria-checked", "false");
    fireEvent.click(selected);

    await waitFor(() => expect(onToggle).toHaveBeenCalledWith("+1", false, undefined));
  });
});
