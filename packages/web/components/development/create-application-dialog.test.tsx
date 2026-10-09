import React from "react";
import { beforeEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateApplicationDialog } from "./create-application-dialog";
vi.mock("./dsh-view", () => ({
  DshMessages: ({ messages }: any) => <div>{JSON.stringify(messages)}</div>,
  DshMarkdown: ({ text }: any) => <p>{text}</p>,
}));
beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    value: vi.fn(),
    configurable: true,
  });
});
it("discusses first, confirms an agent proposal, and navigates with the same conversation", async () => {
  const creation = {
    projectId: "project",
    sessionId: "original-session",
    providerId: "model",
  };
  const proposal = { name: "task-board", description: "追踪工作项" };
  let proposed = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const ok = (data: unknown) =>
      new Response(JSON.stringify({ success: true, data }), {
        headers: { "Content-Type": "application/json" },
      });
    if (url === "/api/agent/settings")
      return ok({
        providers: [{ id: "model", name: "Model", model: "test" }],
        defaultProviderId: "model",
      });
    if (url === "/api/development/creations") return ok(creation);
    if (url.endsWith("/agent/run")) {
      expect(JSON.parse(init!.body as string).sessionId).toBe(
        "original-session",
      );
      proposed = true;
      return new Response(
        "data: " +
          JSON.stringify({ type: "text_delta", delta: "建议 task-board" }) +
          "\n\n" +
          "data: " +
          JSON.stringify({
            type: "creation",
            creation: { ...creation, proposal },
          }) +
          "\n\n",
      );
    }
    if (url.endsWith("/confirm")) {
      expect(JSON.parse(init!.body as string)).toEqual({ name: "task-board" });
      return ok({ ...creation, url: "/alice/task-board/?creation=project" });
    }
    if (url.includes("/agent/history"))
      return ok([{ role: "user", content: "做一个工作项应用" }]);
    return ok({ ...creation, ...(proposed ? { proposal } : {}) });
  });
  vi.stubGlobal("fetch", fetchMock);
  const created = vi.fn();
  render(
    <CreateApplicationDialog open onOpenChange={vi.fn()} onCreated={created} />,
  );
  expect(await screen.findByText("我们要构建什么？")).toBeVisible();
  await waitFor(() =>
    expect(screen.getByRole("combobox")).toHaveTextContent("Model"),
  );
  expect(
    fetchMock.mock.calls.some(([url]) => url === "/api/development/creations"),
  ).toBe(false);
  fireEvent.change(screen.getByLabelText("创建应用需求"), {
    target: { value: "做一个工作项应用" },
  });
  fireEvent.click(screen.getByLabelText("发送创建需求"));
  const confirm = await screen.findByRole("button", { name: "确认名称并创建" });
  expect(created).not.toHaveBeenCalled();
  fireEvent.click(confirm);
  await waitFor(() =>
    expect(created).toHaveBeenCalledWith("/alice/task-board/?creation=project"),
  );
});
