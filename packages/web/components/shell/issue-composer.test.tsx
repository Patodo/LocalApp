import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IssueComposer } from "./issue-composer";

const candidates = [
  { id: "alice", name: "alice", displayName: "Alice", avatarUrl: null },
  { id: "alicia", name: "alicia", displayName: "Alicia", avatarUrl: null },
  { id: "bob", name: "bob", displayName: "Bob", avatarUrl: null },
];

describe("IssueComposer mentions", () => {
  beforeEach(() => sessionStorage.clear());

  it("uses mobile touch targets while preserving compact desktop controls", () => {
    render(<IssueComposer pagePath="owner/app" draftId="draft-touch" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "编辑" })).toHaveClass("h-11", "sm:h-7");
    expect(screen.getByRole("tab", { name: "预览" })).toHaveClass("h-11", "sm:h-7");
    expect(screen.getByRole("button", { name: "粗体" })).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    expect(screen.getByRole("button", { name: "添加附件" })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("button", { name: "评论" })).toHaveClass("h-11", "sm:h-8");
  });

  it("uses a contextual placeholder without changing the accessible name or submitted body", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<IssueComposer pagePath="owner/app" draftId="draft-placeholder" textareaLabel="评论内容" placeholder="留下评论" submitLabel="评论" attachments={false} onSubmit={onSubmit} />);
    const editor = screen.getByRole("textbox", { name: "评论内容" });
    expect(editor).toHaveAttribute("placeholder", "留下评论");
    fireEvent.change(editor, { target: { value: "实际评论" } });
    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ body: "实际评论" })));
    expect(onSubmit.mock.calls[0][0].body).not.toContain("留下评论");
  });

  it("searches and inserts a saved reply without submitting the comment", async () => {
    const onSubmit = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ success: true, data: [
        { id: 1, title: "请求日志", body: "请补充 %cursor%日志。", createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z" },
        { id: 2, title: "无法复现", body: "当前无法复现。", createdAt: "2026-07-13T00:00:00.000Z", updatedAt: "2026-07-13T00:00:00.000Z" },
      ] }),
    } as unknown as Response);
    render(<IssueComposer pagePath="owner/app" draftId="saved-reply" textareaLabel="评论内容" submitLabel="评论" attachments={false} savedReplies onSubmit={onSubmit} />);
    const editor = screen.getByRole("textbox", { name: "评论内容" }) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: "前文 旧内容 后文", selectionStart: 3, selectionEnd: 6 } });
    fireEvent.keyDown(editor, { key: ".", ctrlKey: true });

    expect(await screen.findByRole("dialog", { name: "保存回复" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索保存回复" }), { target: { value: "日志" } });
    expect(screen.getByRole("option", { name: "请求日志" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "无法复现" })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "请求日志" }));

    expect(editor).toHaveValue("前文 请补充 日志。 后文");
    await waitFor(() => expect(editor).toHaveFocus());
    expect(editor.selectionStart).toBe(7);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reports restored and edited body text without taking ownership from the composer", async () => {
    const onBodyChange = vi.fn();
    render(<IssueComposer pagePath="owner/app" draftId="draft-body-change" initialBody="restored body" textareaLabel="描述" submitLabel="提交" attachments={false} onBodyChange={onBodyChange} onSubmit={vi.fn()} />);
    await waitFor(() => expect(onBodyChange).toHaveBeenLastCalledWith("restored body"));
    fireEvent.change(screen.getByRole("textbox", { name: "描述" }), { target: { value: "edited body" } });
    await waitFor(() => expect(onBodyChange).toHaveBeenLastCalledWith("edited body"));
  });

  it("uses one toolbar tab stop with wrapping arrow and Home/End navigation", () => {
    render(<IssueComposer pagePath="owner/app" draftId="draft-toolbar-nav" textareaLabel="评论内容" submitLabel="评论" attachments={false} onSubmit={vi.fn()} />);
    const toolbar = screen.getByRole("toolbar", { name: "Markdown 工具栏" });
    const labels = ["标题格式", "粗体", "斜体", "引用", "行内代码", "链接", "无序列表", "有序列表", "任务列表"];
    const buttons = labels.map((label) => within(toolbar).getByRole("button", { name: label }));
    expect(buttons.map((button) => button.tabIndex)).toEqual([0, -1, -1, -1, -1, -1, -1, -1, -1]);

    buttons[0].focus();
    fireEvent.keyDown(buttons[0], { key: "ArrowLeft" });
    expect(buttons[8]).toHaveFocus();
    expect(buttons.map((button) => button.tabIndex)).toEqual([-1, -1, -1, -1, -1, -1, -1, -1, 0]);
    fireEvent.keyDown(buttons[8], { key: "ArrowRight" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "End" });
    expect(buttons[8]).toHaveFocus();
    fireEvent.keyDown(buttons[8], { key: "Home" });
    expect(buttons[0]).toHaveFocus();
    fireEvent.keyDown(buttons[0], { key: "ArrowDown" });
    expect(buttons[1]).toHaveFocus();
    fireEvent.keyDown(buttons[1], { key: "ArrowUp" });
    expect(buttons[0]).toHaveFocus();

    fireEvent.focus(buttons[5]);
    expect(buttons[5]).toHaveAttribute("tabindex", "0");
    expect(buttons[0]).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("textbox", { name: "评论内容" })).toHaveValue("");
  });

  it("filters candidates and selects the active option with the keyboard", async () => {
    render(<IssueComposer pagePath="owner/app" draftId="draft" textareaLabel="评论内容" submitLabel="评论" attachments={false} mentionCandidates={candidates} onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox", { name: "评论内容" }) as HTMLTextAreaElement;

    textarea.focus();
    fireEvent.change(textarea, { target: { value: "Before @al after", selectionStart: 10, selectionEnd: 10 } });
    expect(textarea).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox", { name: "提及用户建议" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Alice，账号 @alice" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: "Alicia，账号 @alicia" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getAllByRole("option")[0]).toHaveClass("min-h-11", "sm:min-h-10");
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(screen.getAllByRole("option")[1]).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(textarea).toHaveValue("Before @alicia  after");
    await waitFor(() => expect(textarea).toHaveFocus());
    await waitFor(() => expect(textarea.selectionStart).toBe(15));
    expect(screen.queryByRole("listbox", { name: "提及用户建议" })).toBeNull();
  });

  it("closes suggestions with Escape without changing the draft", () => {
    const onParentKeyDown = vi.fn();
    render(<div onKeyDown={onParentKeyDown}><IssueComposer pagePath="owner/app" draftId="draft-escape" textareaLabel="描述" submitLabel="提交" attachments={false} mentionCandidates={candidates} onSubmit={vi.fn()} /></div>);
    const textarea = screen.getByRole("textbox", { name: "描述" });
    fireEvent.change(textarea, { target: { value: "@bo", selectionStart: 3, selectionEnd: 3 } });
    expect(screen.getByRole("option")).toHaveTextContent("Bob");
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(textarea).toHaveValue("@bo");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it("announces an empty mention result without exposing an empty listbox", () => {
    render(<IssueComposer pagePath="owner/app" draftId="draft-no-mention" textareaLabel="评论内容" submitLabel="评论" attachments={false} mentionCandidates={candidates} onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox", { name: "评论内容" });

    fireEvent.change(textarea, { target: { value: "@missing", selectionStart: 8, selectionEnd: 8 } });

    expect(textarea).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("listbox", { name: "提及用户建议" })).toBeNull();
    expect(screen.getByRole("status", { name: "提及用户建议状态" })).toHaveTextContent("没有匹配的用户");
  });

  it("toggles edit and preview with the GitHub keyboard shortcut", async () => {
    render(<IssueComposer pagePath="owner/app" draftId="draft-preview" textareaLabel="描述" submitLabel="提交" attachments={false} onSubmit={vi.fn()} />);
    const textarea = screen.getByRole("textbox", { name: "描述" });
    fireEvent.change(textarea, { target: { value: "保留的正文" } });

    fireEvent.keyDown(textarea, { key: "p", metaKey: true, shiftKey: true });
    expect(screen.getByRole("tab", { name: "预览", selected: true })).toHaveAttribute("aria-keyshortcuts", "Meta+Shift+P Control+Shift+P");
    expect(screen.getByText("保留的正文")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("tab", { name: "预览", selected: true })).toHaveFocus());

    fireEvent.keyDown(screen.getByRole("tab", { name: "预览", selected: true }), { key: "p", ctrlKey: true, shiftKey: true });
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("保留的正文");
  });

  it("identifies and discards a restored unsent draft", async () => {
    const key = "localapp:test:comment-draft";
    const onDiscardRestoredDraft = vi.fn();
    sessionStorage.setItem(key, "恢复的未提交评论");
    render(<IssueComposer pagePath="owner/app" draftId="draft-restored" textareaLabel="评论内容" submitLabel="评论" attachments={false} persistenceKey={key} showRestoredDraftNotice onDiscardRestoredDraft={onDiscardRestoredDraft} onSubmit={vi.fn()} />);

    expect(screen.getByText("已恢复未提交的草稿")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "评论内容" })).toHaveValue("恢复的未提交评论");
    const discardTrigger = screen.getByRole("button", { name: "丢弃草稿" });
    discardTrigger.focus();
    fireEvent.click(discardTrigger);

    const confirmation = screen.getByRole("alertdialog", { name: "丢弃草稿确认" });
    expect(confirmation).toHaveTextContent("未提交内容和已上传附件将被清除且无法恢复");
    expect(screen.getByRole("button", { name: "保留草稿" })).toHaveFocus();
    expect(screen.getByRole("textbox", { name: "评论内容" })).toHaveValue("恢复的未提交评论");
    expect(sessionStorage.getItem(key)).toBe("恢复的未提交评论");
    expect(onDiscardRestoredDraft).not.toHaveBeenCalled();

    fireEvent.keyDown(confirmation, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "确认丢弃" })).toHaveFocus();
    fireEvent.keyDown(confirmation, { key: "Tab" });
    expect(screen.getByRole("button", { name: "保留草稿" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "保留草稿" }));
    expect(screen.queryByRole("alertdialog", { name: "丢弃草稿确认" })).toBeNull();
    await waitFor(() => expect(discardTrigger).toHaveFocus());

    fireEvent.click(discardTrigger);
    fireEvent.keyDown(screen.getByRole("alertdialog", { name: "丢弃草稿确认" }), { key: "Escape" });
    await waitFor(() => expect(discardTrigger).toHaveFocus());
    expect(sessionStorage.getItem(key)).toBe("恢复的未提交评论");

    fireEvent.click(discardTrigger);
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃" }));

    expect(screen.getByRole("textbox", { name: "评论内容" })).toHaveValue("");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "评论内容" })).toHaveFocus());
    expect(sessionStorage.getItem(key)).toBeNull();
    expect(screen.queryByText("已恢复未提交的草稿")).toBeNull();
    expect(onDiscardRestoredDraft).toHaveBeenCalledOnce();
  });

  it("keeps file drag feedback stable across children and resets after drop", async () => {
    render(<IssueComposer pagePath="owner/app" draftId="draft-drop" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);
    const target = screen.getByLabelText("拖拽附件到此处");
    const button = screen.getByRole("button", { name: "添加附件" });
    const file = new File([], "empty.png", { type: "image/png" });
    const fileTransfer = { types: ["Files"], files: [file] };
    fireEvent.change(screen.getByRole("textbox", { name: "评论内容" }), { target: { value: "附件失败时仍保留正文" } });

    fireEvent.dragEnter(target, { dataTransfer: fileTransfer });
    expect(target).toHaveAttribute("data-drag-active", "true");
    expect(screen.getByRole("status", { name: "附件拖拽状态" })).toHaveTextContent("松开以上传文件");

    fireEvent.dragEnter(button, { dataTransfer: fileTransfer });
    fireEvent.dragLeave(button, { dataTransfer: fileTransfer });
    expect(target).toHaveAttribute("data-drag-active", "true");

    fireEvent.drop(target, { dataTransfer: fileTransfer });
    expect(target).not.toHaveAttribute("data-drag-active");
    expect(screen.getAllByText("empty.png")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("请移除或重试上传失败的附件");
    expect(screen.getByRole("button", { name: "评论" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "重试 empty.png" })).toHaveClass("h-11", "w-11", "shrink-0", "sm:h-7", "sm:w-7");
    expect(screen.getByRole("button", { name: "移除 empty.png" })).toHaveClass("h-11", "w-11", "shrink-0", "sm:h-7", "sm:w-7");

    screen.getByRole("button", { name: "移除 empty.png" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "移除 empty.png" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "评论" })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "添加附件" })).toHaveFocus());

    fireEvent.dragEnter(target, { dataTransfer: { types: ["text/plain"], files: [] } });
    expect(target).not.toHaveAttribute("data-drag-active");
  });

  it("moves focus to the next or previous visible attachment after removal", async () => {
    render(<IssueComposer pagePath="owner/app" draftId="draft-remove-focus" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);
    const files = ["first.txt", "middle.txt", "last.txt"].map((name) => new File([], name, { type: "text/plain" }));
    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files } });

    const middle = screen.getByRole("button", { name: "移除 middle.txt" });
    middle.focus();
    fireEvent.click(middle);
    await waitFor(() => expect(screen.getByRole("button", { name: "移除 last.txt" })).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "移除 last.txt" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "移除 first.txt" })).toHaveFocus());
  });

  it("shows an explicit per-file ready state after upload completes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 201,
      headers: new Headers({ "content-type": "application/json" }),
      json: vi.fn().mockResolvedValue({ success: true, data: { id: "attachment-ready", url: "/api/issues/attachments/attachment-ready", issue_id: null, comment_id: null, draft_id: "draft-ready", uploader_id: "alice", file_name: "screen [final].png", mime_type: "image/png", size_bytes: 3, created_at: "2026-07-12T00:00:00.000Z" } }),
      text: vi.fn(),
    } as unknown as Response);
    render(<IssueComposer pagePath="owner/app" draftId="draft-ready" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["png"], "screen [final].png", { type: "image/png" })] } });

    const ready = await screen.findByRole("status", { name: "screen [final].png 已上传" });
    expect(ready).toHaveTextContent("已上传 · 3 B");
    expect(screen.getByRole("textbox", { name: "评论内容" })).toHaveValue("![screen \\[final\\]\\.png](/api/issues/attachments/attachment-ready)");
    expect(screen.getByRole("button", { name: "评论" })).toBeEnabled();
  });

  it("shows one upload message plus a reduced-motion decorative spinner", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise<Response>(() => {}));
    const { container } = render(<IssueComposer pagePath="owner/app" draftId="draft-uploading" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);
    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["png"], "uploading.png", { type: "image/png" })] } });

    expect(screen.getAllByText("上传中...")).toHaveLength(1);
    const spinner = container.querySelector(".lucide-loader-circle");
    expect(spinner).toHaveClass("animate-spin", "motion-reduce:animate-none");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByLabelText("拖拽附件到此处")).toHaveAttribute("aria-busy", "true");
    const queueStatus = screen.getByRole("status", { name: "附件队列状态" });
    expect(queueStatus).toHaveAttribute("aria-live", "polite");
    expect(queueStatus).toHaveAttribute("aria-atomic", "true");
    expect(queueStatus).toHaveTextContent("1 个上传中，0 个已就绪，0 个失败");
  });

  it("accepts only the first 20 draft attachments and restores capacity after removal", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => new Promise(() => undefined));
    fetchSpy.mockClear();
    render(<IssueComposer pagePath="owner/app" draftId="draft-limit" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);
    const files = Array.from({ length: 21 }, (_, index) => new File(["x"], `limit-${index}.txt`, { type: "text/plain" }));

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files } });

    expect(fetchSpy).toHaveBeenCalledTimes(20);
    expect(screen.getByRole("alert")).toHaveTextContent("每个草稿最多添加 20 个附件；已忽略 1 个文件");
    expect(screen.queryByText("limit-20.txt")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "移除 limit-0.txt" }));
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByTestId("issue-attachment-input"), {
      target: { files: [new File(["x"], "replacement.txt", { type: "text/plain" })] },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(21);
    expect(screen.getByText("replacement.txt")).toBeInTheDocument();
  });

  it("collapses uploaded attachments after four and expands the complete queue", async () => {
    let uploadIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const index = uploadIndex++;
      return {
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true, data: { id: `collapsed-${index}`, url: `/api/issues/attachments/collapsed-${index}`, issue_id: null, comment_id: null, draft_id: "draft-collapse", uploader_id: "alice", file_name: `collapsed-${index}.txt`, mime_type: "text/plain", size_bytes: 1, created_at: "2026-07-12T00:00:00.000Z" } }),
        text: vi.fn(),
      } as unknown as Response;
    });
    render(<IssueComposer pagePath="owner/app" draftId="draft-collapse" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);
    const files = Array.from({ length: 6 }, (_, index) => new File(["x"], `collapsed-${index}.txt`, { type: "text/plain" }));

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files } });
    await waitFor(() => expect(screen.getByRole("button", { name: "显示其余 2 个已上传附件" })).toBeInTheDocument());

    const disclosure = screen.getByRole("button", { name: "显示其余 2 个已上传附件" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(disclosure).toHaveAttribute("aria-controls", expect.stringMatching(/attachments$/));
    expect(screen.getByText("collapsed-3.txt")).toBeInTheDocument();
    expect(screen.queryByText("collapsed-4.txt")).toBeNull();
    expect(screen.queryByText("collapsed-5.txt")).toBeNull();

    fireEvent.click(disclosure);
    expect(screen.getByText("collapsed-4.txt")).toBeInTheDocument();
    expect(screen.getByText("collapsed-5.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起已上传附件" })).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "收起已上传附件" }));
    expect(screen.queryByText("collapsed-5.txt")).toBeNull();
  });

  it("keeps a failed attachment visible outside the uploaded-item collapse", async () => {
    let uploadIndex = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      const index = uploadIndex++;
      if (index === 5) throw new Error("网络中断");
      return {
        ok: true,
        status: 201,
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => ({ success: true, data: { id: `mixed-${index}`, url: `/api/issues/attachments/mixed-${index}`, issue_id: null, comment_id: null, draft_id: "draft-mixed", uploader_id: "alice", file_name: `mixed-${index}.txt`, mime_type: "text/plain", size_bytes: 1, created_at: "2026-07-12T00:00:00.000Z" } }),
        text: vi.fn(),
      } as unknown as Response;
    });
    render(<IssueComposer pagePath="owner/app" draftId="draft-mixed" textareaLabel="评论内容" submitLabel="评论" onSubmit={vi.fn()} />);
    const files = Array.from({ length: 6 }, (_, index) => new File(["x"], `mixed-${index}.txt`, { type: "text/plain" }));

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files } });

    await waitFor(() => expect(screen.getByRole("button", { name: "显示其余 1 个已上传附件" })).toBeInTheDocument());
    expect(screen.queryByText("mixed-4.txt")).toBeNull();
    expect(screen.getByText("mixed-5.txt")).toBeInTheDocument();
    expect(screen.getByText("网络中断")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试 mixed-5.txt" })).toBeInTheDocument();
  });

  it("keeps a failed draft inline, clears the stale error on change, and clears the draft after retry", async () => {
    const key = "localapp:test:failed-comment";
    const onSubmit = vi.fn().mockRejectedValueOnce(new Error("权限已变更，请重试")).mockResolvedValueOnce(undefined);
    render(<IssueComposer pagePath="owner/app" draftId="draft-failure" textareaLabel="评论内容" submitLabel="评论" attachments={false} persistenceKey={key} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox", { name: "评论内容" });

    fireEvent.change(textarea, { target: { value: "需要保留的评论" } });
    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("权限已变更，请重试");
    expect(textarea).toHaveValue("需要保留的评论");
    expect(sessionStorage.getItem(key)).toBe("需要保留的评论");

    fireEvent.change(textarea, { target: { value: "修改后再次提交" } });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(textarea).toHaveValue(""));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it("submits a ready draft with Mod+Enter but lets mention Enter win", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<IssueComposer pagePath="owner/app" draftId="draft-shortcut" textareaLabel="评论内容" submitLabel="评论" attachments={false} mentionCandidates={candidates} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox", { name: "评论内容" });
    const submitButton = screen.getByRole("button", { name: "评论" });
    expect(submitButton).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");

    fireEvent.change(textarea, { target: { value: "快捷提交" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());

    fireEvent.change(textarea, { target: { value: "@bo", selectionStart: 3, selectionEnd: 3 } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(textarea).toHaveValue("@bob ");
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("returns an ordinary successful submit to a fresh focused editor", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<IssueComposer pagePath="owner/app" draftId="draft-repeat" textareaLabel="评论内容" submitLabel="评论" attachments={false} mentionCandidates={candidates} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox", { name: "评论内容" });

    fireEvent.change(textarea, { target: { value: "第一条评论", selectionStart: 5, selectionEnd: 5 } });
    fireEvent.click(screen.getByRole("tab", { name: "预览" }));
    fireEvent.click(screen.getByRole("button", { name: "评论" }));

    await waitFor(() => expect(screen.getByRole("tab", { name: "编辑", selected: true })).toBeInTheDocument());
    const freshTextarea = screen.getByRole("textbox", { name: "评论内容" });
    expect(freshTextarea).toHaveValue("");
    await waitFor(() => expect(freshTextarea).toHaveFocus());
    expect(screen.getByRole("status", { name: "提交状态" })).toHaveTextContent("评论成功");
    fireEvent.change(freshTextarea, { target: { value: "下一条评论", selectionStart: 5, selectionEnd: 5 } });
    await waitFor(() => expect(screen.getByRole("status", { name: "提交状态" })).toBeEmptyDOMElement());
    fireEvent.change(freshTextarea, { target: { value: "", selectionStart: 0, selectionEnd: 0 } });
    fireEvent.keyDown(freshTextarea, { key: "b", ctrlKey: true });
    expect(freshTextarea).toHaveValue("**粗体文本**");
  });

  it("leaves submit, preview, formatting, and mention selection to an active IME composition", () => {
    const onSubmit = vi.fn();
    render(<IssueComposer pagePath="owner/app" draftId="draft-ime" textareaLabel="评论内容" submitLabel="评论" attachments={false} mentionCandidates={candidates} onSubmit={onSubmit} />);
    const textarea = screen.getByRole("textbox", { name: "评论内容" });

    fireEvent.change(textarea, { target: { value: "@bo", selectionStart: 3, selectionEnd: 3 } });
    expect(screen.getByRole("listbox", { name: "提及用户建议" })).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true, isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("@bo");
    expect(screen.getByRole("listbox", { name: "提及用户建议" })).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "p", ctrlKey: true, shiftKey: true, keyCode: 229 });
    expect(screen.getByRole("tab", { name: "编辑", selected: true })).toBeInTheDocument();
    fireEvent.keyDown(textarea, { key: "b", ctrlKey: true, isComposing: true });
    expect(textarea).toHaveValue("@bo");
  });

  it("shows loading on the exact comment status action without changing labels", async () => {
    let resolveSubmit!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { resolveSubmit = resolve; }));
    render(<IssueComposer pagePath="owner/app" draftId="draft-close" textareaLabel="评论内容" submitLabel="评论" attachments={false} status="open" onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox", { name: "评论内容" }), { target: { value: "处理完成" } });
    const submit = screen.getByRole("button", { name: "评论" });
    const close = screen.getByRole("button", { name: "评论并关闭" });
    fireEvent.click(close);

    expect(close).toHaveAttribute("aria-busy", "true");
    expect(close.querySelector(".lucide-loader-circle")).toHaveClass("motion-reduce:animate-none");
    expect(submit).toBeDisabled();
    expect(submit).not.toHaveAttribute("aria-busy");
    expect(submit).toHaveTextContent("评论");
    expect(close).toHaveTextContent("评论并关闭");

    resolveSubmit();
    await waitFor(() => expect(close).not.toHaveAttribute("aria-busy"));
    expect(screen.getByRole("status", { name: "提交状态" })).toHaveTextContent("评论并关闭成功");
  });

  it("does not shortcut-submit an invalid draft", () => {
    const onSubmit = vi.fn();
    render(<IssueComposer pagePath="owner/app" draftId="draft-disabled-shortcut" textareaLabel="描述" submitLabel="提交" attachments={false} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "描述" }), { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
