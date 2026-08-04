import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueMilestoneManager } from "./issue-milestone-manager";

const milestone = { id: 1, title: "v1.0", description: "Release", due_on: "2026-09-01", state: "open" as const, created_by: "owner", created_at: "", updated_at: "", open_issues: 3, closed_issues: 1 };

describe("IssueMilestoneManager", () => {
  it("renders progress and creates a milestone", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<IssueMilestoneManager milestones={[milestone]} saving={false} error={null} onCreate={onCreate} onUpdate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent?.includes("25% 已完成") === true)).toHaveTextContent("3 个开启 · 1 个已关闭");
    fireEvent.click(screen.getByRole("button", { name: "新建里程碑" }));
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "v2.0" } });
    fireEvent.change(screen.getByLabelText("截止日期"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "创建里程碑" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ title: "v2.0", description: "", dueOn: "2026-10-01" }));
  });

  it("closes and confirms deletion without removing Issues", async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<IssueMilestoneManager milestones={[milestone]} saving={false} error={null} onCreate={vi.fn()} onUpdate={onUpdate} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "关闭里程碑 v1.0" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(1, expect.objectContaining({ state: "closed" })));
    fireEvent.click(screen.getByRole("button", { name: "删除里程碑 v1.0" }));
    const dialog = screen.getByRole("alertdialog", { name: "删除里程碑 v1.0 确认" });
    expect(dialog).toHaveTextContent("不会删除 Issue");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog", { name: "删除里程碑 v1.0 确认" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "删除里程碑 v1.0" }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除里程碑" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith(1));
  });
});
