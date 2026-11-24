import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import ProfileApps from "@/app/(dashboard)/my/apps/page";

vi.mock("@/components/development/create-application-dialog", () => ({
  CreateApplicationDialog: () => null,
}));

afterEach(() => vi.unstubAllGlobals());

it("labels a synced shadow and opens it independently of a same-named local app", async () => {
  const shadow = { id: "https://peer.example/remote/todo-list", name: "todo-list", owner: "remote", host: "peer.example" };
  const open = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("localAppShadows", { list: vi.fn().mockResolvedValue([shadow]), open });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: [{ userId: "local", name: "todo-list", currentVersion: 1, updatedAt: "2026-11-23T10:00:00Z", lifecycleStatus: "online" }],
  }))));
  render(<ProfileApps />);
  const shadowButton = await screen.findByRole("button", { name: "打开影子应用 todo-list" });
  expect(screen.getByText("影子")).toBeVisible();
  expect(screen.getByRole("link", { name: "打开 todo-list" })).toHaveAttribute("href", "/local/todo-list");
  fireEvent.click(shadowButton);
  await waitFor(() => expect(open).toHaveBeenCalledWith(shadow.id));
});
