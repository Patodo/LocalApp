import React from "react";
import { expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppDevelopmentDock } from "./app-development-dock";
import type { DevelopmentShellProps } from "./dsh-development-shell";
vi.mock("./dsh-view", () => ({
  DshMessages: () => null,
  DshMarkdown: ({ text }: { text: string }) => <span>{text}</span>,
  DshDiff: () => null,
  DshTerminal: () => null,
  DshRunningStatus: () => <div role="status">正在处理…</div>,
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
    { id: "old-session", title: "旧会话", createdAt: "2026-10-09T01:00:00Z" },
    { id: "current-session", title: "当前会话", createdAt: "2026-10-09T02:00:00Z" },
  ];
  p.selectedSession = "current-session";
  p.actions.selectSession = vi.fn();
  render(<AppDevelopmentDock {...p} />);
  fireEvent.keyDown(screen.getByLabelText("切换历史对话"), {key: "Enter"});
  expect(screen.getByRole("menu")).toBeInTheDocument();
  expect(screen.queryByRole("log")).toBeNull();
  expect(
    screen.getByRole("menuitemradio", { name: /当前会话/ }),
  ).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("menuitemradio", { name: /旧会话/ }));
  expect(p.actions.selectSession).toHaveBeenCalledWith("old-session");
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.queryByRole("log")).toBeNull();
  fireEvent.click(screen.getByLabelText("展开开发对话"));
  fireEvent.keyDown(screen.getByLabelText("切换历史对话"), {key: "Enter"});
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

it("reports default visibility and synchronizes minimize and reveal with the platform", () => {
  const p = props();
  const onVisibilityChange = vi.fn();
  const view = render(<AppDevelopmentDock {...p} onVisibilityChange={onVisibilityChange} />);
  expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
  view.rerender(<AppDevelopmentDock {...p} onVisibilityChange={onVisibilityChange} minimize={1} />);
  expect(screen.getByLabelText("已最小化的开发对话")).toBeInTheDocument();
  expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
  view.rerender(<AppDevelopmentDock {...p} onVisibilityChange={onVisibilityChange} minimize={1} reveal={1} />);
  expect(screen.getByLabelText("最小化开发对话")).toBeInTheDocument();
  expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByLabelText("最小化开发对话"));
  expect(onVisibilityChange).toHaveBeenLastCalledWith(false);
  fireEvent.click(screen.getByLabelText("恢复开发对话"));
  expect(onVisibilityChange).toHaveBeenLastCalledWith(true);
});

it("minimizes without stopping work, shows a spinner, then previews only the final reply", () => {
  const p = props();
  p.messages = [
    { role: "user", content: "request" },
    {
      role: "assistant",
      content: [
        { type: "text", text: "Intermediate" },
        { type: "toolCall", id: "tool", name: "read" },
      ],
    },
  ];
  const view = render(<AppDevelopmentDock {...p} running />);
  fireEvent.click(screen.getByLabelText("最小化开发对话"));
  expect(screen.queryByLabelText("应用修改需求")).toBeNull();
  expect(
    screen
      .getByLabelText("任务进行中，恢复对话")
      .querySelector(".dock-spinner"),
  ).not.toBeNull();
  expect(p.actions.stop).not.toHaveBeenCalled();
  fireEvent.mouseEnter(screen.getByLabelText("已最小化的开发对话"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  view.rerender(
    <AppDevelopmentDock
      {...p}
      messages={[
        ...p.messages,
        {
          role: "assistant",
          content: [
            { type: "reasoning", text: "Private reasoning" },
            { type: "text", text: "Final answer" },
          ],
        },
      ]}
    />,
  );
  expect(screen.getByRole("tooltip")).toHaveTextContent("Final answer");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent("Intermediate");
  expect(screen.getByRole("tooltip")).not.toHaveTextContent(
    "Private reasoning",
  );
  fireEvent.click(screen.getByLabelText("关闭消息预览"));
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.click(screen.getByLabelText("恢复开发对话"));
  expect(screen.getByLabelText("应用修改需求")).toBeInTheDocument();
});
it("does not preview a previous turn after the latest user request has no final reply", () => {
  const p = props();
  p.messages = [
    { role: "assistant", content: "Previous reply" },
    { role: "user", content: "Latest request" },
  ];
  render(<AppDevelopmentDock {...p} />);
  fireEvent.click(screen.getByLabelText("最小化开发对话"));
  fireEvent.mouseEnter(screen.getByLabelText("已最小化的开发对话"));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("shows the selected conversation title in the header, history and minimized preview", () => {
  const p = props();
  p.sessions = [{ id: "session", createdAt: "2026-10-09T12:00:00Z", title: "添加工作项筛选" }];
  p.selectedSession = "session";
  p.messages = [{ role: "assistant", content: "完成" }];
  render(<AppDevelopmentDock {...p} />);
  expect(screen.getByLabelText("切换历史对话").textContent).toContain("添加工作项筛选");
  fireEvent.keyDown(screen.getByLabelText("切换历史对话"), {key: "Enter"});
  expect(screen.getByRole("menuitemradio", { name: /添加工作项筛选/ })).toBeTruthy();
  fireEvent.click(screen.getByLabelText("最小化开发对话"));
  fireEvent.mouseEnter(screen.getByLabelText("已最小化的开发对话"));
  expect(screen.getByRole("tooltip").textContent).toContain("添加工作项筛选");
});

it("switches identity above history and hides developer actions in user mode", () => {
  const developer = props(), user = props();
  developer.sessions = [{ id: "developer-session", createdAt: "2026-10-09", title: "修改应用样式" }];
  developer.selectedSession = "developer-session";
  user.sessions = [{ id: "user-session", createdAt: "2026-10-09", title: "创建工作项" }];
  user.selectedSession = "user-session";
  user.prompt = "帮我创建工作项";
  const switchIdentity = vi.fn();
  const view = render(<AppDevelopmentDock {...developer} identity="developer" userConversation={user} onIdentityChange={switchIdentity} />);
  fireEvent.keyDown(screen.getByLabelText("切换历史对话"), {key: "Enter"});
  fireEvent.click(screen.getByLabelText("切换对话身份"));
  expect(switchIdentity).toHaveBeenCalledWith("user");
  expect(screen.getByRole("menuitemradio", { name: /修改应用样式/ })).toBeInTheDocument();
  expect(screen.queryByRole("menuitemradio", { name: /创建工作项/ })).toBeNull();
  view.rerender(<AppDevelopmentDock {...developer} identity="user" userConversation={user} onIdentityChange={switchIdentity} />);
  expect(screen.getByLabelText("应用对话消息")).toHaveValue("帮我创建工作项");
  expect(screen.getByRole("menu", { name: "应用历史对话" })).toBeInTheDocument();
  expect(screen.getByRole("menuitemradio", { name: /创建工作项/ })).toBeInTheDocument();
  expect(screen.queryByRole("menuitemradio", { name: /修改应用样式/ })).toBeNull();
  fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
  expect(screen.queryByLabelText("切换对话身份")).toBeNull();
  fireEvent.click(screen.getByLabelText("展开应用对话"));
  expect(screen.queryByLabelText("开发操作")).toBeNull();
  expect(screen.queryByLabelText("打开完整开发页")).toBeNull();
  fireEvent.click(screen.getByLabelText("发送对话消息"));
  expect(user.actions.run).toHaveBeenCalledOnce();
  expect(developer.actions.run).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("切换历史对话"), {key: "Enter"});
  fireEvent.click(screen.getByLabelText("切换对话身份"));
  expect(switchIdentity).toHaveBeenLastCalledWith("developer");
  view.rerender(<AppDevelopmentDock {...developer} identity="user" userConversation={{ ...user, running: true }} onIdentityChange={switchIdentity} />);
  expect(screen.getByLabelText("切换对话身份")).toBeDisabled();
});

it("allows an owner without imported source to switch to user conversations", () => {
  render(<AppDevelopmentDock {...props()} project={null} identity="developer" onIdentityChange={vi.fn()} />);
  expect(screen.getByLabelText("切换历史对话")).toBeEnabled();
  fireEvent.keyDown(screen.getByLabelText("切换历史对话"), {key: "Enter"});
  expect(screen.getByLabelText("切换对话身份")).toBeEnabled();
});
