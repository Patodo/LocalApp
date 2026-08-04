import { StrictMode } from "react";
import { createEvent, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueMarkdown } from "./issue-markdown";

describe("IssueMarkdown task progress", () => {
  it("keeps nested task identities stable across StrictMode renders", () => {
    const onToggleTask = vi.fn();
    const markdown = "- [x] shipped\n- [ ] verify\n  - [ ] mobile";
    const { rerender } = render(<StrictMode><IssueMarkdown onToggleTask={onToggleTask}>{markdown}</IssueMarkdown></StrictMode>);

    expect(screen.getByRole("progressbar", { name: "任务进度" })).toHaveAttribute("aria-valuetext", "已完成 1 / 3 个任务");
    const tasks = screen.getAllByRole("checkbox");
    expect(tasks).toHaveLength(3);
    expect(tasks.map((task) => task.getAttribute("aria-label"))).toEqual(["任务 1，已完成", "任务 2，未完成", "任务 3，未完成"]);
    expect(tasks[0]).toBeChecked();
    expect(tasks[2]).not.toBeDisabled();
    expect(tasks[2].closest("label")).toHaveClass("h-11", "w-11", "sm:h-6", "sm:w-6");
    fireEvent.click(tasks[2].closest("label")!);
    expect(onToggleTask).toHaveBeenCalledWith(2, true);
    onToggleTask.mockClear();
    rerender(<StrictMode><IssueMarkdown onToggleTask={onToggleTask}>{markdown}</IssueMarkdown></StrictMode>);
    expect(screen.getAllByRole("checkbox").map((task) => task.getAttribute("aria-label"))).toEqual(["任务 1，已完成", "任务 2，未完成", "任务 3，未完成"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "任务 3，未完成" }));
    expect(onToggleTask).toHaveBeenCalledWith(2, true);
  });

  it("keeps tasks read-only without a mutation callback", () => {
    render(<IssueMarkdown>{"- [ ] restricted"}</IssueMarkdown>);
    expect(screen.getByRole("checkbox")).toBeDisabled();
  });

  it("offers conversion only for convertible incomplete tasks", () => {
    const onConvertTask = vi.fn();
    render(<IssueMarkdown onConvertTask={onConvertTask}>{"- [ ] **Build** the API\n- [x] Finished\n- [ ] #42"}</IssueMarkdown>);

    const convert = screen.getByRole("button", { name: "将任务 1 转换为 Sub-issue" });
    expect(screen.queryByRole("button", { name: "将任务 2 转换为 Sub-issue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "将任务 3 转换为 Sub-issue" })).toBeNull();
    fireEvent.click(convert);
    expect(onConvertTask).toHaveBeenCalledWith(0, "Build the API", convert);
  });
});

describe("IssueMarkdown references", () => {
  it("renders navigable Issue references and preserves modified clicks", () => {
    const open = vi.fn();
    render(<IssueMarkdown getIssueReferenceHref={(issueNumber) => `/app?localappIssueId=${issueNumber}`} onOpenIssueReference={open}>Fixes #42, not `#7`.</IssueMarkdown>);
    const reference = screen.getByRole("link", { name: "#42" });
    expect(reference).toHaveAttribute("href", "/app?localappIssueId=42");
    fireEvent.click(reference);
    expect(open).toHaveBeenCalledWith(42);
    const modified = createEvent.click(reference, { metaKey: true, button: 0 });
    fireEvent(reference, modified);
    expect(modified.defaultPrevented).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link", { name: "#7" })).toBeNull();
  });
});
