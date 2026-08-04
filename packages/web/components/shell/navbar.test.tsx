import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { Navbar } from "./navbar";

vi.mock("@/components/auth-modals/auth-provider", () => ({
  useAuthModals: () => ({ openLogin: vi.fn() }),
}));

describe("Navbar edit session controls", () => {
  it("renders a labeled Issue entry with the open count in the left app area", () => {
    const onOpenIssues = vi.fn();
    render(
      React.createElement(Navbar, {
        pageName: "Research Pipeline",
        user: { id: "u1", name: "alice" },
        favCount: 2,
        isFavorited: false,
        onToggleFavorite: vi.fn(),
        onOpenIssues,
        openIssueCount: 3,
      }),
    );

    const left = screen.getByTestId("localapp-platform-nav-left");
    const right = screen.getByTestId("localapp-platform-nav-right");
    const button = within(left).getByRole("button", { name: "Issue，3 个待处理" });

    expect(within(button).getByText("Issue")).toHaveClass("hidden", "sm:inline");
    expect(within(button).getByTestId("localapp-open-issue-count")).toHaveTextContent("3");
    expect(within(right).queryByRole("button", { name: "Issue，3 个待处理" })).toBeNull();

    fireEvent.click(button);
    expect(onOpenIssues).toHaveBeenCalledOnce();
  });

  it("keeps the zero Open Issue count visible with a quiet state", () => {
    render(
      React.createElement(Navbar, {
        pageName: "Research Pipeline",
        user: null,
        favCount: 0,
        isFavorited: false,
        onToggleFavorite: vi.fn(),
        onOpenIssues: vi.fn(),
        openIssueCount: 0,
      }),
    );

    const button = screen.getByRole("button", { name: "Issue，0 个待处理" });
    expect(within(button).getByTestId("localapp-open-issue-count")).toHaveAttribute("data-empty", "true");
  });

  it("renders save undo and redo in the left app area only", () => {
    render(
      React.createElement(Navbar, {
        pageName: "Research Pipeline",
        user: { id: "u1", name: "alice" },
        favCount: 2,
        isFavorited: false,
        onToggleFavorite: vi.fn(),
        onOpenIssues: vi.fn(),
        editSession: {
          canSave: true,
          canUndo: true,
          canRedo: false,
          busy: false,
          onSave: vi.fn(),
          onUndo: vi.fn(),
          onRedo: vi.fn(),
        },
      }),
    );

    const left = screen.getByTestId("localapp-platform-nav-left");
    const right = screen.getByTestId("localapp-platform-nav-right");

    expect(within(left).getByRole("button", { name: "保存" })).toBeEnabled();
    expect(within(left).getByRole("button", { name: "撤销" })).toBeEnabled();
    expect(within(left).getByRole("button", { name: "重做" })).toBeDisabled();
    expect(within(right).queryByRole("button", { name: "保存" })).toBeNull();
    expect(within(right).queryByRole("button", { name: "撤销" })).toBeNull();
    expect(within(right).queryByRole("button", { name: "重做" })).toBeNull();
  });

  it("renders online user count in the left app area only", () => {
    render(
      React.createElement(Navbar, {
        pageName: "Research Pipeline",
        user: { id: "u1", name: "alice" },
        favCount: 2,
        isFavorited: false,
        onToggleFavorite: vi.fn(),
        onOpenIssues: vi.fn(),
        presenceCount: 3,
      }),
    );

    const left = screen.getByTestId("localapp-platform-nav-left");
    const right = screen.getByTestId("localapp-platform-nav-right");

    expect(within(left).getByLabelText("当前在线用户 3 人")).toBeInTheDocument();
    expect(within(left).getByText("3")).toBeInTheDocument();
    expect(within(right).queryByLabelText("当前在线用户 3 人")).toBeNull();
  });

  it("opens an online-user list and closes it with Escape", () => {
    render(
      React.createElement(Navbar, {
        pageName: "Research Pipeline",
        user: { id: "u1", name: "alice" },
        favCount: 0,
        isFavorited: false,
        onToggleFavorite: vi.fn(),
        onOpenIssues: vi.fn(),
        presenceSnapshot: {
          count: 3,
          anonymousCount: 1,
          authenticatedUsers: [
            { id: "u1", name: "alice", displayName: "Alice", avatarUrl: null },
            { id: "u2", name: "bob", displayName: null, avatarUrl: null },
          ],
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "当前在线用户 3 人" }));
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("匿名访客 1 人")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("@alice")).toBeNull();
  });
});
