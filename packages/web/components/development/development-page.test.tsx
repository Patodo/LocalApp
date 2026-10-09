import React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DevelopmentPage } from "./development-page";
vi.mock("./dsh-view", () => ({
  DshMessages: () => null,
  DshMarkdown: () => null,
  DshDiff: () => null,
  DshTerminal: () => null,
}));
vi.mock("./dsh-development-shell", () => ({ DshDevelopmentShell: () => null }));
it("connects app source without a configured model", async () => {
  const fetcher = vi.fn(async (url: string) => {
    const data =
      url === "/api/agent/settings"
        ? { providers: [], defaultProviderId: "" }
        : url.includes("/source")
          ? { id: "p", name: "existing" }
          : [];
    return new Response(JSON.stringify({ success: true, data }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <DevelopmentPage application={{ owner: "owner", name: "existing" }} />,
  );
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/development/apps/owner/existing/source",
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("应用修改需求")).not.toBeDisabled(),
  );
  expect(screen.getByRole("link", { name: "配置模型" })).toBeInTheDocument();
});
it("invalidates the old build after an agent turn and compares changes with its original source", async () => {
  HTMLElement.prototype.scrollTo = vi.fn();
  const fetcher = vi.fn(async (url: string) => {
    if (url.endsWith("/agent/run"))
      return new Response('data: {"type":"session","sessionId":"session"}\n\n');
    const data =
      url === "/api/agent/settings"
        ? {
            providers: [{ id: "provider", name: "Provider", model: "model" }],
            defaultProviderId: "provider",
          }
        : url.includes("/source")
          ? { id: "p", name: "existing" }
          : url.endsWith("/builds")
            ? [
                {
                  id: "old",
                  status: "succeeded",
                  sourceVersion: "published-source",
                },
              ]
            : url.endsWith("/versions")
              ? [{ id: "current-source", message: "current" }]
              : [];
    return new Response(JSON.stringify({ success: true, data }));
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <DevelopmentPage application={{ owner: "owner", name: "existing" }} />,
  );
  fireEvent.click(screen.getByLabelText("展开开发对话"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^上线$/ })).not.toBeDisabled(),
  );
  fireEvent.change(screen.getByLabelText("应用修改需求"), {
    target: { value: "Change the page" },
  });
  fireEvent.click(screen.getByLabelText("发送修改需求"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /^上线$/ })).toBeDisabled(),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("应用修改需求")).not.toBeDisabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: /^改动$/ }));
  await waitFor(() =>
    expect(fetcher).toHaveBeenCalledWith(
      "/api/development/projects/p/diff?version=published-source",
      expect.anything(),
    ),
  );
});
