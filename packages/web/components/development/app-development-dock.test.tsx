import React from "react";
import { expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppDevelopmentDock } from "./app-development-dock";
import type { DevelopmentShellProps } from "./dsh-development-shell";
vi.mock("./dsh-view", () => ({
  DshMessages: () => null,
  DshMarkdown: () => null,
  DshDiff: () => null,
  DshTerminal: () => null,
}));
beforeEach(() => {
  HTMLElement.prototype.scrollTo = vi.fn();
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
      build: vi.fn(),
      preview: vi.fn(),
      publish: vi.fn(),
      cancelBuild: noop,
      newFile: noop,
      respond: vi.fn(),
      setAnswer: noop,
    },
  };
}

it("only expands from the top-left control, including while sending or running", () => {
  const p = props();
  const view = render(<AppDevelopmentDock {...p} />);
  expect(screen.queryByRole("log")).toBeNull();
  fireEvent.click(screen.getByLabelText("发送修改需求"));
  expect(p.actions.run).toHaveBeenCalledOnce();
  expect(screen.queryByRole("log")).toBeNull();
  fireEvent.click(screen.getByLabelText("展开开发对话"));
  expect(screen.getByRole("log")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /^上线$/ })).toBeDisabled();
  fireEvent.click(screen.getByLabelText("收起开发对话"));
  view.rerender(<AppDevelopmentDock {...p} running />);
  expect(screen.queryByRole("log")).toBeNull();
  expect(screen.getByLabelText("应用修改需求")).toBeDisabled();
  fireEvent.click(screen.getByLabelText("停止开发"));
  expect(p.actions.stop).toHaveBeenCalledOnce();
});
it("keeps IME and Shift Enter safe and connects build, preview and release controls", () => {
  const p = props();
  p.build = { id: "build", status: "succeeded" };
  const view = render(<AppDevelopmentDock {...p} />);
  const input = screen.getByLabelText("应用修改需求");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(p.actions.run).not.toHaveBeenCalled();
  fireEvent.focus(input);
  expect(screen.queryByRole("log")).toBeNull();
  fireEvent.click(screen.getByLabelText("展开开发对话"));
  fireEvent.click(screen.getByRole("button", { name: /^预览$/ }));
  fireEvent.click(screen.getByRole("button", { name: /^上线$/ }));
  expect(p.actions.preview).toHaveBeenCalledOnce();
  expect(p.actions.publish).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: /检查与构建/ }));
  expect(p.actions.build).toHaveBeenCalledOnce();
  view.rerender(
    <AppDevelopmentDock
      {...p}
      interaction={{
        kind: "approval",
        reason: "Run command",
        toolName: "terminal",
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "允许本次" }));
  expect(p.actions.respond).toHaveBeenCalledWith("allowed-once");
});
it("requires the original source instead of generating a replacement template", () => {
  render(<AppDevelopmentDock {...props()} project={null} />);
  fireEvent.click(screen.getByLabelText("展开开发对话"));
  expect(screen.getByText("接入这个应用的源码")).toBeInTheDocument();
  expect(screen.getByLabelText("应用修改需求")).toBeDisabled();
  expect(screen.queryByRole("button", { name: /^上线$/ })).toBeNull();
});

it("imports source while excluding generated packages, dependencies and credentials", async () => {
  const importSource = vi.fn().mockResolvedValue(undefined);
  render(
    <AppDevelopmentDock
      {...props()}
      project={null}
      importSource={importSource}
    />,
  );
  const file = (path: string, text: string) => ({
    webkitRelativePath: `my-app/${path}`,
    size: text.length,
    arrayBuffer: async () => new TextEncoder().encode(text).buffer,
  });
  fireEvent.change(screen.getByLabelText("导入应用源码目录"), {
    target: {
      files: [
        file("manifest.json", '{"name":"my-app"}'),
        file("package.json", "{}"),
        file("src/App.tsx", "export default App"),
        file("app.localapp", "\0binary"),
        file(".env", "secret"),
        file("node_modules/pkg/index.js", "dependency"),
      ],
    },
  });
  await waitFor(() => expect(importSource).toHaveBeenCalledOnce());
  expect(importSource.mock.calls[0][0]).toEqual({
    "manifest.json": '{"name":"my-app"}',
    "package.json": "{}",
    "src/App.tsx": "export default App",
  });
});
it("uses the title to switch history without changing the expanded state", () => {
  const p = props();
  p.sessions = [
    { id: "old-session", createdAt: "2026-10-09T01:00:00Z" },
    { id: "current-session", createdAt: "2026-10-09T02:00:00Z" },
  ];
  p.selectedSession = "current-session";
  p.actions.selectSession = vi.fn();
  render(<AppDevelopmentDock {...p} />);
  fireEvent.click(screen.getByLabelText("切换历史对话"));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(screen.queryByRole("log")).toBeNull();
  expect(
    screen.getByRole("menuitemradio", { name: /current-/ }),
  ).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("menuitemradio", { name: /old-sess/ }));
  expect(p.actions.selectSession).toHaveBeenCalledWith("old-session");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.queryByRole("log")).toBeNull();
  fireEvent.click(screen.getByLabelText("展开开发对话"));
  fireEvent.click(screen.getByLabelText("切换历史对话"));
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("log")).toBeInTheDocument();
});

it("uses the composer plus for attachments without creating a conversation or expanding", () => {
  const p = props();
  p.actions.upload = vi.fn();
  p.actions.newSession = vi.fn();
  render(
    <AppDevelopmentDock
      {...p}
      attachments={[{ id: "file", name: "brief.pdf", size: 20 }]}
    />,
  );
  fireEvent.click(screen.getByLabelText("上传文件"));
  const files = [new File(["PDF"], "brief.pdf", { type: "application/pdf" })];
  fireEvent.change(screen.getByLabelText("选择对话附件"), {
    target: { files },
  });
  expect(p.actions.upload).toHaveBeenCalledWith(files);
  expect(p.actions.newSession).not.toHaveBeenCalled();
  expect(screen.queryByRole("log")).toBeNull();
  expect(screen.getByLabelText("待发送附件")).toHaveTextContent("brief.pdf");
});
