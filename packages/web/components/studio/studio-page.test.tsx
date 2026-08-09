import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioPage } from "./studio-page";

const workspace = {
  id: "workspace-1",
  ownerId: "owner",
  name: "demo",
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
};

describe("StudioPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspaces" && options?.method === "POST") {
        return new Response(JSON.stringify({ success: true, data: workspace }), { status: 201 });
      }
      if (url === "/api/workspaces/workspace-1/file" && options?.method === "PUT") {
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ success: true, data: [] }));
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("creates an owned workspace and saves an edited file with credentials", async () => {
    render(<StudioPage />);
    await screen.findByText("暂无工作区");

    fireEvent.change(screen.getByLabelText("工作区名称"), { target: { value: "demo" } });
    fireEvent.click(screen.getByRole("button", { name: "创建工作区" }));
    await screen.findByText("demo");
    fireEvent.click(screen.getByRole("button", { name: "编辑 demo" }));
    fireEvent.change(screen.getByLabelText("文件路径"), { target: { value: "README.md" } });
    fireEvent.change(screen.getByLabelText("文件内容"), { target: { value: "# Demo" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文件" }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/workspaces/workspace-1/file", expect.objectContaining({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ path: "README.md", content: "# Demo" }),
    })));
  });

  it("imports an archive into an owned workspace", async () => {
    render(<StudioPage />);
    await screen.findByText("暂无工作区");
    fireEvent.change(screen.getByLabelText("导入工作区名称"), { target: { value: "imported" } });
    const archive = new File(["zip"], "workspace.zip", { type: "application/zip" });
    fireEvent.change(screen.getByLabelText("工作区归档"), { target: { files: [archive] } });
    fireEvent.click(screen.getByRole("button", { name: "导入归档" }));

    await waitFor(() => {
      const call = vi.mocked(fetch).mock.calls.find(([url, options]) => String(url) === "/api/workspaces/import" && options?.method === "POST");
      expect(call?.[1]?.credentials).toBe("include");
      expect((call?.[1]?.body as FormData).get("name")).toBe("imported");
      expect((call?.[1]?.body as FormData).get("archive")).toBe(archive);
    });
  });
});
