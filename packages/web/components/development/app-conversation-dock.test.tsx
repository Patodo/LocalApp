import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { HarnessAgent } from "@localapp/sdk-agent/harness-client";
import { AppConversationDock } from "./app-conversation-dock";
const developerMount = vi.hoisted(() => vi.fn());
vi.mock("./development-page", () => ({ DevelopmentPage: (props: any) => { developerMount(props); return <div>开发者控制器</div>; } }));
vi.mock("./dsh-view", () => ({ DshMessages: () => null, DshMarkdown: () => null, DshDiff: () => null, DshTerminal: () => null }));

it("gives ordinary users the shared chat without mounting development APIs", async () => {
  HTMLElement.prototype.scrollTo = vi.fn();
  developerMount.mockClear();
  const agent = {
    appId: "owner/app", sessionId: "session", providerId: undefined,
    state: { messages: [], interactions: [], isStreaming: false },
    settings: vi.fn(async () => ({ providers: [{ id: "model", name: "我的模型", model: "test" }], defaultProviderId: "model" })),
    listSessions: vi.fn(async () => []), subscribe: vi.fn(() => () => {}), startBackgroundEvents: vi.fn(),
  };
  const onSend = vi.fn(async () => {});
  render(<AppConversationDock application={{ owner: "owner", name: "app" }} isOwner={false} agent={agent as unknown as HarnessAgent} onSend={onSend} />);
  await waitFor(() => expect(screen.getByLabelText("对话模型")).toHaveTextContent("我的模型 · test"));
  expect(screen.queryByLabelText("切换对话身份")).toBeNull();
  expect(screen.queryByLabelText("打开完整开发页")).toBeNull();
  fireEvent.change(screen.getByLabelText("应用对话消息"), { target: { value: "添加工作项" } });
  fireEvent.click(screen.getByLabelText("发送对话消息"));
  await waitFor(() => expect(onSend).toHaveBeenCalledWith("添加工作项"));
  expect(developerMount).not.toHaveBeenCalled();
});

it("offers owner identity switching while keeping a separate user conversation", () => {
  developerMount.mockClear();
  render(<AppConversationDock application={{ owner: "owner", name: "app" }} isOwner agent={null} onSend={vi.fn()} />);
  const props = developerMount.mock.calls.at(-1)![0];
  expect(props.dock.identity).toBe("developer");
  expect(props.dock.onIdentityChange).toBeTypeOf("function");
  expect(props.dock.userConversation.messages).toEqual([]);
  expect(props.dock.userConversation.project.id).toBe("application");
});
