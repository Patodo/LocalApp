import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalTask } from "../lib/types";
import { TasksView } from "./tasks-view";

const awaitingTask: LocalTask = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  serverOrigin: "https://work.example",
  appOwner: "alice",
  appName: "reports",
  appVersion: "7",
  publisherUserId: "publisher-1",
  publisherDisplayName: "Release Publisher",
  title: "Generate report",
  description: "Build the workbook",
  script: "return input.month",
  dependencies: { zod: "3.23.8" },
  input: { month: "2026-07" },
  workingDirectory: "C:\\Users\\Ada\\AppData\\Local\\LocalApp\\tasks\\550e8400-e29b-41d4-a716-446655440000\\work",
  timeoutSeconds: 45,
  status: "awaiting_trust",
  pinned: false,
  createdAt: 1_784_024_000_000,
  updatedAt: 1_784_024_001_000,
};

afterEach(cleanup);

describe("TasksView", () => {
  it("shows the complete trust boundary and runs only from an explicit trust action", async () => {
    const user = userEvent.setup();
    const onTrustAndRun = vi.fn().mockResolvedValue(undefined);
    const onReject = vi.fn().mockResolvedValue(undefined);

    render(
      <TasksView
        tasks={[awaitingTask]}
        onCancel={vi.fn()}
        onPin={vi.fn()}
        onReadLogs={vi.fn().mockResolvedValue({ stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false })}
        logRevisionFor={() => 0}
        onReject={onReject}
        onTrustAndRun={onTrustAndRun}
      />,
    );

    expect(screen.getByRole("heading", { name: "Generate report" })).toBeVisible();
    expect(screen.getByText("Release Publisher")).toBeVisible();
    expect(screen.getByText("https://work.example/alice/reports")).toBeVisible();
    expect(screen.getByText("return input.month")).toBeVisible();
    expect(screen.queryByText("zod@3.23.8")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "依赖 (1)" }));
    expect(screen.getByText("zod@3.23.8")).toBeVisible();
    expect(screen.getByText(awaitingTask.workingDirectory)).toBeVisible();
    expect(screen.getByText(/当前用户的完整权限/)).toBeVisible();
    expect(screen.getByText(/45 秒/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "信任并运行" }));
    expect(onTrustAndRun).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "确认执行" })).toBeVisible();
    expect(screen.getByText(/脚本将使用当前用户的完整权限运行/)).toBeVisible();

    await user.click(screen.getByRole("button", { name: "确认信任并运行" }));
    expect(onTrustAndRun).toHaveBeenCalledWith(awaitingTask.id);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("supports rejecting trust, cancelling active work, and pinning completed history", async () => {
    const user = userEvent.setup();
    const onReject = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn().mockResolvedValue(undefined);
    const onPin = vi.fn().mockResolvedValue(undefined);
    const onReadLogs = vi.fn().mockImplementation(async (requestId: string) => requestId === "completed"
      ? { stdout: "created report.xlsx\n", stderr: "", stdoutTruncated: true, stderrTruncated: false }
      : { stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false });
    const running = { ...awaitingTask, id: "running", title: "Running task", status: "running" as const };
    const completed = {
      ...awaitingTask,
      id: "completed",
      title: "Completed task",
      status: "succeeded" as const,
      result: { path: "report.xlsx" },
    };

    render(
      <TasksView
        tasks={[awaitingTask, running, completed]}
        onCancel={onCancel}
        onPin={onPin}
        onReadLogs={onReadLogs}
        logRevisionFor={() => 0}
        onReject={onReject}
        onTrustAndRun={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "拒绝 Generate report" }));
    expect(onReject).toHaveBeenCalledWith(awaitingTask.id);

    await user.click(screen.getByRole("button", { name: "Running task" }));
    await user.click(screen.getByRole("button", { name: "取消任务" }));
    expect(onCancel).toHaveBeenCalledWith("running");

    await user.click(screen.getByRole("button", { name: "Completed task" }));
    expect(screen.getByText(/"path": "report\.xlsx"/)).toBeVisible();
    expect(await screen.findByText("created report.xlsx")).toBeVisible();
    expect(screen.getByRole("heading", { name: "标准输出（仅显示末尾）" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "固定记录" }));
    expect(onPin).toHaveBeenCalledWith("completed", true);
  });
});
