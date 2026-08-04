import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueSubIssues } from "./issue-sub-issues";
import type { IssueDetail } from "./issue-types";

const detail = {
  issue: { id: 1, issue_number: 1, title: "Parent", description: "", status: "open", label: "feature", reporter_id: "owner", created_at: "2026-07-12T00:00:00.000Z", updated_at: "2026-07-12T00:00:00.000Z" },
  timeline: [], attachments: [], reactions: [], collaboration: { labels: [], assignee_ids: [], subscriber_ids: [], participant_ids: [] },
  parent: null,
  subIssues: [
    { id: 2, issue_number: 2, title: "Completed child", description: "", status: "closed", label: "bug", reporter_id: "owner", created_at: "2026-07-12T00:00:00.000Z", updated_at: "2026-07-12T00:00:00.000Z", position: 0, added_by: "owner", relation_created_at: "2026-07-12T00:00:00.000Z", assignee_ids: ["alice"] },
    { id: 3, issue_number: 3, title: "Open child", description: "", status: "open", label: "bug", reporter_id: "owner", created_at: "2026-07-12T00:00:00.000Z", updated_at: "2026-07-12T00:00:00.000Z", position: 1, added_by: "owner", relation_created_at: "2026-07-12T00:00:00.000Z", assignee_ids: [], child_count: 1, completed_child_count: 0, child_percent: 0 },
  ],
  subIssueSummary: { total: 2, completed: 1, percent: 50 },
} satisfies IssueDetail;

describe("IssueSubIssues", () => {
  it("renders progress and lets the owner create, link, open, and remove children", async () => {
    const onCreate = vi.fn();
    const onLink = vi.fn().mockResolvedValue(undefined);
    const onOpenIssue = vi.fn();
    const onRemove = vi.fn().mockResolvedValue(undefined);
    const onReprioritize = vi.fn().mockResolvedValue(undefined);
    render(<IssueSubIssues detail={detail} identities={[{ id: "alice", displayName: "Alice", avatarUrl: null }]} canManage saving={false} getIssueHref={(number) => `/?issue=${number}`} onOpenIssue={onOpenIssue} onCreate={onCreate} onLink={onLink} onRemove={onRemove} onReprioritize={onReprioritize} />);

    expect(screen.getByText("1 / 2 已完成")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Sub-issues 完成进度" })).toHaveAttribute("aria-valuenow", "50");
    fireEvent.click(screen.getByRole("button", { name: "创建子 Issue" }));
    expect(onCreate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "关联" }));
    fireEvent.change(screen.getByRole("textbox", { name: "要关联的 Issue 编号" }), { target: { value: "#42" } });
    fireEvent.click(screen.getByRole("button", { name: "关联 Issue" }));
    await waitFor(() => expect(onLink).toHaveBeenCalledWith(42));
    fireEvent.click(screen.getByRole("link", { name: "#3 Open child" }));
    expect(onOpenIssue).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "移除 Sub-issue #2" }));
    expect(onRemove).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "重排 Sub-issue #3" }));
    expect(screen.getByRole("menuitem", { name: "下移" })).toBeDisabled();
    fireEvent.click(screen.getByRole("menuitem", { name: "移到顶部" }));
    await waitFor(() => expect(onReprioritize).toHaveBeenCalledWith(3, null));
    expect(await screen.findByText("Sub-issue #3 已移动到第 1 位")).toBeInTheDocument();
  });

  it("keeps invalid link input visible and hides maintenance controls from readers", () => {
    const { rerender } = render(<IssueSubIssues detail={detail} identities={[]} canManage saving={false} onCreate={vi.fn()} onLink={vi.fn()} onRemove={vi.fn()} onReprioritize={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "关联" }));
    fireEvent.change(screen.getByRole("textbox", { name: "要关联的 Issue 编号" }), { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByRole("button", { name: "关联 Issue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("请输入有效的 Issue 编号");

    rerender(<IssueSubIssues detail={detail} identities={[]} canManage={false} saving={false} onCreate={vi.fn()} onLink={vi.fn()} onRemove={vi.fn()} onReprioritize={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "创建子 Issue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关联" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除 Sub-issue #2" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重排 Sub-issue #2" })).not.toBeInTheDocument();
  });

  it("keeps the authoritative order and exposes a local error when reprioritize fails", async () => {
    const onReprioritize = vi.fn().mockRejectedValue(new Error("顺序已被其他用户修改"));
    render(<IssueSubIssues detail={detail} identities={[]} canManage saving={false} onCreate={vi.fn()} onLink={vi.fn()} onRemove={vi.fn()} onReprioritize={onReprioritize} />);
    fireEvent.click(screen.getByRole("button", { name: "重排 Sub-issue #2" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "下移" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("顺序已被其他用户修改");
    expect(screen.getAllByRole("treeitem").map((item) => item.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Completed child"), expect.stringContaining("Open child")]));
  });

  it("loads nested branches on demand and supports keyboard collapse", async () => {
    const loadChildren = vi.fn().mockResolvedValue({
      summary: { total: 1, completed: 0, percent: 0 },
      items: [{ id: 4, issue_number: 4, title: "Nested child", description: "", status: "open", label: "bug", reporter_id: "owner", created_at: "2026-07-12T00:00:00.000Z", updated_at: "2026-07-12T00:00:00.000Z", position: 0, added_by: "owner", relation_created_at: "2026-07-12T00:00:00.000Z", assignee_ids: [], child_count: 0, completed_child_count: 0, child_percent: 0 }],
    });
    render(<IssueSubIssues detail={detail} identities={[]} canManage={false} saving={false} onCreate={vi.fn()} onLink={vi.fn()} onRemove={vi.fn()} onReprioritize={vi.fn()} loadChildren={loadChildren} />);
    const expand = screen.getByRole("button", { name: "展开 Sub-issue #3" });
    fireEvent.keyDown(expand, { key: "ArrowRight" });
    expect(await screen.findByRole("link", { name: "#4 Nested child" })).toBeInTheDocument();
    expect(loadChildren).toHaveBeenCalledWith(3, expect.any(AbortSignal));
    const collapse = screen.getByRole("button", { name: "折叠 Sub-issue #3" });
    fireEvent.keyDown(collapse, { key: "ArrowLeft" });
    expect(screen.queryByRole("link", { name: "#4 Nested child" })).not.toBeInTheDocument();
  });
});
