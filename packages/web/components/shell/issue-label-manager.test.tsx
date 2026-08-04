import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueLabelManager } from "./issue-label-manager";

const labels = [
  { id: "bug", name: "缺陷", color: "d73a4a", description: "", built_in: 1, created_at: "", updated_at: "" },
  { id: "triage", name: "待分诊", color: "1f6feb", description: "需要确认", built_in: 0, created_at: "", updated_at: "" },
];

describe("IssueLabelManager", () => {
  it("creates and edits custom labels while keeping built-ins read-only", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(<IssueLabelManager labels={labels} saving={false} error={null} onCreate={onCreate} onUpdate={onUpdate} onDelete={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "编辑标签 缺陷" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新建标签" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "阻塞" } });
    fireEvent.change(screen.getByLabelText("标签颜色"), { target: { value: "ff0000" } });
    fireEvent.change(screen.getByLabelText("描述"), { target: { value: "阻塞发布" } });
    fireEvent.click(screen.getByRole("button", { name: "创建标签" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({ name: "阻塞", color: "ff0000", description: "阻塞发布" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑标签 待分诊" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "已分诊" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith("triage", expect.objectContaining({ name: "已分诊" })));
  });

  it("requires destructive confirmation before deleting a custom label", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    render(<IssueLabelManager labels={labels} saving={false} error={null} onCreate={vi.fn()} onUpdate={vi.fn()} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "删除标签 待分诊" }));
    expect(screen.getByRole("alertdialog", { name: "删除标签 待分诊 确认" })).toHaveTextContent("从所有 Issue 中移除");
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除标签" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("triage"));
  });

  it("keeps the label draft visible during a failed save and rejects invalid colors", async () => {
    const onCreate = vi.fn(() => new Promise<void>(() => undefined));
    const props = { labels, onCreate, onUpdate: vi.fn(), onDelete: vi.fn() };
    const { rerender } = render(<IssueLabelManager {...props} saving={false} error={null} />);
    fireEvent.click(screen.getByRole("button", { name: "新建标签" }));
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "等待保存" } });
    fireEvent.change(screen.getByLabelText("标签颜色"), { target: { value: "xyz" } });
    expect(screen.getByRole("button", { name: "创建标签" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("标签颜色"), { target: { value: "abcdef" } });
    fireEvent.click(screen.getByRole("button", { name: "创建标签" }));
    rerender(<IssueLabelManager {...props} saving error="标签名称已存在" />);
    expect(screen.getByRole("alert")).toHaveTextContent("标签名称已存在");
    expect(screen.getByLabelText("名称")).toHaveValue("等待保存");
  });
});
