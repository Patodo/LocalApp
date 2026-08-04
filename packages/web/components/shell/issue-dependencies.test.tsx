import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueDependencies } from "./issue-dependencies";
import type { IssueDetail } from "./issue-types";

const issue = (id: number, title: string, status: "open" | "closed" = "open") => ({ id, issue_number: id, title, description: "", status, label: "bug" as const, reporter_id: "alice", created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z", added_by: "owner", relation_created_at: "2026-01-01T00:00:00.000Z", assignee_ids: [] });
const detail = { issue: issue(1, "Current"), timeline: [], attachments: [], reactions: [], blockedBy: [issue(2, "Open blocker")], blocking: [issue(3, "Downstream", "closed")], dependencySummary: { blockedBy: 1, blocking: 1, unresolvedBlockers: 1, isBlocked: true } } as unknown as IssueDetail;

describe("IssueDependencies", () => {
  it("renders both dependency directions and supports owner add/remove actions", async () => {
    const onAdd = vi.fn().mockResolvedValue(undefined);
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(<IssueDependencies detail={detail} identities={[]} canManage saving={false} getIssueHref={(number) => `/?issue=${number}`} onOpenIssue={vi.fn()} onAdd={onAdd} onRemove={onRemove} />);
    expect(screen.getByText("1 个未解决 blocker")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "被以下 Issue 阻塞" })).toHaveTextContent("Open blocker");
    expect(screen.getByRole("list", { name: "正在阻塞" })).toHaveTextContent("Downstream");
    fireEvent.click(screen.getAllByRole("button", { name: /添加/ })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "被以下 Issue 阻塞的 Issue 编号" }), { target: { value: "#9" } });
    fireEvent.click(screen.getByRole("button", { name: "添加依赖" }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("blockedBy", 9));
    fireEvent.click(screen.getByRole("button", { name: "移除依赖 #2" }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledWith("blockedBy", 2));
  });

  it("keeps dependency maintenance hidden for read-only viewers", () => {
    render(<IssueDependencies detail={detail} identities={[]} canManage={false} saving={false} onAdd={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
