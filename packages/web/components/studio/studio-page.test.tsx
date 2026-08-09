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
      if (url === "/api/workspaces/workspace-1/file?path=README.md" && !options?.method) {
        return new Response(JSON.stringify({ success: true, data: { path: "README.md", content: "# Original" } }));
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
    fireEvent.click(screen.getByRole("button", { name: "读取文件" }));
    await screen.findByDisplayValue("# Original");
    fireEvent.change(screen.getByLabelText("文件内容"), { target: { value: "# Demo" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文件" }));

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/workspaces/workspace-1/file", expect.objectContaining({
      method: "PUT",
      credentials: "include",
      body: JSON.stringify({ path: "README.md", content: "# Demo" }),
    })));
  });

  it("reads the selected file before editing and saves the edited content", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspaces") return new Response(JSON.stringify({ success: true, data: [workspace] }));
      if (url === "/api/workspaces/workspace-1/file?path=README.md" && !options?.method) {
        return new Response(JSON.stringify({ success: true, data: { path: "README.md", content: "# Original" } }));
      }
      if (url === "/api/workspaces/workspace-1/file" && options?.method === "PUT") return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ success: true, data: [] }));
    });
    render(<StudioPage />);
    await screen.findByText("demo");
    fireEvent.click(screen.getByRole("button", { name: "编辑 demo" }));
    fireEvent.change(screen.getByLabelText("文件路径"), { target: { value: "README.md" } });
    expect(screen.getByRole("button", { name: "保存文件" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "读取文件" }));
    await waitFor(() => expect(screen.getByLabelText("文件内容")).toHaveValue("# Original"));
    fireEvent.change(screen.getByLabelText("文件内容"), { target: { value: "# Edited" } });
    fireEvent.click(screen.getByRole("button", { name: "保存文件" }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/workspaces/workspace-1/file", expect.objectContaining({
      method: "PUT", credentials: "include", body: JSON.stringify({ path: "README.md", content: "# Edited" }),
    })));
  });

  it("does not apply a stale file read after selecting another workspace", async () => {
    const other = { ...workspace, id: "workspace-2", name: "other" };
    let resolveFirstRead: ((response: Response) => void) | undefined;
    vi.mocked(fetch).mockImplementation((input: RequestInfo | URL, options?: RequestInit) => {
      const url = String(input);
      if (url === "/api/workspaces") return Promise.resolve(new Response(JSON.stringify({ success: true, data: [workspace, other] })));
      if (url === "/api/workspaces/workspace-1/file?path=README.md" && !options?.method) return new Promise((resolve) => { resolveFirstRead = resolve; });
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: [] })));
    });
    render(<StudioPage />);
    await screen.findByText("demo");
    fireEvent.click(screen.getByRole("button", { name: "编辑 demo" }));
    fireEvent.change(screen.getByLabelText("文件路径"), { target: { value: "README.md" } });
    fireEvent.click(screen.getByRole("button", { name: "读取文件" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 other" }));
    resolveFirstRead?.(new Response(JSON.stringify({ success: true, data: { path: "README.md", content: "stale" } })));
    await waitFor(() => expect(screen.getByRole("heading", { name: "编辑 other" })).toBeInTheDocument());
    expect(screen.getByLabelText("文件路径")).toHaveValue("");
    expect(screen.getByLabelText("文件内容")).toHaveValue("");
  });

  it("surfaces file read failures", async () => {
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) === "/api/workspaces") return new Response(JSON.stringify({ success: true, data: [workspace] }));
      if (String(input) === "/api/workspaces/workspace-1/file?path=README.md" && !options?.method) return new Response(JSON.stringify({ success: false, error: "文件不存在" }), { status: 404 });
      return new Response(JSON.stringify({ success: true, data: [] }));
    });
    render(<StudioPage />);
    await screen.findByText("demo");
    fireEvent.click(screen.getByRole("button", { name: "编辑 demo" }));
    fireEvent.change(screen.getByLabelText("文件路径"), { target: { value: "README.md" } });
    fireEvent.click(screen.getByRole("button", { name: "读取文件" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("文件不存在"));
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
