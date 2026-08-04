import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_ISSUE_LIST_QUERY } from "./issue-list-query";
import { IssueSavedViews } from "./issue-saved-views";

const views = [
  { id: 7, user_id: "alice", name: "待验收", description: "本周", query: { status: "open" as const, label: "bug", offset: 0 as const }, created_at: "2026-07-13", updated_at: "2026-07-13" },
  { id: 8, user_id: "alice", name: "已完成", description: "", query: { status: "closed" as const, reason: "completed" as const, offset: 0 as const }, created_at: "2026-07-13", updated_at: "2026-07-13" },
];

function renderViews(overrides: Partial<React.ComponentProps<typeof IssueSavedViews>> = {}) {
  const props: React.ComponentProps<typeof IssueSavedViews> = {
    views, activeViewId: 7, dirty: false, currentQuery: DEFAULT_ISSUE_LIST_QUERY,
    loading: false, error: null, saving: false,
    onApply: vi.fn(), onCreate: vi.fn(async () => undefined), onUpdate: vi.fn(async () => undefined),
    onCopy: vi.fn(async () => undefined), onDelete: vi.fn(async () => undefined), onRetry: vi.fn(),
    ...overrides,
  };
  render(<IssueSavedViews {...props} />);
  return props;
}

describe("IssueSavedViews", () => {
  it("applies a private saved view and exposes active state", () => {
    const props = renderViews();
    expect(screen.getByRole("heading", { name: "保存的视图" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开保存视图 待验收" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "打开保存视图 已完成" }));
    expect(props.onApply).toHaveBeenCalledWith(views[1]);
  });

  it("creates a view from the current query without losing input after a failure", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("暂时不可用"));
    renderViews({ onCreate });
    fireEvent.click(screen.getByRole("button", { name: "保存当前 Issue 视图" }));
    const dialog = screen.getByRole("dialog", { name: "保存当前视图" });
    fireEvent.change(within(dialog).getByLabelText("视图名称"), { target: { value: "我的队列" } });
    fireEvent.change(within(dialog).getByLabelText("视图说明"), { target: { value: "每日检查" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存视图" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("暂时不可用");
    expect(within(dialog).getByLabelText("视图名称")).toHaveValue("我的队列");
    expect(onCreate).toHaveBeenCalledWith("我的队列", "每日检查");
  });

  it("shows unsaved changes and supports save changes or save as", () => {
    const props = renderViews({ dirty: true });
    expect(screen.getByText("有未保存更改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存视图更改" }));
    expect(props.onUpdate).toHaveBeenCalledWith(views[0].id, { query: DEFAULT_ISSUE_LIST_QUERY });
    fireEvent.click(screen.getByRole("button", { name: "将当前查询另存为视图" }));
    expect(screen.getByRole("dialog", { name: "另存当前视图" })).toBeInTheDocument();
  });

  it("edits, copies, and confirms deletion while preserving focus semantics", async () => {
    const props = renderViews();
    fireEvent.click(screen.getByRole("button", { name: "管理保存视图 待验收" }));
    const menu = screen.getByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "编辑视图" }));
    const edit = screen.getByRole("dialog", { name: "编辑保存视图" });
    expect(within(edit).getByLabelText("视图名称")).toHaveValue("待验收");
    fireEvent.change(within(edit).getByLabelText("视图名称"), { target: { value: "待发布" } });
    fireEvent.click(within(edit).getByRole("button", { name: "保存视图" }));
    expect(props.onUpdate).toHaveBeenCalledWith(7, { name: "待发布", description: "本周" });

    fireEvent.click(screen.getByRole("button", { name: "管理保存视图 待验收" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制视图" }));
    expect(props.onCopy).toHaveBeenCalledWith(7);
    fireEvent.click(screen.getByRole("button", { name: "管理保存视图 待验收" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "删除视图" }));
    expect(screen.getByRole("alertdialog", { name: "删除保存视图" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除视图" }));
    expect(props.onDelete).toHaveBeenCalledWith(7);
  });

  it("keeps list failures local and provides retry", () => {
    const props = renderViews({ views: [], error: "保存视图加载失败" });
    expect(screen.getByRole("alert")).toHaveTextContent("保存视图加载失败");
    fireEvent.click(screen.getByRole("button", { name: "重试保存视图" }));
    expect(props.onRetry).toHaveBeenCalled();
  });
});
