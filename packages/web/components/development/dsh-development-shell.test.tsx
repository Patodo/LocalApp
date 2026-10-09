import React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DshDevelopmentShell,
  type DevelopmentShellProps,
} from "./dsh-development-shell";
vi.mock("./dsh-view", () => ({
  DshMessages: () => null,
  DshMarkdown: () => null,
  DshDiff: () => null,
  DshTerminal: () => null,
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 1280,
    height: 800,
    top: 0,
    left: 0,
    right: 1280,
    bottom: 800,
    x: 0,
    y: 0,
    toJSON() {},
  });
});
function props(): DevelopmentShellProps {
  const noop = vi.fn();
  return {
    sessions: [],
    selectedSession: "",
    projects: [{ id: "project", name: "my-app" }],
    project: { id: "project", name: "my-app" },
    files: ["src/App.tsx"],
    file: null,
    text: "",
    prompt: "Make a todo app",
    messages: [],
    live: "",
    running: false,
    pending: false,
    error: "",
    versions: [],
    version: "",
    changes: [],
    providers: [{ id: "model", name: "My provider", model: "my-model" }],
    provider: "model",
    build: null,
    log: "",
    interaction: null,
    answer: "",
    actions: {
      select: noop,
      selectSession: noop,
      create: vi.fn(),
      open: vi.fn(),
      setText: noop,
      save: noop,
      setPrompt: noop,
      run: vi.fn(),
      stop: vi.fn(),
      setProvider: noop,
      newSession: noop,
      setVersion: noop,
      diff: noop,
      restore: noop,
      build: noop,
      preview: noop,
      publish: noop,
      cancelBuild: noop,
      newFile: noop,
      respond: noop,
      setAnswer: noop,
    },
  };
}
it("uses the original collapsible dsh frame and opens source in the right panel", async () => {
  const p = props();
  const { container } = render(<DshDevelopmentShell {...p} />);
  await screen.findByText("探索未至之境");
  fireEvent.click(screen.getByLabelText("收起侧栏"));
  await waitFor(() =>
    expect(
      container.querySelector('[data-sidebar-collapsed="true"]'),
    ).not.toBeNull(),
  );
  fireEvent.click(screen.getAllByLabelText("源码")[0]);
  expect(await screen.findByLabelText("源码编辑器")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "src/App.tsx" }));
  expect(p.actions.open).toHaveBeenCalledWith("src/App.tsx");
  fireEvent.click(screen.getByLabelText("关闭面板"));
  expect(screen.queryByLabelText("源码编辑器")).toBeNull();
});
it("submits Enter, keeps Shift Enter editable and stops a running turn", async () => {
  const p = props();
  const view = render(<DshDevelopmentShell {...p} />);
  const input = await screen.findByLabelText("开发需求");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(p.actions.run).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(p.actions.run).toHaveBeenCalledOnce();
  view.rerender(<DshDevelopmentShell {...p} running />);
  expect(screen.getByLabelText("开发需求")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("停止"));
  expect(p.actions.stop).toHaveBeenCalledOnce();
});
it("creates projects through the dsh modal and sends the supplied name", async () => {
  const p = props();
  render(<DshDevelopmentShell {...p} />);
  fireEvent.click((await screen.findAllByLabelText("创建项目"))[0]);
  const input = await screen.findByLabelText("新项目名称");
  fireEvent.change(input, { target: { value: "new-app" } });
  fireEvent.click(screen.getByRole("button", { name: /^创建$/ }));
  expect(p.actions.create).toHaveBeenCalledWith("new-app");
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
