import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueMetadataPicker } from "./issue-metadata-picker";

const items = [
  { id: "alice", label: "Alice Chen", description: "Frontend" },
  { id: "bob", label: "Bob Li", description: "Platform owner" },
];

describe("IssueMetadataPicker", () => {
  it("searches labels, ids, and descriptions and exposes selected state", async () => {
    render(<IssueMetadataPicker label="Assignees" items={items} selectedIds={["alice"]} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑负责人" }));

    expect(screen.getByRole("dialog", { name: "选择负责人" })).toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "搜索负责人" });
    await waitFor(() => expect(search).toHaveFocus());
    expect(search).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("checkbox", { name: "Alice Chen" })).toBeChecked();

    fireEvent.change(search, { target: { value: "platform" } });
    expect(screen.queryByRole("checkbox", { name: "Alice Chen" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Bob Li" })).toBeInTheDocument();
  });

  it("locks duplicate changes while saving and closes with Escape with focus restored", async () => {
    let resolve!: () => void;
    const onToggle = vi.fn(() => new Promise<void>((done) => { resolve = done; }));
    render(<IssueMetadataPicker label="Labels" items={items} selectedIds={[]} onToggle={onToggle} />);
    const trigger = screen.getByRole("button", { name: "编辑标签" });
    fireEvent.click(trigger);
    const option = screen.getByRole("checkbox", { name: "Alice Chen" });
    fireEvent.click(option);
    expect(option).toBeDisabled();
    expect(onToggle).toHaveBeenCalledWith("alice", true);
    resolve();
    await waitFor(() => expect(option).not.toBeDisabled());

    fireEvent.keyDown(screen.getByRole("dialog", { name: "选择标签" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "选择标签" })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("shows an empty result and closes on outside pointer interaction", () => {
    render(<div><IssueMetadataPicker label="Labels" items={items} selectedIds={[]} onToggle={vi.fn()} /><button type="button">Outside</button></div>);
    fireEvent.click(screen.getByRole("button", { name: "编辑标签" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索标签" }), { target: { value: "missing" } });
    expect(screen.getByText("没有匹配项")).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog", { name: "选择标签" })).not.toBeInTheDocument();
  });

  it("moves through filtered options with arrow, Home, and End keys", async () => {
    render(<IssueMetadataPicker label="Assignees" items={items} selectedIds={[]} onToggle={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑负责人" }));
    const search = screen.getByRole("searchbox", { name: "搜索负责人" });
    await waitFor(() => expect(search).toHaveFocus());

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Alice Chen" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alice Chen" }), { key: "ArrowDown" });
    expect(screen.getByRole("checkbox", { name: "Bob Li" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Bob Li" }), { key: "Home" });
    expect(screen.getByRole("checkbox", { name: "Alice Chen" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "Alice Chen" }), { key: "End" });
    expect(screen.getByRole("checkbox", { name: "Bob Li" })).toHaveFocus();
  });

  it("keeps the picker state and retries an inline mutation failure", async () => {
    const onToggle = vi.fn()
      .mockRejectedValueOnce(new Error("标签更新失败"))
      .mockResolvedValueOnce(undefined);
    render(<IssueMetadataPicker label="Labels" items={items} selectedIds={[]} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "编辑标签" }));
    const dialog = screen.getByRole("dialog", { name: "选择标签" });
    const search = screen.getByRole("searchbox", { name: "搜索标签" });
    fireEvent.change(search, { target: { value: "frontend" } });
    const option = screen.getByRole("checkbox", { name: "Alice Chen" });

    fireEvent.click(option);

    expect(await screen.findByRole("alert")).toHaveTextContent("标签更新失败");
    expect(dialog).toBeInTheDocument();
    expect(search).toHaveValue("frontend");
    expect(option).not.toBeChecked();
    expect(option).not.toBeDisabled();

    fireEvent.click(option);
    await waitFor(() => expect(onToggle).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
