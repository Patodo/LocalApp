import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IssuesModal, isIssueFocusTargetVisible } from "./issues-modal";
import { IssueActionMenu } from "./issue-action-menu";
import type { Issue, IssueDetail } from "./issue-types";

class MockIssueEventSource {
  static instances: MockIssueEventSource[] = [];
  listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;
  constructor(public url: string) { MockIssueEventSource.instances.push(this); }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) listener(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  close() { this.closed = true; }
}

const openIssue = {
  id: 12,
  issue_number: 12,
  title: "修复上传失败",
  description: "上传大图时会返回 500。",
  status: "open" as const,
  label: "bug" as const,
  reporter_id: "alice",
  created_at: "2026-07-10T09:00:00.000Z",
  updated_at: "2026-07-10T09:00:00.000Z",
} satisfies Issue;

const baseComment = {
  id: 6,
  issue_id: 12,
  body: "复现步骤：\n\n- 打开页面\n- **上传** 图片",
  author_id: "alice",
  created_at: "2026-07-10T10:00:00.000Z",
  updated_at: "2026-07-10T10:00:00.000Z",
  deleted_at: null,
};

const detail = {
  issue: openIssue,
  timeline: [
    {
      kind: "event" as const,
      event: {
        id: 1,
        issue_id: 12,
        actor_id: "alice",
        event_type: "opened",
        payload_json: "{}",
        created_at: "2026-07-10T09:00:00.000Z",
      },
    },
    {
      kind: "comment" as const,
      comment: baseComment,
    },
  ],
  attachments: [],
  reactions: [],
  collaboration: {
    labels: [{ id: "bug", name: "缺陷", color: "d73a4a", description: "", built_in: 1, created_at: "2026-07-10T09:00:00.000Z", updated_at: "2026-07-10T09:00:00.000Z" }],
    assignee_ids: [],
    subscriber_ids: ["owner"],
    participant_ids: ["alice", "owner"],
  },
} satisfies IssueDetail;

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ "content-type": "application/json" }),
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  } as unknown as Response;
}

function htmlResponse(): Response {
  return {
    ok: false,
    status: 502,
    headers: new Headers({ "content-type": "text/html" }),
    json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token '<'")),
    text: vi.fn().mockResolvedValue("<!DOCTYPE html>"),
  } as unknown as Response;
}

function issueListResponse(issues: unknown[], meta: Partial<{ total: number; open: number; closed: number; limit: number; offset: number }> = {}): Response {
  return jsonResponse({
    success: true,
    data: issues,
    meta: {
      total: issues.length,
      open: issues.filter((issue) => (issue as { status?: string }).status === "open").length,
      closed: issues.filter((issue) => (issue as { status?: string }).status === "closed").length,
      limit: 25,
      offset: 0,
      ...meta,
    },
  });
}

function renderModal(user: { id: string; name: string } | null = { id: "alice", name: "Alice" }) {
  return render(
    <IssuesModal
      pagePath="owner/research"
      pageName="Research Pipeline"
      user={user}
      onClose={vi.fn()}
    />,
  );
}

function mockWorkspaceApi(listIssue: unknown = openIssue, pinnedIssues: unknown[] = [], pinStatus = 200, savedViews: unknown[] = [], workspaceDetail: unknown = detail) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === "/api/issues/views?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: savedViews });
    if (url === "/api/issues/views" && init?.method === "POST") return jsonResponse({ success: true, data: { id: 19, user_id: "alice", ...JSON.parse(String(init.body)), created_at: "", updated_at: "" } });
    if (url === "/api/issues/config?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: { templates: [] } });
    if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [{ id: 7, title: "v1.0", description: "Release", due_on: "2026-09-01", state: "open", created_by: "owner", created_at: "", updated_at: "", open_issues: 1, closed_issues: 0 }] });
    if (url === "/api/issues/attachments" && init?.method === "POST") {
      return jsonResponse({ success: true, data: {
        id: `attachment-${Math.random()}`,
        url: "/api/issues/attachments/uploaded?pagePath=owner%2Fresearch",
        issue_id: null,
        comment_id: null,
        draft_id: "draft",
        uploader_id: "alice",
        file_name: "attachment",
        mime_type: "image/png",
        size_bytes: 5,
        created_at: "2026-07-10T11:00:00.000Z",
      } });
    }
    if (url === "/api/issues" && init?.method === "POST") return jsonResponse({ success: true, data: openIssue });
    if (url === "/api/issues/12?pagePath=owner%2Fresearch") {
      return jsonResponse({ success: true, data: workspaceDetail });
    }
    if (url === "/api/issues/12/milestone" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as { milestoneId: number | null };
      return jsonResponse({ success: true, data: { ...detail, issue: { ...detail.issue, milestone_id: request.milestoneId } } });
    }
    if (url === "/api/issues/12/lock" && init?.method === "PUT") {
      const request = JSON.parse(String(init.body)) as { locked: boolean; reason?: "resolved" | "off_topic" | "too_heated" | "spam" };
      return jsonResponse({ success: true, data: { ...detail, issue: { ...detail.issue, locked_at: request.locked ? "2026-07-10T11:05:00.000Z" : null, locked_by: request.locked ? "alice" : null, lock_reason: request.locked ? request.reason ?? null : null } } });
    }
    if (url === "/api/issues/12/pin" && init?.method === "PUT") {
      if (pinStatus !== 200) return jsonResponse({ success: false, code: "issue_pin_limit_exceeded", error: "每个应用最多置顶 3 条 Issue" }, pinStatus);
      const request = JSON.parse(String(init.body)) as { pinned: boolean };
      return jsonResponse({ success: true, data: { ...detail, issue: { ...detail.issue, pinned_at: request.pinned ? "2026-07-10T11:06:00.000Z" : null, pinned_by: request.pinned ? "owner" : null } } });
    }
    if (url === "/api/issues/12/comments/6/pin" && (init?.method === "PUT" || init?.method === "DELETE")) {
      return jsonResponse({ success: true, data: detail });
    }
    if (url === "/api/issues/12/comments/6/minimize" && (init?.method === "PUT" || init?.method === "DELETE")) {
      return jsonResponse({ success: true, data: workspaceDetail });
    }
    if (url.includes("/comments") && init?.method === "POST") {
      return jsonResponse({
        success: true,
        data: { ...detail, timeline: [...detail.timeline, {
          kind: "comment",
          comment: { id: 7, issue_id: 12, body: "已补充日志", author_id: "alice", created_at: "2026-07-10T11:00:00.000Z", updated_at: "2026-07-10T11:00:00.000Z", deleted_at: null },
        }] },
      });
    }
    if (url.startsWith("/api/issues?")) return jsonResponse({ success: true, data: [listIssue], pinned: pinnedIssues, meta: { total: 1, open: 1, closed: 0, limit: 25, offset: 0 } });
    return jsonResponse({ success: true, data: [listIssue] });
  });
}

async function openDetail() {
  fireEvent.click(await screen.findByRole("link", { name: "#12 修复上传失败" }));
  await screen.findByRole("heading", { name: "修复上传失败" });
}

function selectIssueAction(name: string) {
  fireEvent.click(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

function selectCommentAction(name: string) {
  fireEvent.click(within(screen.getByTestId("issue-comment-6")).getByRole("button", { name: "评论操作" }));
  fireEvent.click(screen.getByRole("menuitem", { name }));
}

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  MockIssueEventSource.instances = [];
});

describe("IssuesModal", () => {
  it("minimizes comments with an owner-selected reason and keeps minimized bodies out of the default DOM", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    selectCommentAction("最小化评论");
    expect(screen.getByRole("alertdialog", { name: "最小化评论" })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("内容过时"));
    fireEvent.click(within(screen.getByRole("alertdialog", { name: "最小化评论" })).getByRole("button", { name: "最小化评论" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments/6/minimize", expect.objectContaining({ method: "PUT", body: JSON.stringify({ pagePath: "owner/research", reason: "outdated" }) })));

    cleanup();
    vi.restoreAllMocks();
    const minimizedDetail = { ...detail, timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, minimized_at: "2026-07-10T11:00:00.000Z", minimized_by: "owner", minimized_reason: "outdated" as const } } : item) };
    mockWorkspaceApi(openIssue, [], 200, [], minimizedDetail);
    renderModal(null);
    await openDetail();
    expect(screen.queryByText("复现步骤：")).toBeNull();
    expect(screen.getByText("此评论已最小化 · 内容过时")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "显示评论" }));
    expect(screen.getByText("复现步骤：")).toBeInTheDocument();
  });
  it("only lets the app owner trigger the comment pin mutation", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    selectCommentAction("置顶评论");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments/6/pin", expect.objectContaining({ method: "PUT", body: JSON.stringify({ pagePath: "owner/research" }) })));

    cleanup();
    vi.restoreAllMocks();
    mockWorkspaceApi();
    renderModal({ id: "alice", name: "Alice" });
    await openDetail();
    fireEvent.click(within(screen.getByTestId("issue-comment-6")).getByRole("button", { name: "评论操作" }));
    expect(screen.queryByRole("menuitem", { name: "置顶评论" })).toBeNull();
  });
  it("loads, applies, and saves personal Issue views without leaving the workspace", async () => {
    const saved = { id: 7, user_id: "alice", name: "待验收", description: "本周", query: { status: "open", label: "bug", offset: 0 }, created_at: "", updated_at: "" };
    const fetchMock = mockWorkspaceApi(openIssue, [], 200, [saved]);
    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: "打开保存视图 待验收" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), "http://localhost").searchParams.get("label") === "bug")).toBe(true));
    expect(new URL(window.location.href).searchParams.get("localappIssueLabel")).toBe("bug");
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Issue" }), { target: { value: "crash" } });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索 Issue" }), { key: "Enter" });
    expect(await screen.findByText("有未保存更改")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "将当前查询另存为视图" }));
    fireEvent.change(screen.getByLabelText("视图名称"), { target: { value: "崩溃队列" } });
    fireEvent.click(screen.getByRole("button", { name: "保存视图" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/issues/views" && init?.method === "POST")).toBe(true));
  });
  it("shows pinned Issues above the unfiltered default list and hides them while searching", async () => {
    const pinned = { ...openIssue, id: 22, issue_number: 22, title: "关键发布阻塞", pinned_at: "2026-07-10T11:00:00.000Z", pinned_by: "owner", comment_count: 4, is_duplicate: 1 };
    mockWorkspaceApi(openIssue, [pinned]);
    renderModal({ id: "alice", name: "Alice" });

    expect(await screen.findByRole("heading", { name: "置顶 Issues" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "#22 关键发布阻塞" })).toBeInTheDocument();
    expect(screen.getByText("4 条评论")).toBeInTheDocument();
    expect(screen.getByText("重复")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Issue" }), { target: { value: "upload" } });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "置顶 Issues" })).toBeNull());
  });

  it("lets only the app owner pin from detail and keeps a limit failure local", async () => {
    mockWorkspaceApi();
    const ownerView = renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    const metadata = within(screen.getByTestId("issue-metadata-desktop"));
    fireEvent.click(metadata.getByRole("button", { name: "置顶 Issue" }));
    expect(await metadata.findByRole("button", { name: "取消置顶" })).toBeInTheDocument();

    ownerView.unmount();
    vi.restoreAllMocks();
    cleanup();
    mockWorkspaceApi(openIssue, [], 409);
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    fireEvent.click(within(screen.getByTestId("issue-metadata-desktop")).getByRole("button", { name: "置顶 Issue" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("每个应用最多置顶 3 条 Issue");

    vi.restoreAllMocks();
    cleanup();
    mockWorkspaceApi();
    renderModal({ id: "alice", name: "Alice" });
    await openDetail();
    expect(within(screen.getByTestId("issue-metadata-desktop")).queryByRole("button", { name: "置顶 Issue" })).toBeNull();
  });
  it("exposes the label manager only to the app owner", async () => {
    mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    const manage = await screen.findByRole("button", { name: "管理 Issue 标签" });
    fireEvent.click(manage);
    expect(screen.getByRole("heading", { name: "标签", level: 3 })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新建标签" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    expect(await screen.findByRole("link", { name: "#12 修复上传失败" })).toBeInTheDocument();
    vi.restoreAllMocks(); cleanup(); mockWorkspaceApi(); renderModal({ id: "alice", name: "Alice" });
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    expect(screen.queryByRole("button", { name: "管理 Issue 标签" })).toBeNull();
  });

  it("exposes milestone management and filtering with owner boundaries", async () => {
    mockWorkspaceApi();
    const ownerView = renderModal({ id: "owner", name: "Owner" });
    fireEvent.click(await screen.findByRole("button", { name: "管理 Issue 里程碑" }));
    expect(screen.getByRole("heading", { name: "里程碑", level: 3 })).toBeInTheDocument();
    ownerView.unmount();

    renderModal({ id: "alice", name: "Alice" });
    expect(await screen.findByRole("combobox", { name: "按里程碑筛选" })).toHaveTextContent("v1.0");
    expect(screen.queryByRole("button", { name: "管理 Issue 里程碑" })).toBeNull();
  });

  it("assigns a milestone during creation and from Issue detail", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "Milestone work" } });
    fireEvent.change(screen.getByRole("combobox", { name: "里程碑" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 Issue" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/issues" && init?.method === "POST" && JSON.parse(String(init.body)).milestoneId === 7)).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    fireEvent.click(await screen.findByRole("link", { name: "#12 修复上传失败" }));
    fireEvent.change(within(await screen.findByTestId("issue-metadata-desktop")).getByRole("combobox", { name: "设置里程碑" }), { target: { value: "7" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/issues/12/milestone" && init?.method === "PUT")).toBe(true));
  });

  it("chooses a versioned template, pre-fills editable fields, and ignores missing labels", async () => {
    const template = { id: "bug-report", name: "Bug report", description: "Report a defect", titlePrefix: "[Bug] ", body: "## Steps\n\n1. ", type: "feature", labels: ["acceptance", "missing"] };
    const acceptance = { id: "acceptance", name: "验收", color: "1f883d", description: "Ready", built_in: 0, created_at: "", updated_at: "" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/config?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: { templates: [template] } });
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [acceptance] });
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [] });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    expect(await screen.findByRole("heading", { name: "选择 Issue 模板" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "打开空白 Issue" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "开始" }));
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("[Bug] ");
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("## Steps\n\n1. ");
    expect(screen.queryByText("已恢复未提交的草稿")).toBeNull();
    expect(screen.getByRole("button", { name: "功能" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("验收")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Issue 模板提示" })).toHaveTextContent("missing");
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "[Bug] editable" } });
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("[Bug] editable");
  });

  it("shows resolvable milestones in list rows and filters from the row action", async () => {
    const milestone = { id: 7, title: "v1.0", description: "Release", due_on: "2026-09-01", state: "open", created_by: "owner", created_at: "", updated_at: "", open_issues: 1, closed_issues: 0 };
    const issues = [
      { ...openIssue, milestone_id: 7 },
      { ...openIssue, id: 13, issue_number: 13, title: "Unknown milestone", milestone_id: 99 },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [milestone] });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 2, open: 2 });
    });
    renderModal();

    const rowAction = await screen.findByRole("button", { name: "按里程碑筛选 v1.0" });
    expect(within(screen.getByTestId("issue-row-12")).getByText("v1.0")).toBeInTheDocument();
    expect(within(screen.getByTestId("issue-row-13")).queryByText("99")).toBeNull();
    fireEvent.click(rowAction);

    await waitFor(() => expect(window.location.search).toContain("localappIssueMilestone=7"));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), "http://localhost").searchParams.get("milestone") === "7")).toBe(true);
    expect(screen.getByRole("button", { name: "移除里程碑筛选 v1.0" })).toBeInTheDocument();
  });

  it("filters from accessible list label actions while detail labels remain static", async () => {
    const labeledIssue = { ...openIssue, labels: [
      { id: "bug", name: "缺陷", color: "d73a4a", description: "Bug" },
      { id: "acceptance", name: "验收", color: "0e8a16", description: "Acceptance" },
    ] };
    const fetchMock = mockWorkspaceApi(labeledIssue);
    renderModal();

    const acceptanceFilter = await screen.findByRole("button", { name: "按标签筛选 验收" });
    expect(screen.getByRole("button", { name: "按标签筛选 缺陷" })).toBeInTheDocument();
    fireEvent.click(acceptanceFilter);

    await waitFor(() => expect(window.location.search).toContain("localappIssueLabel=acceptance"));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), "http://localhost").searchParams.get("label") === "acceptance")).toBe(true);
    expect(screen.getByRole("button", { name: "移除标签筛选 acceptance" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: "#12 修复上传失败" }));
    await screen.findByRole("heading", { name: "修复上传失败" });
    expect(screen.queryByRole("button", { name: "按标签筛选 缺陷" })).toBeNull();
    expect(screen.getAllByText("缺陷").length).toBeGreaterThan(0);
  });

  it("shows resolved reporter names and filters by the stable reporter id", async () => {
    const issues = [
      openIssue,
      { ...openIssue, id: 13, issue_number: 13, title: "Legacy reporter", reporter_id: "legacy-user" },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [{ id: "alice", name: "alice", displayName: "Alice", avatarUrl: null }] });
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 2, open: 2 });
    });
    renderModal();

    const alice = await screen.findByRole("button", { name: "按创建者筛选 Alice" });
    expect(screen.getByRole("button", { name: "按创建者筛选 legacy-user" })).toBeInTheDocument();
    expect(alice).toHaveAttribute("title", "Alice @alice");
    fireEvent.click(alice);

    await waitFor(() => expect(window.location.search).toContain("localappIssueAuthor=alice"));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), "http://localhost").searchParams.get("author") === "alice")).toBe(true);
    expect(screen.getByRole("button", { name: "移除作者筛选 Alice" })).toBeInTheDocument();
  });

  it("distinguishes creation time from later list activity without changing time semantics", async () => {
    const createdOnly = { ...openIssue, last_activity_at: openIssue.created_at, updated_at: openIssue.created_at };
    const active = { ...openIssue, id: 13, issue_number: 13, title: "Later activity", last_activity_at: "2026-07-10T11:00:00.000Z" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse([createdOnly, active], { total: 2, open: 2 });
    });
    renderModal();

    await screen.findByRole("link", { name: "#12 修复上传失败" });
    const createdTime = screen.getByTestId("issue-row-12").querySelector<HTMLElement>('[data-localapp-issue-activity][data-kind="created"]');
    const activityTime = screen.getByTestId("issue-row-13").querySelector<HTMLElement>('[data-localapp-issue-activity][data-kind="activity"]');
    expect(createdTime).toHaveTextContent("创建于");
    expect(createdTime?.querySelector("time")).toHaveAttribute("datetime", openIssue.created_at);
    expect(activityTime).toHaveTextContent("活动于");
    expect(activityTime?.querySelector("time")).toHaveAttribute("datetime", active.last_activity_at);
  });

  it("distinguishes completed and not-planned Closed Issues in the list", async () => {
    window.history.replaceState({}, "", "/?localappIssueStatus=closed");
    const issues = [
      { ...openIssue, status: "closed", state_reason: "completed", id: 12, issue_number: 12 },
      { ...openIssue, status: "closed", state_reason: "not_planned", id: 13, issue_number: 13, title: "Not planned" },
      { ...openIssue, status: "closed", state_reason: null, id: 14, issue_number: 14, title: "Historical close" },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 3, open: 0, closed: 3 });
    });
    renderModal();

    await screen.findByRole("link", { name: "#13 Not planned" });
    const completed = screen.getAllByLabelText("已关闭：已完成");
    const notPlanned = screen.getByLabelText("已关闭：不计划处理");
    expect(completed).toHaveLength(2);
    expect(completed[0]?.querySelector("svg")).toHaveClass("lucide-circle-check");
    expect(notPlanned.querySelector("svg")).toHaveClass("lucide-circle-slash-2");
    expect(notPlanned).toHaveAttribute("title", "已关闭：不计划处理");
  });

  it("filters the Closed queue by reason and restores the filter in the URL", async () => {
    window.history.replaceState({}, "", "/?localappIssueStatus=closed");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse([], { total: 0, open: 0, closed: 0 });
    });
    renderModal();

    fireEvent.change(await screen.findByRole("combobox", { name: "按关闭原因筛选" }), { target: { value: "not_planned" } });
    await waitFor(() => expect(window.location.search).toContain("localappIssueReason=not_planned"));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), "http://localhost").searchParams.get("reason") === "not_planned")).toBe(true);
    expect(screen.getByRole("button", { name: "移除关闭原因筛选 不计划处理" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /开启/ }));
    await waitFor(() => expect(window.location.search).not.toContain("localappIssueReason"));
  });

  it("lets only the owner confirm permanent Issue deletion and returns to the current list", async () => {
    let deleted = false;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch" && init?.method === "DELETE") { deleted = true; return jsonResponse({ success: true, data: { id: 12 } }); }
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return issueListResponse(deleted ? [] : [openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    selectIssueAction("删除 Issue");
    const confirmation = screen.getByRole("alertdialog", { name: "删除 Issue 确认" });
    expect(confirmation).toHaveAccessibleDescription("评论、编辑历史、表态和附件都将被永久删除，此操作无法撤销。");
    await waitFor(() => expect(screen.getByRole("button", { name: "取消删除" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "确认删除 Issue" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12?pagePath=owner%2Fresearch", expect.objectContaining({ method: "DELETE" })));
    await waitFor(() => expect(screen.queryByRole("link", { name: "#12 修复上传失败" })).toBeNull());
    expect(await screen.findByText("0 个结果")).toBeInTheDocument();

    vi.restoreAllMocks(); cleanup(); mockWorkspaceApi(); renderModal({ id: "alice", name: "Alice" });
    await openDetail();
    fireEvent.click(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" }));
    expect(screen.queryByRole("menuitem", { name: "删除 Issue" })).toBeNull();
  });

  it("keeps a failed Issue deletion confirmation available for retry and restores focus on cancel", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch" && init?.method === "DELETE") return jsonResponse({ success: false, error: "删除暂不可用" }, 503);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    selectIssueAction("删除 Issue");
    const cancel = screen.getByRole("button", { name: "取消删除" });
    const confirm = screen.getByRole("button", { name: "确认删除 Issue" });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.click(confirm);
    expect(await screen.findByRole("alert")).toHaveTextContent("删除暂不可用");
    expect(screen.getByRole("alertdialog", { name: "删除 Issue 确认" })).toBeInTheDocument();
    expect(confirm).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("alertdialog", { name: "删除 Issue 确认" }), { key: "Escape" });
    await waitFor(() => expect(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" })).toHaveFocus());
  });

  it("does not restore the legacy label badge when structured labels are explicitly empty", async () => {
    const bug = { id: "bug", name: "缺陷", color: "d73a4a", description: "", built_in: 1, created_at: "", updated_at: "" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [bug] });
      return issueListResponse([{ ...openIssue, labels: [] }], { total: 1, open: 1 });
    });

    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    const issueLink = await screen.findByRole("link", { name: "#12 修复上传失败" });
    expect(within(issueLink.closest("article") as HTMLElement).getAllByText("缺陷")).toHaveLength(1);
  });

  it("coalesces Issue invalidations, refreshes the current detail, and announces new collaboration activity", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let currentDetail: IssueDetail = detail;
    let resolveUpload!: (response: Response) => void;
    const pendingUpload = new Promise<Response>((resolve) => { resolveUpload = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/issues/attachments") return pendingUpload;
      if (String(input) === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: currentDetail });
      return issueListResponse([openIssue]);
    });
    const { unmount } = renderModal();
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    expect(MockIssueEventSource.instances[0]?.url).toBe("/api/issues/events?pagePath=owner%2Fresearch");
    const listCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/issues?"));
    const initialListCalls = listCalls().length;

    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12, kind: "commented", updatedAt: new Date().toISOString() } });
    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12, kind: "reaction", updatedAt: new Date().toISOString() } });
    await waitFor(() => expect(listCalls()).toHaveLength(initialListCalls + 1));

    fireEvent.click(screen.getByRole("link", { name: "#12 修复上传失败" }));
    await screen.findByRole("heading", { name: "修复上传失败" });
    const detailCalls = () => fetchMock.mock.calls.filter(([input]) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch");
    expect(detailCalls()).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("heading", { name: "修复上传失败" })).toHaveFocus());
    const commentEditor = screen.getByLabelText("评论内容");
    expect(commentEditor).toHaveAttribute("placeholder", "留下评论");
    fireEvent.change(commentEditor, { target: { value: "本地尚未提交的评论" } });
    commentEditor.focus();
    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["pending"], "pending.txt", { type: "text/plain" })] } });
    expect(screen.getByText("pending.txt")).toBeInTheDocument();
    currentDetail = { ...detail, issue: { ...detail.issue, updated_at: "2026-07-10T11:30:00.000Z" }, timeline: [...detail.timeline, { kind: "comment" as const, comment: { id: 7, issue_id: 12, body: "远端新增评论", author_id: "owner", created_at: "2026-07-10T11:30:00.000Z", updated_at: "2026-07-10T11:30:00.000Z", deleted_at: null } }] };
    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12, kind: "commented", updatedAt: new Date().toISOString() } });
    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 99, kind: "source-updated", updatedAt: new Date().toISOString() } });

    expect(screen.getByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "正在加载 Issue 详情" })).toBeNull();
    await waitFor(() => expect(detailCalls()).toHaveLength(2));
    expect(await screen.findByRole("status", { name: "Issue 协作更新" })).toHaveTextContent("已同步最新协作活动");
    expect(screen.getByText("远端新增评论")).toBeInTheDocument();
    expect(screen.getByLabelText("评论内容")).toBe(commentEditor);
    expect(commentEditor).toHaveValue("本地尚未提交的评论");
    expect(commentEditor).toHaveFocus();
    expect(screen.getByText("pending.txt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭协作更新提示" }));
    expect(screen.queryByRole("status", { name: "Issue 协作更新" })).toBeNull();
    expect(screen.getByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();

    unmount();
    resolveUpload(jsonResponse({ success: true, data: {} }));
    expect(MockIssueEventSource.instances[0].closed).toBe(true);
  });

  it("releases Issue SSE while hidden or blurred and refreshes after one active reconnect", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue]));
    const { unmount } = renderModal();
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    const listCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/issues?"));
    const beforeReconnect = listCalls().length;
    expect(MockIssueEventSource.instances).toHaveLength(1);

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(MockIssueEventSource.instances[0].closed).toBe(true);
    expect(MockIssueEventSource.instances).toHaveLength(1);

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(MockIssueEventSource.instances).toHaveLength(2);
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(beforeReconnect));

    window.dispatchEvent(new Event("pagehide"));
    expect(MockIssueEventSource.instances[1].closed).toBe(true);
    window.dispatchEvent(new Event("pageshow"));
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(MockIssueEventSource.instances).toHaveLength(3);
    unmount();
    expect(MockIssueEventSource.instances[2].closed).toBe(true);
    window.dispatchEvent(new Event("pageshow"));
    expect(MockIssueEventSource.instances).toHaveLength(3);
  });

  it("dismisses a delete confirmation when realtime sync deletes the comment", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let currentDetail: IssueDetail = detail;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "/api/issues/12?pagePath=owner%2Fresearch"
        ? jsonResponse({ success: true, data: currentDetail })
        : issueListResponse([openIssue]));
    renderModal();
    await openDetail();
    selectCommentAction("删除评论");
    expect(screen.getByRole("alertdialog", { name: "删除评论确认" })).toBeInTheDocument();

    currentDetail = {
      ...detail,
      timeline: detail.timeline.map((item) => item.kind === "comment"
        ? { ...item, comment: { ...item.comment, deleted_at: "2026-07-10T11:15:00.000Z" } }
        : item),
    };
    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12, kind: "commented" } });

    await waitFor(() => expect(screen.queryByRole("alertdialog", { name: "删除评论确认" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("issue-comment-6")).toHaveFocus());
    expect(screen.getByText("此评论已删除。")).toBeInTheDocument();
  });

  it("ends comment editing when realtime sync deletes the comment", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let currentDetail: IssueDetail = detail;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "/api/issues/12?pagePath=owner%2Fresearch"
        ? jsonResponse({ success: true, data: currentDetail })
        : issueListResponse([openIssue]));
    renderModal();
    await openDetail();
    selectCommentAction("编辑评论");
    expect(screen.getByLabelText("编辑评论内容")).toHaveAttribute("placeholder", "更新评论");

    currentDetail = {
      ...detail,
      timeline: detail.timeline.map((item) => item.kind === "comment"
        ? { ...item, comment: { ...item.comment, deleted_at: "2026-07-10T11:16:00.000Z" } }
        : item),
    };
    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12, kind: "commented" } });

    await waitFor(() => expect(screen.queryByLabelText("编辑评论内容")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("issue-comment-6")).toHaveFocus());
    expect(screen.getByText("评论已被删除，编辑已结束")).toHaveClass("sr-only");
  });

  it("keeps stale detail visible and retries realtime synchronization in place", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let detailRequests = 0;
    let resolveRetry!: (response: Response) => void;
    const retriedDetail = { ...detail, issue: { ...detail.issue, title: "同步后的标题" } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) !== "/api/issues/12?pagePath=owner%2Fresearch") return issueListResponse([openIssue]);
      detailRequests += 1;
      if (detailRequests === 1) return jsonResponse({ success: true, data: detail });
      if (detailRequests === 2) throw new Error("network down");
      return new Promise<Response>((resolve) => { resolveRetry = resolve; });
    });
    renderModal();
    await openDetail();
    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12 } });

    expect(await screen.findByRole("alert")).toHaveTextContent("无法同步最新 Issue，当前内容可能已过期");
    expect(screen.getByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新同步" })).toHaveClass("h-11", "shrink-0", "sm:h-7");
    fireEvent.click(screen.getByRole("button", { name: "重新同步" }));
    expect(screen.getByRole("button", { name: "正在同步..." })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "正在同步..." }));
    expect(detailRequests).toBe(3);

    await act(async () => resolveRetry(jsonResponse({ success: true, data: retriedDetail })));
    expect(await screen.findByRole("heading", { name: "同步后的标题" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("keeps background list failures scoped away from an open detail", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let listRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url.startsWith("/api/issues?")) {
        listRequests += 1;
        if (listRequests > 1) throw new Error("list refresh failed");
      }
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12 } });
    await waitFor(() => expect(listRequests).toBe(2));
    expect(screen.getByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("显示上次结果：list refresh failed");
    expect(screen.getByRole("link", { name: "#12 修复上传失败" })).toBeInTheDocument();
  });
  it("shows body and comment reactions and toggles only the current user's selection", async () => {
    const reactedDetail = {
      ...detail,
      reactions: [
        { issue_id: 12, comment_id: 0, user_id: "alice", content: "+1", created_at: "2026-07-10T11:00:00.000Z" },
        { issue_id: 12, comment_id: 0, user_id: "bob", content: "+1", created_at: "2026-07-10T11:01:00.000Z" },
        { issue_id: 12, comment_id: 6, user_id: "alice", content: "heart", created_at: "2026-07-10T11:02:00.000Z" },
      ],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: reactedDetail });
      if (url === "/api/issues/12/reactions" && init?.method === "PUT") {
        const request = JSON.parse(String(init.body));
        return jsonResponse({ success: true, data: {
          ...reactedDetail,
          reactions: request.reacted
            ? [...reactedDetail.reactions, { issue_id: 12, comment_id: request.commentId ?? 0, user_id: "alice", content: request.content, created_at: "2026-07-10T11:03:00.000Z" }]
            : reactedDetail.reactions.filter((reaction) => !(reaction.comment_id === (request.commentId ?? 0) && reaction.user_id === "alice" && reaction.content === request.content)),
        } });
      }
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    const bodyCard = within(screen.getByTestId("issue-body-card"));
    expect(bodyCard.getByRole("button", { name: "👍 2 个表态" })).toHaveAttribute("aria-pressed", "true");
    expect(bodyCard.getByRole("button", { name: "👍 2 个表态" })).toHaveClass("h-11", "min-w-11", "sm:h-7");
    const commentCard = within(screen.getByTestId("issue-comment-6"));
    expect(commentCard.getByRole("button", { name: "❤️ 1 个表态" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(bodyCard.getByRole("button", { name: "👍 2 个表态" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/reactions", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === "/api/issues/12/reactions")?.[1]?.body))).toEqual({
      pagePath: "owner/research", content: "+1", reacted: false,
    });

    const updatedCommentCard = within(screen.getByTestId("issue-comment-6"));
    const reactionTrigger = updatedCommentCard.getByRole("button", { name: "添加表态" });
    expect(reactionTrigger).toHaveClass("h-11", "w-11", "sm:h-7", "sm:w-7");
    fireEvent.click(reactionTrigger);
    await waitFor(() => expect(updatedCommentCard.getByRole("menuitemcheckbox", { name: "添加 👍 表态" })).toHaveFocus());
    expect(updatedCommentCard.getByRole("menuitemcheckbox", { name: "添加 👍 表态" })).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    fireEvent.keyDown(updatedCommentCard.getByRole("menu", { name: "选择表态" }), { key: "ArrowRight" });
    expect(updatedCommentCard.getByRole("menuitemcheckbox", { name: "添加 👎 表态" })).toHaveFocus();
    fireEvent.keyDown(updatedCommentCard.getByRole("menu", { name: "选择表态" }), { key: "Escape" });
    expect(updatedCommentCard.queryByRole("menu", { name: "选择表态" })).toBeNull();
    await waitFor(() => expect(reactionTrigger).toHaveFocus());
    fireEvent.click(reactionTrigger);
    fireEvent.click(updatedCommentCard.getByRole("menuitemcheckbox", { name: "添加 🚀 表态" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => url === "/api/issues/12/reactions")).toHaveLength(2));
    const reactionRequests = fetchMock.mock.calls.filter(([url]) => url === "/api/issues/12/reactions");
    expect(JSON.parse(String(reactionRequests.at(-1)?.[1]?.body))).toEqual({
      pagePath: "owner/research", commentId: 6, content: "rocket", reacted: true,
    });
  });

  it("keeps a filtered list authoritative after reacting from a direct Issue link", async () => {
    const reactedDetail = { ...detail, reactions: [{ issue_id: 12, comment_id: 0, user_id: "alice", content: "+1" as const, created_at: "2026-07-10T11:00:00.000Z" }] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: reactedDetail });
      if (url === "/api/issues/12/reactions" && init?.method === "PUT") return jsonResponse({ success: true, data: { ...reactedDetail, reactions: [] } });
      if (url.startsWith("/api/issues?")) return issueListResponse([]);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: detail.collaboration.labels });
      return jsonResponse({ success: true, data: [] });
    });
    window.history.replaceState(null, "", "/owner/research?localappIssues=1&localappIssueQ=definitely-no-match&localappIssueId=12");
    function DirectIssueHarness() {
      const [selectedIssueId, setSelectedIssueId] = React.useState<number | null>(12);
      return <IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} selectedIssueId={selectedIssueId} onIssueNavigate={setSelectedIssueId} onClose={vi.fn()} />;
    }
    render(<DirectIssueHarness />);

    const reaction = await screen.findByRole("button", { name: "👍 1 个表态" });
    fireEvent.click(reaction);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).startsWith("/api/issues?")).length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));

    expect(await screen.findByText("当前筛选没有匹配的 Issue")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveFocus());
  });

  it("renders native Issue links while intercepting only an unmodified primary click", async () => {
    mockWorkspaceApi({ ...openIssue, comment_count: 1 });
    window.history.replaceState(null, "", "/owner/research?tab=history#stage-2");
    const onIssueNavigate = vi.fn();
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} onIssueNavigate={onIssueNavigate} onClose={vi.fn()} />);

    const link = await screen.findByRole("link", { name: "#12 修复上传失败" });
    expect(link).toHaveClass("min-h-11", "sm:min-h-6");
    expect(screen.getByTestId("issue-row-12")).toHaveClass("focus-within:bg-muted/25");
    const commentsLink = screen.getByRole("link", { name: "12 的评论数 1" });
    expect(commentsLink).toHaveAttribute("href", link.getAttribute("href"));
    expect(commentsLink).toHaveClass("h-11", "w-11", "sm:h-6", "sm:w-10");
    expect(commentsLink).toHaveClass("focus-visible:outline-none", "focus-visible:ring-2", "focus-visible:ring-ring");
    expect(link).toHaveAttribute("href", "/owner/research?tab=history&localappIssues=1&localappIssueId=12#stage-2");
    const modifiedClick = createEvent.click(link, { metaKey: true, button: 0 });
    fireEvent(link, modifiedClick);
    expect(modifiedClick.defaultPrevented).toBe(false);
    expect(onIssueNavigate).not.toHaveBeenCalled();

    const primaryClick = createEvent.click(link, { button: 0 });
    fireEvent(link, primaryClick);
    expect(primaryClick.defaultPrevented).toBe(true);
    expect(onIssueNavigate).toHaveBeenCalledWith(12);
  });

  it("exposes anonymous comment permalinks and focuses a valid direct-link target", async () => {
    window.history.replaceState(null, "", "/owner/research?tab=history&localappIssueId=12&localappIssueCommentId=6#stage-2");
    let resolveRepeatedCopy!: () => void;
    const writeText = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => { resolveRepeatedCopy = resolve; }));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    mockWorkspaceApi();

    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} selectedIssueId={12} onClose={vi.fn()} />);
    await screen.findByRole("heading", { name: "修复上传失败" });
    const comment = screen.getByTestId("issue-comment-6");
    await waitFor(() => expect(comment).toHaveFocus());
    expect(comment).toHaveAttribute("aria-current", "location");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(within(comment).getByRole("link")).toHaveAttribute("href", "/owner/research?tab=history&localappIssueId=12&localappIssueCommentId=6&localappIssues=1#stage-2");

    fireEvent.click(within(comment).getByRole("button", { name: "评论操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制评论链接" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/owner/research?tab=history&localappIssueId=12&localappIssueCommentId=6&localappIssues=1#stage-2"));
    const operationStatus = screen.getByRole("status", { name: "时间线操作状态" });
    expect(operationStatus).toHaveAttribute("aria-live", "polite");
    expect(operationStatus).toHaveAttribute("aria-atomic", "true");
    expect(operationStatus).toHaveTextContent("评论链接已复制");

    fireEvent.click(within(comment).getByRole("button", { name: "评论操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "复制评论链接" }));
    expect(operationStatus).toBeEmptyDOMElement();
    resolveRepeatedCopy();
    await waitFor(() => expect(operationStatus).toHaveTextContent("评论链接已复制"));
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("keeps the workspace open and focuses an attachment queue that is still uploading", async () => {
    const fetchMock = mockWorkspaceApi();
    const onClose = vi.fn();
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} onClose={onClose} />);
    await openDetail();
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["png"], "still-uploading.png", { type: "image/png" })] } });

    const queue = screen.getByLabelText("拖拽附件到此处");
    expect(queue).toHaveAttribute("aria-busy", "true");
    fireEvent.click(screen.getByRole("button", { name: "关闭 Issue 面板" }));

    expect(onClose).not.toHaveBeenCalled();
    expect(queue).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Issue #12 · 修复上传失败" })).toBeInTheDocument();
  });

  it("focuses the Issue title when list navigation enters a detail view", async () => {
    mockWorkspaceApi();
    renderModal();
    await openDetail();

    const title = screen.getByRole("heading", { name: "修复上传失败" });
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).not.toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring");
  });

  it("copies the complete Issue URL and exposes success or failure inside the workspace", async () => {
    mockWorkspaceApi();
    window.history.replaceState(null, "", "/owner/research?tab=history&localappIssueId=12#stage-2");
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderModal();
    await openDetail();

    fireEvent.click(screen.getByRole("button", { name: "复制 Issue 链接" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost:3000/owner/research?tab=history&localappIssueId=12&localappIssues=1#stage-2"));
    expect(screen.getByRole("button", { name: "已复制 Issue 链接" })).toBeInTheDocument();

    writeText.mockRejectedValueOnce(new Error("clipboard denied"));
    fireEvent.click(screen.getByRole("button", { name: "已复制 Issue 链接" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("无法复制 Issue 链接");
  });

  it("loads a deep-linked Issue directly and reports list/detail navigation", async () => {
    mockWorkspaceApi();
    const onIssueNavigate = vi.fn();
    function Harness() {
      const [selectedIssueId, setSelectedIssueId] = React.useState<number | null>(12);
      return <IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} selectedIssueId={selectedIssueId} onIssueNavigate={(issueId) => { onIssueNavigate(issueId); setSelectedIssueId(issueId); }} onClose={vi.fn()} />;
    }
    render(<Harness />);

    expect(await screen.findByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    expect(onIssueNavigate).toHaveBeenCalledWith(null);

    fireEvent.click(await screen.findByRole("link", { name: "#12 修复上传失败" }));
    await screen.findByRole("heading", { name: "修复上传失败" });
    expect(onIssueNavigate).toHaveBeenCalledWith(12);
  });

  it("ignores an older detail response after navigating to a newer Issue", async () => {
    let resolveTwelve!: (response: Response) => void;
    let resolveThirteen!: (response: Response) => void;
    const detailThirteen = { ...detail, issue: { ...openIssue, id: 13, issue_number: 13, title: "新的 Issue" } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return new Promise<Response>((resolve) => { resolveTwelve = resolve; });
      if (url === "/api/issues/13?pagePath=owner%2Fresearch") return new Promise<Response>((resolve) => { resolveThirteen = resolve; });
      return issueListResponse([openIssue]);
    });
    const props = { pagePath: "owner/research", pageName: "Research Pipeline", user: null, onClose: vi.fn() };
    const { rerender } = render(<IssuesModal {...props} selectedIssueId={12} />);
    await waitFor(() => expect(resolveTwelve).toBeTypeOf("function"));
    rerender(<IssuesModal {...props} selectedIssueId={13} />);
    await waitFor(() => expect(resolveThirteen).toBeTypeOf("function"));

    await act(async () => resolveThirteen(jsonResponse({ success: true, data: detailThirteen })));
    expect(await screen.findByRole("heading", { name: "新的 Issue" })).toBeInTheDocument();
    await act(async () => resolveTwelve(jsonResponse({ success: true, data: detail })));

    expect(screen.getByRole("heading", { name: "新的 Issue" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "修复上传失败" })).toBeNull();
  });

  it("does not reopen a detail that resolves after returning to the list", async () => {
    let resolveDetail!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/issues/12?pagePath=owner%2Fresearch") return new Promise<Response>((resolve) => { resolveDetail = resolve; });
      return issueListResponse([openIssue]);
    });
    const props = { pagePath: "owner/research", pageName: "Research Pipeline", user: null, onClose: vi.fn() };
    const { rerender } = render(<IssuesModal {...props} selectedIssueId={12} />);
    await waitFor(() => expect(resolveDetail).toBeTypeOf("function"));
    rerender(<IssuesModal {...props} selectedIssueId={null} />);
    expect(await screen.findByRole("link", { name: "#12 修复上传失败" })).toBeInTheDocument();

    await act(async () => resolveDetail(jsonResponse({ success: true, data: detail })));

    expect(screen.getByRole("link", { name: "#12 修复上传失败" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "修复上传失败" })).toBeNull();
  });

  it("resolves Markdown references by Issue number instead of database id", async () => {
    const sourceDetail = { ...detail, issue: { ...detail.issue, description: "Related to #42" } };
    const referencedDetail = { ...detail, issue: { ...detail.issue, id: 99, issue_number: 42, title: "按编号找到的 Issue" } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: sourceDetail });
      if (url === "/api/issues/by-number/42?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: referencedDetail });
      return issueListResponse([openIssue]);
    });
    const onIssueNavigate = vi.fn();
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} onIssueNavigate={onIssueNavigate} onClose={vi.fn()} />);
    await openDetail();

    const reference = screen.getByRole("link", { name: "#42" });
    expect(reference).toHaveAttribute("href", "/?localappIssues=1&localappIssueNumber=42");
    fireEvent.click(reference);

    expect(await screen.findByRole("heading", { name: "按编号找到的 Issue" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/by-number/42?pagePath=owner%2Fresearch", { credentials: "include", signal: expect.any(AbortSignal) });
    expect(onIssueNavigate).toHaveBeenCalledTimes(2);
    expect(onIssueNavigate).toHaveBeenLastCalledWith(99, "replace");
    expect(onIssueNavigate).not.toHaveBeenCalledWith(42);
  });

  it("retries a failed number deep link through the number endpoint", async () => {
    let attempts = 0;
    const referencedDetail = { ...detail, issue: { ...detail.issue, id: 99, issue_number: 42, title: "重试后的编号 Issue" } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/by-number/42?pagePath=owner%2Fresearch") {
        attempts += 1;
        return attempts === 1 ? htmlResponse() : jsonResponse({ success: true, data: referencedDetail });
      }
      return issueListResponse([openIssue]);
    });
    const onIssueNavigate = vi.fn();
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} selectedIssueNumber={42} onIssueNavigate={onIssueNavigate} onClose={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Issue 服务暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试加载 Issue 详情" }));

    expect(await screen.findByRole("heading", { name: "重试后的编号 Issue" })).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/issues/42?pagePath=owner%2Fresearch")).toBe(false);
    expect(onIssueNavigate).toHaveBeenCalledWith(99, "replace");
  });

  it("keeps a failed deep link recoverable inside the workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/issues/404?pagePath=owner%2Fresearch") return jsonResponse({ success: false, error: "Issue 不存在" }, 404);
      return issueListResponse([openIssue]);
    });
    const onIssueNavigate = vi.fn();
    function Harness() {
      const [selectedIssueId, setSelectedIssueId] = React.useState<number | null>(404);
      return <IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} selectedIssueId={selectedIssueId} onIssueNavigate={(issueId) => { onIssueNavigate(issueId); setSelectedIssueId(issueId); }} onClose={vi.fn()} />;
    }
    render(<Harness />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Issue 不存在");
    fireEvent.click(screen.getByRole("button", { name: "从错误页返回 Issue 列表" }));
    expect(onIssueNavigate).toHaveBeenCalledWith(null);
    expect(await screen.findByRole("link", { name: "#12 修复上传失败" })).toBeInTheDocument();
  });

  it("restores isolated create and comment text drafts from the current browser session", async () => {
    mockWorkspaceApi();
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:create", JSON.stringify({ title: "恢复标题", label: "feature", labelIds: ["bug", "feature"] }));
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:create:body", "恢复的新建正文");
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:comment:12:body", "恢复的评论");
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    const createWorkspace = screen.getByTestId("issue-create-workspace");
    const createMain = screen.getByTestId("issue-create-main");
    const createTriage = screen.getByTestId("issue-create-triage");
    expect(createWorkspace).toHaveClass("grid", "lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]", "lg:gap-6");
    expect(createMain).toContainElement(screen.getByRole("textbox", { name: "标题" }));
    expect(createMain).toContainElement(screen.getByRole("textbox", { name: "描述" }));
    expect(createTriage).toContainElement(screen.getByRole("button", { name: "功能" }));
    expect(Array.from(createWorkspace.children).slice(0, 2)).toEqual([createMain, createTriage]);
    expect(createTriage).toHaveClass("lg:border-l", "lg:pl-5");
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("恢复标题");
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveClass("h-11", "sm:h-10");
    expect(screen.getByRole("button", { name: "功能" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "功能" })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("button", { name: "取消" })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("恢复的新建正文");
    expect(screen.getByText("已恢复未提交的草稿")).toBeInTheDocument();
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:create") ?? "null").labelIds).toEqual([]));

    fireEvent.click(screen.getByRole("button", { name: "丢弃草稿" }));
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃" }));
    expect(screen.getByRole("textbox", { name: "标题" })).toHaveValue("");
    expect(screen.getByRole("button", { name: "任务" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "描述" })).toHaveValue("");
    await waitFor(() => expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:create")).toBeNull());
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:create:body")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    await openDetail();
    expect(screen.getByRole("textbox", { name: "评论内容" })).toHaveValue("恢复的评论");
    expect(screen.getByText("已恢复未提交的草稿")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    await waitFor(() => expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:comment:12:body")).toBeNull());
  });

  it("persists a milestone-only create draft and drops stale milestone ids", async () => {
    mockWorkspaceApi();
    const draftKey = "localapp:issues:draft:v1:owner%2Fresearch:owner:create";
    sessionStorage.setItem(draftKey, JSON.stringify({ milestoneId: 7 }));
    renderModal({ id: "owner", name: "Owner" });

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    expect(screen.getByRole("combobox", { name: "里程碑" })).toHaveValue("7");
    expect(screen.getByText("已恢复未提交的草稿")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem(draftKey) ?? "null")).toMatchObject({ milestoneId: 7 }));

    sessionStorage.setItem(draftKey, JSON.stringify({ milestoneId: 999 }));
    fireEvent.click(screen.getByRole("button", { name: "新建 Issue" }));
    expect(screen.getByRole("combobox", { name: "里程碑" })).toHaveValue("");
    await waitFor(() => expect(sessionStorage.getItem(draftKey)).toBeNull());
  });

  it("preserves a type-only create draft and restores focus to the issue row after returning", async () => {
    mockWorkspaceApi();
    renderModal();

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    fireEvent.click(screen.getByRole("button", { name: "功能" }));
    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "新建 Issue" })).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "新建 Issue" }));
    expect(screen.getByRole("button", { name: "功能" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "新建 Issue" })).toHaveFocus());
    const issueButton = await screen.findByRole("link", { name: "#12 修复上传失败" });
    fireEvent.click(issueButton);
    await screen.findByRole("heading", { name: "修复上传失败" });
    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "#12 修复上传失败" })).toHaveFocus());
  });

  it("lets the owner select creation labels and assignees and sends them atomically", async () => {
    const customLabel = { id: "acceptance", name: "验收", color: "0e8a16", description: "Ready", built_in: 0, created_at: "", updated_at: "" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [customLabel] });
      if (url === "/api/users") return jsonResponse({ success: true, data: [{ id: "bob", name: "bob", displayName: "Bob", avatarUrl: null }] });
      if (url === "/api/issues" && init?.method === "POST") return jsonResponse({ success: true, data: openIssue });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    fireEvent.change(screen.getByRole("textbox", { name: "标题" }), { target: { value: "创建时完成分诊" } });
    fireEvent.click(screen.getByRole("button", { name: "功能" }));
    fireEvent.click(screen.getByRole("button", { name: "编辑附加标签" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "验收" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "选择附加标签" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "编辑负责人" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Bob" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "选择负责人" }), { key: "Escape" });

    expect(screen.getByText("验收")).toBeInTheDocument();
    expect(screen.getByText("@bob")).toBeInTheDocument();
    expect(JSON.parse(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:owner:create") ?? "null")).toMatchObject({ issueType: "feature", labelIds: ["acceptance"], assigneeIds: ["bob"] });

    fireEvent.click(screen.getByRole("button", { name: "提交 Issue" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/issues" && init?.method === "POST")).toBe(true));
    const createRequest = fetchMock.mock.calls.find(([url, init]) => String(url) === "/api/issues" && init?.method === "POST")?.[1];
    expect(JSON.parse(String(createRequest?.body))).toMatchObject({
      title: "创建时完成分诊",
      issueType: "feature",
      labelIds: ["acceptance"],
      assigneeIds: ["bob"],
    });
  });

  it("falls back to the search input when synchronization removes the originating issue row", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let listIssues = [openIssue];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return issueListResponse(listIssues);
    });
    renderModal();
    await openDetail();

    listIssues = [];
    MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12 } });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/issues?")).length).toBeGreaterThan(1));
    fireEvent.click(screen.getByRole("button", { name: "返回 Issue 列表" }));

    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveFocus());
  });

  it("renders the GitHub-style list workspace and makes each view change its real query", async () => {
    const secondPageIssue = { ...openIssue, id: 13, issue_number: 13, title: "第二页 Issue" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).includes("offset=25")
      ? issueListResponse([secondPageIssue], { total: 26, open: 24, closed: 2, offset: 25 })
      : issueListResponse([openIssue], { total: 26, open: 24, closed: 2 }));
    renderModal();

    const workspace = await screen.findByTestId("issue-list-workspace");
    expect(screen.getByRole("button", { name: "新建 Issue" })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("button", { name: "新建 Issue" })).toHaveAttribute("aria-keyshortcuts", "C");
    expect(screen.getByRole("button", { name: "关闭 Issue 面板" })).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    expect(screen.getByRole("button", { name: "关闭 Issue 面板" })).toHaveAttribute("aria-keyshortcuts", "Escape");
    expect(workspace).toHaveAttribute("data-localapp-issue-list");
    expect(workspace).toHaveClass("grid-rows-[auto_minmax(0,1fr)]");
    expect(workspace).toHaveClass("lg:grid-cols-[240px_minmax(0,1fr)]");
    expect(workspace).toHaveClass("lg:grid-rows-1");
    expect(screen.getByTestId("issue-view-rail")).toHaveAttribute("data-localapp-issue-view-rail");
    const mobileView = screen.getByRole("combobox", { name: "Issue 视图" });
    expect(mobileView).toHaveValue("all");
    expect(mobileView.closest("label")).toHaveClass("h-11", "lg:hidden");
    expect(within(mobileView).getAllByRole("option").map((option) => option.textContent)).toEqual(["全部 Issue", "分配给我的", "我创建的", "我参与的", "我关注的", "提及我的", "最近活动"]);
    expect(screen.getByRole("navigation", { name: "Issue 视图导航" })).toHaveClass("hidden", "lg:flex", "lg:flex-col");
    expect(screen.getByTestId("issue-toolbar")).toHaveAttribute("data-localapp-issue-toolbar");
    expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toBeInTheDocument();
    const filterToggle = screen.getByRole("button", { name: "筛选" });
    expect(filterToggle).toHaveAttribute("aria-expanded", "false");
    expect(filterToggle).toHaveAttribute("aria-controls", "localapp-issue-advanced-filters");
    expect(filterToggle).toHaveClass("h-11", "sm:hidden");
    expect(screen.getByTestId("issue-advanced-filters")).toHaveClass("hidden", "sm:contents");
    expect(screen.getByTestId("issue-advanced-filters")).toHaveClass("grid-cols-1", "min-[360px]:grid-cols-2");
    fireEvent.click(filterToggle);
    expect(filterToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("issue-advanced-filters")).toHaveClass("grid", "sm:contents");
    expect(screen.getAllByRole("combobox")).toHaveLength(7);
    expect(screen.getByRole("combobox", { name: "按里程碑筛选" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "" })).toBeNull();
    expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("combobox", { name: "按标签筛选" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "按类型筛选" })).toBeInTheDocument();
    expect(screen.getByTestId("issue-toolbar")).toHaveClass("[&_label:focus-within]:ring-2", "[&_label:focus-within]:ring-ring");
    expect(screen.getByRole("combobox", { name: "按标签筛选" })).toHaveClass("h-full", "cursor-pointer");
    expect(screen.getByRole("combobox", { name: "按标签筛选" })).toHaveTextContent("无标签");
    expect(screen.getByRole("combobox", { name: "按创建者筛选" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "按创建者筛选" })).toHaveClass("h-full", "cursor-pointer");
    expect(screen.getByRole("combobox", { name: "按创建者筛选" })).toHaveTextContent("全部创建者");
    expect(screen.getByRole("combobox", { name: "按创建者筛选" })).toHaveTextContent("Alice");
    expect(screen.getByRole("combobox", { name: "按负责人筛选" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "按负责人筛选" })).toHaveClass("h-full", "cursor-pointer");
    expect(screen.getByRole("combobox", { name: "按负责人筛选" })).toHaveTextContent("未分配");
    expect(screen.getByRole("combobox", { name: "按负责人筛选" })).toHaveTextContent("Alice");
    expect(screen.getByRole("combobox", { name: "排序 Issue" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "排序 Issue" })).toHaveClass("h-full", "cursor-pointer");
    expect(screen.getByText("26 个结果")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开启 24" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开启 24" })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("button", { name: "已关闭 2" })).toBeInTheDocument();
    expect(screen.getByTestId("issue-row-12")).toHaveAttribute("data-localapp-issue-row");
    expect(screen.getByTestId("issue-row-12")).toHaveAttribute("aria-posinset", "1");
    expect(screen.getByTestId("issue-row-12")).toHaveAttribute("aria-setsize", "26");
    expect(screen.getByLabelText("当前显示第 1 至 1 条，共 26 条 Issue")).toHaveAttribute("role", "status");
    expect(screen.getByLabelText("当前显示第 1 至 1 条，共 26 条 Issue")).toHaveAttribute("aria-live", "polite");
    expect(screen.getByLabelText("当前显示第 1 至 1 条，共 26 条 Issue")).toHaveAttribute("aria-atomic", "true");
    expect(screen.queryByRole("link", { name: "12 的评论数 0" })).toBeNull();
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "上一页" })).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    expect(screen.getByRole("button", { name: "下一页" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "下一页" })).toHaveAttribute("aria-controls", "localapp-issue-results");
    expect(screen.getByRole("list", { name: "开启的 Issues" })).toHaveAttribute("id", "localapp-issue-results");
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "#13 第二页 Issue" })).toHaveFocus());
    expect(screen.getByLabelText("当前显示第 26 至 26 条，共 26 条 Issue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "#12 修复上传失败" })).toHaveFocus());
    expect(screen.getByRole("button", { name: "全部 Issue" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "全部 Issue" })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getByRole("button", { name: "分配给我的" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "我关注的" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "提及我的" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "最近活动" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.change(mobileView, { target: { value: "assigned" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("assignee=alice"));
    expect(mobileView).toHaveValue("assigned");
    fireEvent.change(mobileView, { target: { value: "all" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain("assignee="));

    fireEvent.change(screen.getByRole("combobox", { name: "按标签筛选" }), { target: { value: "none" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("label=none"));
    fireEvent.change(screen.getByRole("combobox", { name: "按创建者筛选" }), { target: { value: "alice" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("author=alice"));
    fireEvent.change(screen.getByRole("combobox", { name: "按负责人筛选" }), { target: { value: "none" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("assignee=none"));
    fireEvent.change(screen.getByRole("combobox", { name: "按负责人筛选" }), { target: { value: "alice" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("assignee=alice"));
    fireEvent.click(screen.getByRole("button", { name: "分配给我的" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("assignee=alice"));
    expect(screen.getByRole("button", { name: "分配给我的" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "我创建的" }));
    await waitFor(() => {
      const url = String(fetchMock.mock.calls.at(-1)?.[0]);
      expect(url).toContain("author=alice");
      expect(url).not.toContain("assignee=");
    });
    fireEvent.click(screen.getByRole("button", { name: "我参与的" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("participant=alice"));
    fireEvent.click(screen.getByRole("button", { name: "我关注的" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("subscribed=true"));
    expect(window.location.search).toContain("localappIssueSubscribed=1");
    expect(screen.getByRole("button", { name: "我关注的" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "提及我的" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("mentioned=true"));
    expect(window.location.search).toContain("localappIssueMentioned=1");
    expect(screen.getByRole("button", { name: "提及我的" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByRole("combobox", { name: "排序 Issue" }), { target: { value: "created:asc" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("sort=created&direction=asc"));
    fireEvent.click(screen.getByRole("button", { name: "最近活动" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("sort=activity&direction=desc"));
    expect(screen.getByRole("button", { name: "最近活动" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "全部 Issue" }));
    expect(screen.getByRole("button", { name: "全部 Issue" })).toHaveAttribute("aria-pressed", "true");
  });

  it("hides the private subscribed view from anonymous visitors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue]));
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} onClose={vi.fn()} />);
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    expect(screen.queryByRole("button", { name: "我关注的" })).toBeNull();
    expect(screen.queryByRole("button", { name: "提及我的" })).toBeNull();
  });

  it("shows lifecycle counts scoped to the active non-status filters", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(String(input), "http://localhost");
      if (url.searchParams.get("type") === "bug") return issueListResponse([openIssue], { total: 1, open: 2, closed: 1 });
      return issueListResponse([openIssue], { total: 3, open: 24, closed: 2 });
    });
    renderModal();
    await screen.findByRole("button", { name: "开启 24" });

    fireEvent.change(screen.getByRole("combobox", { name: "按类型筛选" }), { target: { value: "bug" } });

    expect(await screen.findByRole("button", { name: "开启 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已关闭 1" })).toBeInTheDocument();
  });

  it("restores a shareable list view from URL and follows browser history", async () => {
    window.history.replaceState(null, "", "/owner/research?tab=history&localappIssueQ=upload&localappIssueStatus=closed&localappIssueType=bug&localappIssueAuthor=bob&localappIssueAssignee=alice&localappIssueSort=created&localappIssueDirection=asc&localappIssueOffset=25#stage-2");
    const pushState = vi.spyOn(window.history, "pushState");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([], { total: 40, open: 24, closed: 16, offset: 25 }));

    renderModal();

    expect(await screen.findByRole("searchbox", { name: "搜索 Issue" })).toHaveValue("upload");
    expect(screen.getByRole("button", { name: "已关闭 16" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("combobox", { name: "按类型筛选" })).toHaveValue("bug");
    expect(screen.getByRole("combobox", { name: "按创建者筛选" })).toHaveValue("bob");
    expect(screen.getByRole("combobox", { name: "按负责人筛选" })).toHaveValue("alice");
    expect(screen.getByRole("combobox", { name: "排序 Issue" })).toHaveValue("created:asc");
    const filterToggle = screen.getByRole("button", { name: "筛选，已启用 4 项" });
    expect(filterToggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(filterToggle);
    expect(filterToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "全部 Issue" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      const request = fetchMock.mock.calls.map(([input]) => String(input)).find((url) => url.startsWith("/api/issues?"));
      const params = new URL(request!, "http://localhost").searchParams;
      expect(Object.fromEntries(["q", "type", "author", "assignee", "sort", "direction", "limit", "offset"].map((key) => [key, params.get(key)]))).toEqual({ q: "upload", type: "bug", author: "bob", assignee: "alice", sort: "created", direction: "asc", limit: "25", offset: "25" });
    });

    fireEvent.change(screen.getByRole("combobox", { name: "按类型筛选" }), { target: { value: "feature" } });
    await waitFor(() => expect(window.location.search).toContain("localappIssueType=feature"));
    expect(window.location.search).toContain("tab=history");
    expect(window.location.hash).toBe("#stage-2");
    expect(pushState).toHaveBeenCalled();

    window.history.replaceState(null, "", "/owner/research?tab=history&localappIssueStatus=open&localappIssueSort=comments#stage-2");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await waitFor(() => expect(screen.getByRole("button", { name: "开启 24" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "按标签筛选" })).toHaveValue("");
    expect(screen.getByRole("combobox", { name: "排序 Issue" })).toHaveValue("comments:desc");
    expect(screen.getByRole("button", { name: "筛选，已启用 1 项" })).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(fetchMock.mock.calls.map(([input]) => String(input)).some((url) => url.includes("sort=comments&direction=desc&limit=25&offset=0"))).toBe(true));
  });

  it("renders a Markdown Issue timeline from the detail endpoint", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal();

    await openDetail();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/12?pagePath=owner%2Fresearch",
      { credentials: "include", signal: expect.any(AbortSignal) },
    );
    expect(screen.getByText("上传")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Issue 时间线" })).toHaveTextContent("打开了此 Issue");
    expect(screen.getByRole("list", { name: "Issue 时间线" })).toHaveTextContent("复现步骤：");
    expect(screen.getByRole("button", { name: "评论操作" })).toBeInTheDocument();
  });

  it("jumps to the comment composer from the detail header or R shortcut", async () => {
    mockWorkspaceApi();
    renderModal();
    await openDetail();

    const textarea = screen.getByRole("textbox", { name: "评论内容" });
    const scrollIntoView = vi.fn();
    Object.defineProperty(textarea, "scrollIntoView", { configurable: true, value: scrollIntoView });
    const matchMedia = vi.fn(() => ({ matches: true } as MediaQueryList));
    vi.stubGlobal("matchMedia", matchMedia);
    const jump = screen.getByRole("button", { name: "添加评论" });
    expect(jump).toHaveAttribute("aria-keyshortcuts", "R");
    fireEvent.click(jump);
    await waitFor(() => expect(textarea).toHaveFocus());
    expect(matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });

    screen.getByRole("heading", { name: "修复上传失败" }).focus();
    fireEvent.keyDown(document, { key: "r" });
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it("summarizes creation time and visible comments with a first-comment link", async () => {
    const discussionDetail = {
      ...detail,
      timeline: [
        ...detail.timeline,
        { kind: "comment" as const, comment: { ...baseComment, id: 7, body: "Second", created_at: "2026-07-10T10:10:00.000Z", updated_at: "2026-07-10T10:10:00.000Z" } },
        { kind: "comment" as const, comment: { ...baseComment, id: 8, body: "Deleted", deleted_at: "2026-07-10T10:11:00.000Z" } },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: discussionDetail }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    expect(screen.getByTestId("issue-detail-workspace").querySelector("time")).toHaveAttribute("datetime", detail.issue.created_at);
    const commentCountLink = screen.getByRole("link", { name: "2 条评论" });
    expect(commentCountLink).toHaveClass("h-11", "sm:h-6");
    expect(commentCountLink.parentElement).toHaveClass("inline-flex", "whitespace-nowrap");
    expect(commentCountLink.parentElement).toHaveTextContent("·2 条评论");
    expect(commentCountLink.parentElement?.querySelector('[aria-hidden="true"]')).toHaveClass("hidden", "sm:inline");
    expect(commentCountLink.getAttribute("href")).toContain("localappIssueId=12");
    expect(commentCountLink.getAttribute("href")).toContain("localappIssueCommentId=6");
  });

  it("renders a non-interactive zero count when every comment is deleted", async () => {
    const noDiscussionDetail = { ...detail, timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, deleted_at: "2026-07-10T10:11:00.000Z" } } : item) };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: noDiscussionDetail }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    expect(screen.getByText("0 条评论")).toBeInTheDocument();
    expect(screen.getByText("0 条评论").parentElement).toHaveClass("inline-flex", "whitespace-nowrap");
    expect(screen.queryByRole("link", { name: "0 条评论" })).toBeNull();
  });

  it("lets the app owner select the current page and retains only failed bulk status updates", async () => {
    const issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First" },
      { ...openIssue, id: 13, issue_number: 13, title: "Second" },
      { ...openIssue, id: 14, issue_number: 14, title: "Third" },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/13" && init?.method === "PATCH") return jsonResponse({ success: false, error: "locked" }, 409);
      if (/^\/api\/issues\/\d+$/.test(url) && init?.method === "PATCH") return jsonResponse({ success: true, data: { ...openIssue, status: "closed" } });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 3, open: 3 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    const selectAll = await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" });
    const selectionStatus = screen.getByRole("status", { name: "Issue 选择状态" });
    expect(selectionStatus).toHaveAttribute("aria-atomic", "true");
    expect(selectionStatus).toHaveTextContent("未选择 Issue");
    expect(selectAll.closest("label")).toHaveClass("h-11", "w-11", "sm:h-6", "sm:w-6");
    expect(selectAll.closest("label")).toHaveClass("focus-within:ring-2", "focus-within:ring-ring");
    fireEvent.click(selectAll);
    expect(selectionStatus).toHaveTextContent("已选择 3 条 Issue");
    expect(screen.getByRole("toolbar", { name: "批量 Issue 操作" })).toHaveTextContent("已选择 3 条");
    expect(screen.getByTestId("issue-list-workspace")).toHaveClass("[&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-2", "[&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-ring");
    fireEvent.click(screen.getByRole("button", { name: "关闭所选" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("2 条成功，1 条失败，可重试失败项"));
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" }).closest("label")).toHaveClass("h-11", "w-11", "sm:h-6", "sm:w-6");
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" }).closest("label")).toHaveClass("focus-within:ring-2", "focus-within:ring-ring");
    expect(screen.getByRole("checkbox", { name: "选择 Issue #13" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #14" })).not.toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/13", expect.objectContaining({ method: "PATCH" }));
    fireEvent.click(screen.getByRole("button", { name: "清除选择" }));
    await waitFor(() => expect(selectAll).toHaveFocus());
  });

  it("bulk adds a label and retains only failed Issues for retry", async () => {
    const acceptance = { id: "acceptance", name: "验收", color: "1d76db", description: "", built_in: 0, created_at: "", updated_at: "" };
    const issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First", labels: [acceptance] },
      { ...openIssue, id: 13, issue_number: 13, title: "Second", labels: [] },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/13/labels" && init?.method === "PUT") return jsonResponse({ success: false, error: "locked" }, 409);
      if (url === "/api/issues/12/labels" && init?.method === "PUT") return jsonResponse({ success: true, data: detail });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [acceptance] });
      return issueListResponse(issues, { total: 2, open: 2 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" }));
    fireEvent.change(screen.getByRole("combobox", { name: "批量标签操作" }), { target: { value: "add:acceptance" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("1 条成功，1 条失败，可重试失败项"));
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #13" })).toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/labels", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ pagePath: "owner/research", labelIds: ["acceptance"] }),
    }));
    expect(screen.getByRole("combobox", { name: "批量标签操作" })).toHaveValue("");
  });

  it("bulk changes Issue Type independently and retains failed Issues", async () => {
    const issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First", labels: [] },
      { ...openIssue, id: 13, issue_number: 13, title: "Second", labels: [] },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/13" && init?.method === "PATCH") return jsonResponse({ success: false, error: "locked" }, 409);
      if (url === "/api/issues/12" && init?.method === "PATCH") return jsonResponse({ success: true, data: { ...issues[0], issue_type: "feature", label: "feature" } });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 2, open: 2 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" }));
    fireEvent.change(screen.getByRole("combobox", { name: "批量类型操作" }), { target: { value: "feature" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("1 条成功，1 条失败，可重试失败项"));
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #13" })).toBeChecked();
    const request = fetchMock.mock.calls.find(([url, init]) => url === "/api/issues/12" && init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ pagePath: "owner/research", issueType: "feature" });
    expect(screen.getByRole("combobox", { name: "批量类型操作" })).toHaveValue("");
  });

  it("returns focus after a successful bulk Issue Type update finishes", async () => {
    const issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First", labels: [] },
      { ...openIssue, id: 13, issue_number: 13, title: "Second", labels: [] },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (/^\/api\/issues\/\d+$/.test(url) && init?.method === "PATCH") return jsonResponse({ success: true, data: { ...issues[0], issue_type: "feature", label: "feature" } });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 2, open: 2 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    const selectAll = await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" });
    fireEvent.click(selectAll);
    fireEvent.change(screen.getByRole("combobox", { name: "批量类型操作" }), { target: { value: "feature" } });

    await screen.findByText("2 条 Issue 已更新", { selector: '[role="status"]' });
    await waitFor(() => expect(selectAll).toHaveFocus());
  });

  it("bulk assigns a user and preserves existing assignees", async () => {
    const issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First", assignee_ids: ["alice"] },
      { ...openIssue, id: 13, issue_number: 13, title: "Second", assignee_ids: [] },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (/^\/api\/issues\/\d+\/assignees$/.test(url) && init?.method === "PUT") return jsonResponse({ success: true, data: detail });
      if (url === "/api/users") return jsonResponse({ success: true, data: [
        { id: "alice", name: "alice", displayName: "Alice", avatarUrl: null },
        { id: "bob", name: "bob", displayName: "Bob", avatarUrl: null },
      ] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 2, open: 2 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" }));
    fireEvent.change(screen.getByRole("combobox", { name: "批量负责人操作" }), { target: { value: "add:bob" } });

    await waitFor(() => expect(screen.getAllByText("2 条 Issue 已更新")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/assignees", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ pagePath: "owner/research", userIds: ["alice", "bob"] }),
    }));
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/13/assignees", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ pagePath: "owner/research", userIds: ["bob"] }),
    }));
    expect(screen.queryByRole("toolbar", { name: "批量 Issue 操作" })).not.toBeInTheDocument();
  });

  it("bulk assigns a milestone and retains only failed Issues for retry", async () => {
    const milestone = { id: 7, title: "v1.0", description: "Release", due_on: "2026-09-01", state: "open", created_by: "owner", created_at: "", updated_at: "", open_issues: 0, closed_issues: 0 };
    const issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First", milestone_id: null },
      { ...openIssue, id: 13, issue_number: 13, title: "Second", milestone_id: null },
    ];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/13/milestone" && init?.method === "PUT") return jsonResponse({ success: false, error: "locked" }, 409);
      if (url === "/api/issues/12/milestone" && init?.method === "PUT") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [milestone] });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 2, open: 2 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" }));
    fireEvent.change(screen.getByRole("combobox", { name: "批量里程碑操作" }), { target: { value: "7" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("1 条成功，1 条失败，可重试失败项"));
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #13" })).toBeChecked();
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/milestone", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ pagePath: "owner/research", milestoneId: 7 }),
    }));
    expect(screen.getByRole("combobox", { name: "批量里程碑操作" })).toHaveValue("");
  });

  it("bulk clears milestone assignments", async () => {
    const issues = [{ ...openIssue, id: 12, issue_number: 12, milestone_id: 7 }];
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12/milestone" && init?.method === "PUT") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [] });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 1, open: 1 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" }));
    fireEvent.change(screen.getByRole("combobox", { name: "批量里程碑操作" }), { target: { value: "none" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/milestone", expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ pagePath: "owner/research", milestoneId: null }),
    })));
  });

  it("shows compact accessible assignees on Issue rows", async () => {
    const assigned = { ...openIssue, assignee_ids: ["alice", "bob", "carol", "dave"] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [
        { id: "alice", name: "alice", displayName: "Alice", avatarUrl: "/alice.png" },
        { id: "bob", name: "bob", displayName: "Bob", avatarUrl: null },
        { id: "carol", name: "carol", displayName: "Carol", avatarUrl: null },
      ] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse([assigned], { total: 1, open: 1 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} onClose={vi.fn()} />);

    await screen.findByRole("link", { name: `#${assigned.issue_number} ${assigned.title}` });
    const group = document.querySelector<HTMLElement>('[role="group"][aria-label="负责人：alice、bob、carol、dave"]');
    expect(group).not.toBeNull();
    if (!group) throw new Error("assignee group missing");
    expect(group).toHaveClass("hidden", "sm:flex", "shrink-0", "self-center");
    expect(within(group).getByRole("button", { name: "按负责人筛选 alice", hidden: true })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "按负责人筛选 bob", hidden: true })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "按负责人筛选 carol", hidden: true })).toBeInTheDocument();
    expect(within(group).queryByRole("button", { name: "按负责人筛选 dave", hidden: true })).toBeNull();
    expect(within(group).getByLabelText("另外 1 位负责人")).toHaveTextContent("+1");

    fireEvent.click(within(group).getByRole("button", { name: "按负责人筛选 alice", hidden: true }));
    await waitFor(() => expect(window.location.search).toContain("localappIssueAssignee=alice"));
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input), "http://localhost").searchParams.get("assignee") === "alice")).toBe(true);
    expect(screen.getByRole("button", { name: "移除负责人筛选 alice" })).toBeInTheDocument();
  });

  it("announces realtime selection reconciliation and restores focus when the selected row disappears", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First" },
      { ...openIssue, id: 13, issue_number: 13, title: "Second" },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: issues.length, open: issues.length });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    const selectAll = await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" });
    const selectedRow = screen.getByRole("checkbox", { name: "选择 Issue #12" });
    fireEvent.click(selectedRow);
    selectedRow.focus();
    issues = [issues[1]];
    act(() => MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12 } }));

    await waitFor(() => expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("1 条已选 Issue 已不在当前列表，选择已更新"))).toBe(true));
    expect(screen.queryByRole("toolbar", { name: "批量 Issue 操作" })).not.toBeInTheDocument();
    await waitFor(() => expect(selectAll).toHaveFocus());
  });

  it("restores focus when realtime reconciliation removes the focused bulk toolbar", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First" },
      { ...openIssue, id: 13, issue_number: 13, title: "Second" },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: issues.length, open: issues.length });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    const selectAll = await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue #12" }));
    screen.getByRole("button", { name: "关闭所选" }).focus();
    issues = [issues[1]];
    act(() => MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12 } }));

    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "批量 Issue 操作" })).not.toBeInTheDocument());
    await waitFor(() => expect(selectAll).toHaveFocus());
  });

  it("does not steal focus after the user leaves the bulk toolbar before realtime reconciliation", async () => {
    vi.stubGlobal("EventSource", MockIssueEventSource);
    let issues = [
      { ...openIssue, id: 12, issue_number: 12, title: "First" },
      { ...openIssue, id: 13, issue_number: 13, title: "Second" },
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: issues.length, open: issues.length });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue #12" }));
    screen.getByRole("button", { name: "关闭所选" }).focus();
    const search = screen.getByRole("searchbox", { name: "搜索 Issue" });
    search.focus();
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    issues = [issues[1]];
    act(() => MockIssueEventSource.instances[0].emit("issue:changed", { type: "issue:changed", data: { pagePath: "owner/research", issueId: 12 } }));

    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "批量 Issue 操作" })).not.toBeInTheDocument());
    expect(search).toHaveFocus();
  });

  it("does not expose bulk selection to non-owners", async () => {
    mockWorkspaceApi();
    renderModal({ id: "alice", name: "Alice" });
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    expect(screen.queryByRole("checkbox", { name: "选择当前页全部 Issue" })).not.toBeInTheDocument();
  });

  it("shift selects and clears visible Issue ranges without retaining a stale query anchor", async () => {
    const issues = [12, 13, 14, 15].map((id) => ({ ...openIssue, id, issue_number: id, title: `Issue ${id}` }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      if (url.startsWith("/api/issues/labels")) return jsonResponse({ success: true, data: [] });
      return issueListResponse(issues, { total: 4, open: 4, closed: 4 });
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "owner", name: "Owner" }} onClose={vi.fn()} />);

    await screen.findByRole("checkbox", { name: "选择当前页全部 Issue" });
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue #15" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue #12" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue #14" }), { shiftKey: true, detail: 1 });
    for (const id of [12, 13, 14, 15]) expect(screen.getByRole("checkbox", { name: `选择 Issue #${id}` })).toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue #13" }), { shiftKey: true, detail: 1 });
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #13" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #14" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #15" })).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "已关闭 4" }));
    await waitFor(() => expect(screen.queryByRole("toolbar", { name: "批量 Issue 操作" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 Issue #14" }), { shiftKey: true, detail: 1 });
    expect(screen.getByRole("checkbox", { name: "选择 Issue #14" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #13" })).not.toBeChecked();
    fireEvent.keyDown(screen.getByRole("checkbox", { name: "选择 Issue #13" }), { key: " " });
    expect(screen.getByRole("checkbox", { name: "选择 Issue #13" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择 Issue #12" })).not.toBeChecked();
  });

  it("toggles body and authored-comment tasks with expected content versions", async () => {
    const taskDetail = {
      ...detail,
      issue: { ...detail.issue, description: "- [ ] reproduce\n- [x] diagnose" },
      timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, body: "- [ ] verify fix" } } : item),
    };
    const updatedIssueDetail = { ...taskDetail, issue: { ...taskDetail.issue, description: "- [x] reproduce\n- [x] diagnose", updated_at: "2026-07-10T12:00:00.000Z" } };
    const updatedCommentDetail = { ...updatedIssueDetail, timeline: updatedIssueDetail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, body: "- [x] verify fix", updated_at: "2026-07-10T12:01:00.000Z" } } : item) };
    let currentDetail = taskDetail;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: currentDetail });
      if (url === "/api/issues/12" && init?.method === "PATCH") { currentDetail = updatedIssueDetail; return jsonResponse({ success: true, data: updatedIssueDetail.issue }); }
      if (url === "/api/issues/12/comments/6" && init?.method === "PATCH") { currentDetail = updatedCommentDetail; return jsonResponse({ success: true, data: updatedCommentDetail }); }
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    const taskProgress = within(screen.getByTestId("issue-body-card")).getByRole("progressbar", { name: "任务进度" });
    expect(taskProgress).toHaveAttribute("aria-valuenow", "1");
    expect(taskProgress).toHaveAttribute("aria-valuemin", "0");
    expect(taskProgress).toHaveAttribute("aria-valuemax", "2");
    expect(taskProgress).toHaveAttribute("aria-valuetext", "已完成 1 / 2 个任务");
    expect(taskProgress).toHaveTextContent("任务 1 / 2");
    fireEvent.click(within(screen.getByTestId("issue-body-card")).getByRole("checkbox", { name: "任务 1，未完成" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12", expect.objectContaining({ method: "PATCH" })));
    const issueRequest = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/issues/12" && init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(issueRequest?.body))).toMatchObject({ description: "- [x] reproduce\n- [x] diagnose", expectedUpdatedAt: taskDetail.issue.updated_at });

    fireEvent.click(within(screen.getByTestId("issue-comment-6")).getByRole("checkbox", { name: "任务 1，未完成" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments/6", expect.objectContaining({ method: "PATCH" })));
    const commentRequest = fetchMock.mock.calls.find(([input, init]) => String(input).includes("comments/6") && init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(commentRequest?.body))).toMatchObject({ body: "- [x] verify fix", expectedUpdatedAt: "2026-07-10T10:00:00.000Z" });
  });

  it("confirms and converts an owner body task into a Sub-issue", async () => {
    const taskDetail = { ...detail, issue: { ...detail.issue, description: "- [ ] **Build** the API" } };
    const convertedDetail = {
      ...taskDetail,
      issue: { ...taskDetail.issue, description: "- [ ] #13", updated_at: "2026-07-10T12:30:00.000Z" },
      subIssues: [{ ...openIssue, id: 13, issue_number: 13, title: "Build platform API", reporter_id: "owner", position: 0, added_by: "owner", relation_created_at: "2026-07-10T12:30:00.000Z", assignee_ids: [] }],
      subIssueSummary: { total: 1, completed: 0, percent: 0 },
    };
    let currentDetail = taskDetail;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: currentDetail });
      if (url === "/api/issues/12/tasks/0/convert" && init?.method === "POST") { currentDetail = convertedDetail; return jsonResponse({ success: true, data: convertedDetail }); }
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();

    fireEvent.click(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "将任务 1 转换为 Sub-issue" }));
    const dialog = screen.getByRole("alertdialog", { name: "转换为 Sub-issue" });
    expect(within(dialog).getByRole("textbox", { name: "Sub-issue 标题" })).toHaveValue("Build the API");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Sub-issue 标题" }), { target: { value: "Build platform API" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "创建 Sub-issue" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/tasks/0/convert", expect.objectContaining({ method: "POST" })));
    const request = fetchMock.mock.calls.find(([input, init]) => String(input).endsWith("/tasks/0/convert") && init?.method === "POST")?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ pagePath: "owner/research", expectedUpdatedAt: taskDetail.issue.updated_at, title: "Build platform API" });
    await waitFor(() => expect(screen.getByRole("link", { name: "#13" })).toHaveFocus());
  });

  it("opens read-only Issue and comment revision history and restores trigger focus", async () => {
    const revisedDetail = {
      ...detail,
      issue: { ...detail.issue, revision_count: 1 },
      timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, revision_count: 1 } } : item),
    };
    const issueRevision = { id: 1, issue_id: 12, target_type: "issue", target_id: 12, editor_id: "alice", title: "旧标题", body: "旧的 **Issue** 正文", fields_json: '["title","description"]', created_at: "2026-07-10T10:30:00.000Z" };
    const commentRevision = { id: 2, issue_id: 12, target_type: "comment", target_id: 6, editor_id: "alice", title: null, body: "旧的 **评论**", fields_json: '["body"]', created_at: "2026-07-10T10:40:00.000Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [{ id: "alice", name: "alice", displayName: "Alice", avatarUrl: null }] });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: revisedDetail });
      if (url === "/api/issues/12/history?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [issueRevision] });
      if (url === "/api/issues/12/comments/6/history?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [commentRevision] });
      return issueListResponse([openIssue]);
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} selectedIssueId={12} onClose={vi.fn()} />);

    const issueEdited = await screen.findByRole("button", { name: "查看 Issue 编辑历史，1 次修改" });
    expect(issueEdited).toHaveClass("h-11", "sm:h-6");
    fireEvent.click(issueEdited);
    const issueHistoryDialog = await screen.findByRole("dialog", { name: "编辑历史" });
    expect(screen.getByRole("button", { name: "关闭编辑历史" })).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    expect(issueHistoryDialog).toHaveAccessibleDescription("Issue #12");
    expect(issueHistoryDialog).toHaveFocus();
    expect(screen.getByRole("list", { name: "编辑历史版本" })).toHaveTextContent("当前版本");
    expect(screen.getByRole("list", { name: "编辑历史版本" })).toHaveTextContent("旧标题");
    expect(screen.getByRole("list", { name: "编辑历史版本" })).toHaveTextContent("旧的 Issue 正文");
    fireEvent.keyDown(issueHistoryDialog, { key: "Tab", shiftKey: true });
    expect(screen.getByRole("button", { name: "关闭编辑历史" })).toHaveFocus();
    fireEvent.keyDown(issueHistoryDialog, { key: "Tab" });
    expect(screen.getByRole("button", { name: "关闭编辑历史" })).toHaveFocus();
    fireEvent.keyDown(issueHistoryDialog, { key: "Escape" });
    await waitFor(() => expect(issueEdited).toHaveFocus());

    const commentEdited = screen.getByRole("button", { name: "查看评论编辑历史，1 次修改" });
    expect(commentEdited).toHaveClass("h-11", "sm:h-6");
    fireEvent.click(commentEdited);
    const commentHistoryDialog = await screen.findByRole("dialog", { name: "编辑历史" });
    expect(commentHistoryDialog).toHaveAccessibleDescription("评论 #6");
    expect(screen.getByRole("list", { name: "编辑历史版本" })).toHaveTextContent("旧的 评论");
    expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments/6/history?pagePath=owner%2Fresearch", {
      credentials: "include",
      signal: expect.any(AbortSignal),
    });
  });

  it("keeps revision history failures inside the dialog and retries", async () => {
    const revisedDetail = { ...detail, issue: { ...detail.issue, revision_count: 1 } };
    let attempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: revisedDetail });
      if (url === "/api/issues/12/history?pagePath=owner%2Fresearch") return ++attempts === 1 ? jsonResponse({ success: false, error: "历史暂不可用" }, 503) : jsonResponse({ success: true, data: [] });
      return issueListResponse([openIssue]);
    });
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} selectedIssueId={12} onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "查看 Issue 编辑历史，1 次修改" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("历史暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(screen.getByRole("list", { name: "编辑历史版本" })).toBeInTheDocument());
    expect(attempts).toBe(2);
  });

  it("compacts a long collaboration history batch and expands every original action", async () => {
    const eventDetail = {
      ...detail,
      timeline: [
        { kind: "event" as const, event: { id: 10, issue_id: 12, actor_id: "alice", event_type: "labels_changed", payload_json: JSON.stringify({ from: ["bug"], to: ["bug", "urgent"] }), created_at: "2026-07-10T11:00:00.000Z" } },
        { kind: "event" as const, event: { id: 11, issue_id: 12, actor_id: "alice", event_type: "assignees_changed", payload_json: JSON.stringify({ from: [], to: ["bob"] }), created_at: "2026-07-10T11:01:00.000Z" } },
        { kind: "event" as const, event: { id: 12, issue_id: 12, actor_id: "bob", event_type: "subscribed", payload_json: "{}", created_at: "2026-07-10T11:02:00.000Z" } },
        { kind: "event" as const, event: { id: 13, issue_id: 12, actor_id: "bob", event_type: "unsubscribed", payload_json: "{}", created_at: "2026-07-10T11:03:00.000Z" } },
        { kind: "event" as const, event: { id: 14, issue_id: 12, actor_id: "alice", event_type: "future_event", payload_json: "not-json", created_at: "2026-07-10T11:04:00.000Z" } },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [{ id: "alice", name: "alice", displayName: "Alice", avatarUrl: null }, { id: "bob", name: "bob", displayName: "Bob", avatarUrl: null }] });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: eventDetail });
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    const timeline = screen.getByRole("list", { name: "Issue 时间线" });
    const summary = within(timeline).getByRole("button", { name: "5 项历史更新" });
    expect(summary).toHaveAttribute("aria-expanded", "false");
    expect(within(timeline).queryByRole("list", { name: "历史更新明细，共 5 项" })).toBeNull();
    expect(timeline).not.toHaveTextContent("更新了标签");
    fireEvent.click(summary);
    expect(summary).toHaveAttribute("aria-expanded", "true");
    expect(within(timeline).getByRole("list", { name: "历史更新明细，共 5 项" }).children).toHaveLength(5);
    expect(timeline).toHaveTextContent("更新了标签");
    expect(timeline).toHaveTextContent("将 Bob 设为负责人");
    expect(timeline).toHaveTextContent("订阅了此 Issue");
    expect(timeline).toHaveTextContent("取消订阅了此 Issue");
    expect(timeline).toHaveTextContent("更新了此 Issue");
  });

  it("compacts consecutive edits by one actor and expands every original timestamp", async () => {
    const compactedDetail = {
      ...detail,
      timeline: [
        { kind: "event" as const, event: { id: 20, issue_id: 12, actor_id: "alice", event_type: "edited", payload_json: "{}", created_at: "2026-07-10T11:20:00.000Z" } },
        { kind: "event" as const, event: { id: 21, issue_id: 12, actor_id: "alice", event_type: "edited", payload_json: "{}", created_at: "2026-07-10T11:21:00.000Z" } },
        { kind: "event" as const, event: { id: 22, issue_id: 12, actor_id: "alice", event_type: "edited", payload_json: "{}", created_at: "2026-07-10T11:22:00.000Z" } },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: compactedDetail }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    const toggle = screen.getByRole("button", { name: /Alice.*编辑了此 Issue 3 次/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Alice 的编辑事件" })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("list", { name: "Alice 的编辑事件" }).children).toHaveLength(3);
  });

  it("filters timeline activity with counts and preserves an actionable empty state", async () => {
    mockWorkspaceApi();
    renderModal();
    await openDetail();

    const filters = screen.getByRole("radiogroup", { name: "筛选时间线活动" });
    expect(screen.getByText("活动")).toHaveClass("shrink-0", "whitespace-nowrap");
    expect(filters).toHaveClass("grid", "w-full", "grid-cols-3", "sm:w-auto");
    expect(within(filters).getByRole("radio", { name: /全部/ })).toHaveClass("h-11", "sm:h-7");
    expect(within(filters).getByRole("radio", { name: "全部 2" })).toHaveAttribute("aria-checked", "true");
    expect(within(filters).getByRole("radio", { name: "全部 2" })).toHaveAttribute("tabindex", "0");
    expect(within(filters).getByRole("radio", { name: "评论 1" })).toHaveAttribute("tabindex", "-1");
    expect(within(filters).getByRole("radio", { name: "评论 1" })).toBeInTheDocument();
    expect(within(filters).getByRole("radio", { name: "历史 1" })).toBeInTheDocument();

    fireEvent.keyDown(within(filters).getByRole("radio", { name: "全部 2" }), { key: "End" });
    await waitFor(() => expect(within(filters).getByRole("radio", { name: "历史 1" })).toHaveFocus());
    expect(within(filters).getByRole("radio", { name: "历史 1" })).toHaveAttribute("aria-checked", "true");
    expect(within(filters).getByRole("radio", { name: "历史 1" })).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(within(filters).getByRole("radio", { name: "历史 1" }), { key: "Home" });
    await waitFor(() => expect(within(filters).getByRole("radio", { name: "全部 2" })).toHaveFocus());
    expect(within(filters).getByRole("radio", { name: "全部 2" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(filters).getByRole("radio", { name: "评论 1" }));
    expect(screen.getByRole("list", { name: "Issue 时间线" })).toHaveTextContent("复现步骤：");
    expect(within(screen.getByRole("list", { name: "Issue 时间线" })).queryByText("打开了此 Issue")).toBeNull();

    fireEvent.click(within(filters).getByRole("radio", { name: "历史 1" }));
    expect(screen.getByRole("list", { name: "Issue 时间线" })).toHaveTextContent("打开了此 Issue");
    expect(screen.queryByTestId("issue-comment-6")).toBeNull();

  });

  it("marks the issue reporter as 作者 in the body and their comments", async () => {
    const revisedDetail = {
      ...detail,
      issue: { ...detail.issue, revision_count: 1 },
      timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, revision_count: 1 } } : item),
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: revisedDetail }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    expect(within(screen.getByTestId("issue-body-card")).getByText("作者")).toBeInTheDocument();
    expect(within(screen.getByTestId("issue-comment-6")).getByText("作者")).toBeInTheDocument();
    expect(within(screen.getByTestId("issue-body-card")).getByText("已编辑")).toBeInTheDocument();
    expect(within(screen.getByTestId("issue-comment-6")).getByText("已编辑")).toBeInTheDocument();
  });

  it("keeps activity filters available when the selected kind is empty", async () => {
    const eventOnlyDetail = { ...detail, timeline: detail.timeline.filter((item) => item.kind === "event") };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: eventOnlyDetail }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    fireEvent.click(screen.getByRole("radio", { name: "评论 0" }));
    expect(screen.getByText("还没有评论")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "筛选时间线活动" })).toBeInTheDocument();
  });

  it("progressively reveals long timelines and preserves keyboard focus", async () => {
    const longTimeline = Array.from({ length: 45 }, (_, index) => ({
      kind: "event" as const,
      event: { id: 100 + index, issue_id: 12, actor_id: index % 2 ? "bob" : "alice", event_type: "edited", payload_json: "{}", created_at: `2026-07-10T11:${String(index).padStart(2, "0")}:00.000Z` },
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: { ...detail, timeline: longTimeline } }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    const timeline = screen.getByRole("list", { name: "Issue 时间线" });
    expect(within(timeline).getAllByTestId(/issue-event-/)).toHaveLength(20);
    const reveal = screen.getByRole("button", { name: "显示更早的 25 条活动" });
    fireEvent.click(reveal);
    expect(within(timeline).getAllByTestId(/issue-event-/)).toHaveLength(40);
    const finalReveal = screen.getByRole("button", { name: "显示更早的 5 条活动" });
    await waitFor(() => expect(finalReveal).toHaveFocus());
    fireEvent.click(finalReveal);
    expect(within(timeline).getAllByTestId(/issue-event-/)).toHaveLength(45);
    await waitFor(() => expect(timeline).toHaveFocus());
  });

  it("reveals and focuses a valid comment deep link hidden by the history filter", async () => {
    mockWorkspaceApi();
    const rendered = renderModal();
    await openDetail();
    fireEvent.click(screen.getByRole("radio", { name: "历史 1" }));
    expect(screen.queryByTestId("issue-comment-6")).toBeNull();

    window.history.replaceState(null, "", "/owner/research?localappIssueId=12&localappIssueCommentId=6#issuecomment-6");
    rendered.rerender(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("radio", { name: "评论 1" })).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(screen.getByTestId("issue-comment-6")).toHaveFocus());
    expect(screen.getByTestId("issue-comment-6")).toHaveAttribute("aria-current", "location");
  });

  it("keeps the history filter when a deep link targets a deleted comment", async () => {
    const deletedDetail = { ...detail, timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, deleted_at: "2026-07-10T10:30:00.000Z" } } : item) };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: deletedDetail }) : issueListResponse([openIssue]));
    const rendered = renderModal();
    await openDetail();
    fireEvent.click(screen.getByRole("radio", { name: "历史 1" }));

    window.history.replaceState(null, "", "/owner/research?localappIssueId=12&localappIssueCommentId=6#issuecomment-6");
    rendered.rerender(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("radio", { name: "历史 1" })).toHaveAttribute("aria-checked", "true"));
    expect(screen.queryByTestId("issue-comment-6")).toBeNull();
  });

  it("renders a locked conversation as read-only and lets the reporter unlock it", async () => {
    const lockedDetail = {
      ...detail,
      issue: { ...detail.issue, description: "- [ ] archived task", locked_at: "2026-07-10T11:05:00.000Z", locked_by: "alice", lock_reason: "resolved" as const },
      timeline: [...detail.timeline, { kind: "event" as const, event: { id: 15, issue_id: 12, actor_id: "alice", event_type: "locked", payload_json: JSON.stringify({ reason: "resolved" }), created_at: "2026-07-10T11:05:00.000Z" } }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: lockedDetail });
      if (url === "/api/issues/12/lock" && init?.method === "PUT") return jsonResponse({ success: true, data: { ...lockedDetail, issue: { ...lockedDetail.issue, locked_at: null, locked_by: null } } });
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    expect(screen.getByText("已锁定")).toBeInTheDocument();
    expect(screen.getAllByRole("status").some((status) => status.textContent?.includes("@alice 锁定了此 Issue（已解决）"))).toBe(true);
    expect(screen.queryByRole("textbox", { name: "评论内容" })).toBeNull();
    expect(within(screen.getByTestId("issue-body-card")).getByRole("checkbox", { name: "任务 1，未完成" })).toBeDisabled();
    expect(screen.getByRole("list", { name: "Issue 时间线" })).toHaveTextContent("锁定了对话（已解决）");
    fireEvent.click(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" }));
    expect(screen.queryByRole("menuitem", { name: "引用回复" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("menu", { name: "Issue 操作" }), { key: "Escape" });

    fireEvent.click(within(screen.getByTestId("issue-metadata-desktop")).getByRole("button", { name: "解锁对话" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/lock", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === "/api/issues/12/lock")?.[1]?.body))).toEqual({ pagePath: "owner/research", locked: false });
  });

  it("confirms a lock reason before sending the mutation and restores trigger focus on cancel", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal();
    await openDetail();
    const trigger = within(screen.getByTestId("issue-metadata-desktop")).getByRole("button", { name: "锁定对话" });

    fireEvent.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "锁定对话" });
    const reason = within(dialog).getByLabelText("锁定原因");
    const close = within(dialog).getByRole("button", { name: "取消锁定" });
    const confirm = within(dialog).getByRole("button", { name: "确认锁定" });
    expect(reason).toHaveClass("h-11", "sm:h-9");
    expect(close).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    expect(confirm).toHaveClass("h-11", "sm:h-8");
    expect(reason).toHaveFocus();
    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(close).toHaveFocus();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/issues/12/lock")).toBe(false);

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByRole("dialog", { name: "锁定对话" })).toBeNull();

    fireEvent.click(trigger);
    fireEvent.change(screen.getByLabelText("锁定原因"), { target: { value: "too_heated" } });
    fireEvent.click(screen.getByRole("button", { name: "确认锁定" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === "/api/issues/12/lock")).toBe(true));
    const request = fetchMock.mock.calls.find(([url]) => String(url) === "/api/issues/12/lock")?.[1];
    expect(JSON.parse(String(request?.body))).toEqual({ pagePath: "owner/research", locked: true, reason: "too_heated" });
  });

  it("keeps a failed lock request and its selected reason inside the dialog for retry", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/12/lock" && init?.method === "PUT") return jsonResponse({ success: false, error: "锁定请求失败" }, 503);
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();
    fireEvent.click(within(screen.getByTestId("issue-metadata-desktop")).getByRole("button", { name: "锁定对话" }));
    fireEvent.change(screen.getByLabelText("锁定原因"), { target: { value: "too_heated" } });
    fireEvent.click(screen.getByRole("button", { name: "确认锁定" }));

    const dialog = screen.getByRole("dialog", { name: "锁定对话" });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("锁定请求失败");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(within(dialog).getByLabelText("锁定原因")).toHaveValue("too_heated");
    expect(within(dialog).getByRole("button", { name: "确认锁定" })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole("button", { name: "确认锁定" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/issues/12/lock")).toHaveLength(2));
  });

  it("renders a GitHub-fidelity detail discussion and responsive metadata layout", async () => {
    mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });

    await openDetail();

    const workspace = screen.getByTestId("issue-detail-workspace");
    expect(workspace).toHaveAttribute("data-localapp-issue-detail");
    expect(workspace).toHaveClass("lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]", "lg:gap-6");
    expect(screen.getByRole("heading", { name: "修复上传失败" })).toHaveClass("text-2xl", "leading-8", "font-normal", "sm:text-[32px]", "sm:leading-10");
    expect(screen.getByRole("button", { name: "复制 Issue 链接" })).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    expect(screen.getByText("#12")).toHaveClass("text-muted-foreground");
    expect(screen.getByText("开启")).toHaveClass("bg-emerald-700");
    expect(screen.getByTestId("issue-discussion")).toHaveAttribute("data-localapp-issue-discussion");
    expect(screen.getByTestId("issue-body-card")).toHaveAttribute("data-localapp-issue-body-card");
    expect(screen.getByTestId("issue-body-card")).toHaveClass("rounded-[6px]");
    const bodyTimestamp = screen.getByTestId("issue-body-card").querySelector<HTMLTimeElement>(`time[datetime="${detail.issue.created_at}"]`);
    const bodyPermalink = bodyTimestamp?.closest("a");
    expect(bodyPermalink).toHaveAttribute("href", expect.stringContaining("localappIssueId=12"));
    expect(bodyPermalink?.getAttribute("href")).not.toContain("localappIssueNumber");
    expect(bodyPermalink).toHaveClass("h-11", "sm:h-6");
    expect(screen.getByTestId("issue-comment-6")).toHaveAttribute("data-localapp-issue-comment-card");
    const commentAction = screen.getByRole("button", { name: "评论操作" }).closest("[data-localapp-issue-actor-action]");
    expect(commentAction).toHaveClass("shrink-0", "self-start");
    expect(commentAction?.closest("[data-localapp-issue-comment-card]")).toBe(screen.getByTestId("issue-comment-6"));
    expect(screen.getByTestId("issue-event-1")).toHaveAttribute("data-localapp-issue-event");
    expect(screen.getByTestId("issue-metadata-desktop")).toHaveAttribute("data-localapp-issue-metadata");
    expect(screen.getByTestId("issue-metadata-desktop")).toHaveClass("max-lg:hidden");
    expect(screen.getByTestId("issue-metadata-desktop")).not.toHaveClass("hidden");
    expect(screen.getByTestId("issue-metadata-mobile").tagName).toBe("DETAILS");
    expect(within(screen.getByTestId("issue-metadata-mobile")).getByText("1 个标签 · 未分配")).toBeInTheDocument();
    expect(within(screen.getByTestId("issue-metadata-mobile")).getByText("Issue 详情").closest("summary")).toHaveClass("min-h-11");
    expect(within(screen.getByTestId("issue-metadata-desktop")).getByRole("button", { name: "编辑标签" })).toHaveClass("h-11", "w-11", "sm:h-7", "sm:w-7");
    expect(within(screen.getByTestId("issue-metadata-desktop")).getByRole("button", { name: /订阅/ })).toHaveClass("h-11", "sm:h-8");
    expect(screen.getAllByText("alice").length).toBeGreaterThan(0);
    expect(screen.getAllByText("@alice").length).toBeGreaterThan(0);
  });

  it("compacts a large deduplicated participant roster with accessible overflow", async () => {
    const extraIds = Array.from({ length: 10 }, (_, index) => `user-${index + 2}`);
    const participantDetail = { ...detail, collaboration: { ...detail.collaboration, participant_ids: ["alice", ...extraIds] } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [
        { id: "alice", name: "alice", displayName: "Alice", avatarUrl: null },
        ...extraIds.map((id) => ({ id, name: id, displayName: `User ${id.slice(5)}`, avatarUrl: null })),
      ] });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: participantDetail });
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    const metadata = within(screen.getByTestId("issue-metadata-desktop"));
    const roster = metadata.getByRole("list", { name: "Issue 参与者" });
    expect(within(roster).getAllByRole("listitem")).toHaveLength(9);
    expect(within(roster).getByLabelText("Alice @alice")).toBeInTheDocument();
    expect(within(roster).getByText("+3")).toHaveAttribute("aria-label", "另外 3 位参与者");
    expect(within(roster).queryByLabelText("User 9 @user-9")).toBeNull();
  });

  it("manages labels, assignees, and the current user's subscription from the metadata sidebar", async () => {
    const urgent = { id: "urgent", name: "紧急", color: "b60205", description: "立即处理", built_in: 0, created_at: "2026-07-10T09:00:00.000Z", updated_at: "2026-07-10T09:00:00.000Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/users") return jsonResponse({ success: true, data: [
        { id: "alice", name: "alice", displayName: "Alice", avatarUrl: null },
        { id: "bob", name: "bob", displayName: "Bob", avatarUrl: null },
      ] });
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [detail.collaboration.labels[0], urgent] });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/12/labels" && init?.method === "PUT") return jsonResponse({ success: true, data: {
        ...detail, collaboration: { ...detail.collaboration, labels: [detail.collaboration.labels[0], urgent] },
      } });
      if (url === "/api/issues/12/assignees" && init?.method === "PUT") return jsonResponse({ success: true, data: {
        ...detail, collaboration: { ...detail.collaboration, assignee_ids: ["bob"] },
      } });
      if (url === "/api/issues/12/subscription" && init?.method === "PUT") return jsonResponse({ success: true, data: {
        ...detail, collaboration: { ...detail.collaboration, subscriber_ids: [] },
      } });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    expect(await screen.findByRole("option", { name: "紧急" })).toBeInTheDocument();
    await openDetail();
    const metadata = within(screen.getByTestId("issue-metadata-desktop"));
    expect(metadata.getByText("创建者")).toBeInTheDocument();
    expect(metadata.getByText("标签")).toBeInTheDocument();
    expect(metadata.getByText("负责人")).toBeInTheDocument();
    expect(metadata.getByText("通知")).toBeInTheDocument();
    expect(metadata.getByText("对话")).toBeInTheDocument();
    expect(metadata.getByText("参与者")).toBeInTheDocument();
    expect(screen.getByLabelText("Issue 元数据状态")).toHaveAttribute("aria-live", "polite");

    fireEvent.click(metadata.getByRole("button", { name: "编辑标签" }));
    fireEvent.click(metadata.getByRole("checkbox", { name: "紧急" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/labels", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === "/api/issues/12/labels")?.[1]?.body))).toEqual({
      pagePath: "owner/research", labelIds: ["bug", "urgent"],
    });

    fireEvent.click(metadata.getByRole("button", { name: "编辑负责人" }));
    fireEvent.click(metadata.getByRole("checkbox", { name: "Bob" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/assignees", expect.objectContaining({ method: "PUT" })));
    fireEvent.click(metadata.getByRole("button", { name: "取消订阅" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/subscription", expect.objectContaining({ method: "PUT" })));
  });

  it("shows metadata mutation failures next to the controls that triggered them", async () => {
    const urgent = { id: "urgent", name: "紧急", color: "b60205", description: "立即处理", built_in: 0, created_at: "2026-07-10T09:00:00.000Z", updated_at: "2026-07-10T09:00:00.000Z" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: [detail.collaboration.labels[0], urgent] });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/12/labels" && init?.method === "PUT") return htmlResponse();
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();

    const metadata = within(screen.getByTestId("issue-metadata-desktop"));
    fireEvent.click(metadata.getByRole("button", { name: "编辑标签" }));
    fireEvent.click(metadata.getByRole("checkbox", { name: "紧急" }));

    expect(await metadata.findByRole("alert")).toHaveTextContent("Issue 服务暂不可用");
    expect(metadata.getByRole("checkbox", { name: "紧急" })).not.toBeChecked();
  });

  it("shows raw actor ids and initials when an identity is unknown", async () => {
    const unknownDetail = {
      ...detail,
      issue: { ...detail.issue, reporter_id: "missing-user" },
      timeline: [{
        kind: "comment" as const,
        comment: { ...baseComment, author_id: "missing-user" },
      }],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") {
        return jsonResponse({ success: true, data: unknownDetail });
      }
      return issueListResponse([openIssue]);
    });
    renderModal();

    await openDetail();

    expect(screen.getAllByText("missing-user").length).toBeGreaterThan(0);
    expect(screen.getAllByText("M").length).toBeGreaterThan(0);
  });

  it("renders detail immediately and hydrates platform identities without refetching detail", async () => {
    let resolveUsers!: (response: Response) => void;
    const usersResponse = new Promise<Response>((resolve) => { resolveUsers = resolve; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return usersResponse;
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    await openDetail();
    expect(screen.getAllByText("alice").length).toBeGreaterThan(0);
    expect(screen.queryByText("Alice Chen")).toBeNull();

    await act(async () => resolveUsers(jsonResponse({ success: true, data: [{
      id: "alice",
      name: "alice",
      displayName: "Alice Chen",
      avatarUrl: "/api/avatar/alice",
    }] })));

    expect(await screen.findAllByText("Alice Chen")).not.toHaveLength(0);
    expect(document.querySelector('img[src="/api/avatar/alice"]')).not.toBeNull();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch")).toHaveLength(1);
  });

  it("disables a status mutation while pending and recovers from a non-JSON failure", async () => {
    let resolveStatus!: (response: Response) => void;
    const statusResponse = new Promise<Response>((resolve) => { resolveStatus = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/12" && init?.method === "PATCH") return statusResponse;
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    const closeButton = screen.getByRole("button", { name: "关闭 Issue" });
    fireEvent.click(closeButton);
    expect(closeButton).toBeDisabled();
    expect(closeButton).toHaveAttribute("aria-busy", "true");
    expect(closeButton.querySelector(".lucide-loader-circle")).toHaveClass("animate-spin", "motion-reduce:animate-none");
    expect(screen.getByRole("combobox", { name: "关闭原因" })).toBeDisabled();
    const [, statusRequest] = vi.mocked(globalThis.fetch).mock.calls.find(([url, init]) => url === "/api/issues/12" && init?.method === "PATCH")!;
    expect(JSON.parse(String(statusRequest?.body))).toMatchObject({ status: "closed", stateReason: "completed" });

    await act(async () => resolveStatus(htmlResponse()));

    expect(await screen.findByRole("alert")).toHaveTextContent("Issue 服务暂不可用");
    expect(closeButton).toBeEnabled();
    expect(closeButton).not.toHaveAttribute("aria-busy");
    expect(closeButton.querySelector(".lucide-loader-circle")).toBeNull();
    await waitFor(() => expect(closeButton).toHaveFocus());
  });

  it("closes with the selected not-planned reason", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal();
    await openDetail();

    fireEvent.change(screen.getByRole("combobox", { name: "关闭原因" }), { target: { value: "not_planned" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭 Issue" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => {
      if (String(input) !== "/api/issues/12" || init?.method !== "PATCH") return false;
      return JSON.parse(String(init.body)).stateReason === "not_planned";
    })).toBe(true));
  });

  it("renders a single not-planned result pill with a distinct icon in the detail header", async () => {
    const closedDetail = { ...detail, issue: { ...detail.issue, status: "closed" as const, state_reason: "not_planned" as const } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
      String(input) === "/api/issues/12?pagePath=owner%2Fresearch"
        ? jsonResponse({ success: true, data: closedDetail })
        : issueListResponse([closedDetail.issue]));
    renderModal();
    await openDetail();

    const result = screen.getByText("已关闭 · 不计划处理").closest("span");
    expect(result?.querySelector("svg")).toHaveClass("lucide-circle-slash-2");
    expect(screen.getAllByText(/不计划处理/)).toHaveLength(1);
    expect(screen.queryByText(/关闭原因：/)).toBeNull();
  });

  it("moves focus to the replacement status action after closing and reopening", async () => {
    let currentDetail: IssueDetail = detail;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: currentDetail });
      if (url === "/api/issues/12" && init?.method === "PATCH") {
        const request = JSON.parse(String(init.body)) as { status: "open" | "closed"; stateReason?: "completed" | null };
        currentDetail = { ...currentDetail, issue: { ...currentDetail.issue, status: request.status, state_reason: request.stateReason ?? null } };
        return jsonResponse({ success: true, data: currentDetail });
      }
      return issueListResponse([currentDetail.issue]);
    });
    renderModal();
    await openDetail();

    fireEvent.click(screen.getByRole("button", { name: "关闭 Issue" }));
    const reopen = await screen.findByRole("button", { name: "重新打开 Issue" });
    await waitFor(() => expect(reopen).toHaveFocus());
    fireEvent.click(reopen);
    await waitFor(() => expect(screen.getByRole("button", { name: "关闭 Issue" })).toHaveFocus());
  });

  it("ignores an older list response after the status filter changes", async () => {
    let resolveOpen!: (response: Response) => void;
    const openResponse = new Promise<Response>((resolve) => { resolveOpen = resolve; });
    const closedIssue = { ...openIssue, id: 13, issue_number: 13, title: "已关闭问题", status: "closed" as const };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("status=open")) return openResponse;
      if (url.includes("status=closed")) return jsonResponse({ success: true, data: [closedIssue] });
      return jsonResponse({ success: true, data: [] });
    });
    renderModal(null);

    fireEvent.click(screen.getByRole("button", { name: "已关闭 0" }));
    expect(await screen.findByRole("link", { name: "#13 已关闭问题" })).toBeInTheDocument();
    await act(async () => resolveOpen(jsonResponse({ success: true, data: [openIssue] })));

    expect(screen.getByRole("link", { name: "#13 已关闭问题" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "#12 修复上传失败" })).toBeNull();
  });

  it("debounces text search but submits it immediately with Enter", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue]));
    renderModal(null);
    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    const issueCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/issues?"));

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Issue" }), { target: { value: "upload" } });
    expect(issueCalls()).toHaveLength(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(249); });
    expect(issueCalls()).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索 Issue" }), { key: "Enter" });

    await act(async () => { await vi.runOnlyPendingTimersAsync(); });
    expect(issueCalls()).toHaveLength(2);
    expect(String(issueCalls()[1][0])).toContain("q=upload");
  });

  it("clears only the text query from the search field and restores focus", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue]));
    renderModal(null);
    const search = await screen.findByRole("searchbox", { name: "搜索 Issue" });
    expect(search).toHaveClass("[&::-webkit-search-cancel-button]:appearance-none", "[&::-webkit-search-decoration]:appearance-none");
    expect(screen.queryByRole("button", { name: "清除 Issue 搜索" })).toBeNull();

    fireEvent.change(search, { target: { value: "upload" } });
    const clear = screen.getByRole("button", { name: "清除 Issue 搜索" });
    expect(clear).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    fireEvent.click(clear);

    expect(search).toHaveValue("");
    await waitFor(() => expect(search).toHaveFocus());
    await waitFor(() => expect(new URL(window.location.href).searchParams.has("localappIssueQ")).toBe(false));
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/issues" && !url.searchParams.has("q");
    })).toBe(true);
  });

  it("clears a nonempty search with Escape before allowing Escape to close the workspace", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue]));
    const onClose = vi.fn();
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} onClose={onClose} />);
    const search = await screen.findByRole("searchbox", { name: "搜索 Issue" });

    search.focus();
    fireEvent.change(search, { target: { value: "no-matching-keyword" } });
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("");
    await waitFor(() => expect(search).toHaveFocus());
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.keyDown(search, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies GitHub-style search qualifiers to controls, requests, and URL state", async () => {
    const lockedIssue = { ...openIssue, locked_at: "2026-07-10T11:05:00.000Z", locked_by: "alice" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([lockedIssue]));
    renderModal();
    await screen.findByRole("link", { name: "#12 修复上传失败" });

    const search = screen.getByRole("searchbox", { name: "搜索 Issue" });
    fireEvent.change(search, { target: { value: "upload is:closed is:locked type:bug author:@me sort:comments-asc" } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/issues"
        && url.searchParams.get("q") === "upload"
        && url.searchParams.get("status") === "closed"
        && url.searchParams.get("type") === "bug"
        && url.searchParams.get("author") === "alice"
        && url.searchParams.get("locked") === "true"
        && url.searchParams.get("sort") === "comments"
        && url.searchParams.get("direction") === "asc";
    })).toBe(true));

    expect(search).toHaveValue("upload");
    expect(window.location.search).toContain("localappIssueStatus=closed");
    expect(window.location.search).toContain("localappIssueType=bug");
    expect(window.location.search).toContain("localappIssueAuthor=alice");
    expect(window.location.search).toContain("localappIssueLocked=locked");
    expect(window.location.search).toContain("localappIssueSort=comments");
    expect(window.location.search).toContain("localappIssueDirection=asc");
    expect(screen.getByLabelText("对话已锁定")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除对话筛选 已锁定" })).toBeInTheDocument();
  });

  it("combines milestone, mention, and subscription search qualifiers into existing filters", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await screen.findByRole("link", { name: "#12 修复上传失败" });

    const search = screen.getByRole("searchbox", { name: "搜索 Issue" });
    fireEvent.change(search, { target: { value: 'milestone:"v1.0" mentions:@me is:subscribed' } });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/issues"
        && url.searchParams.get("milestone") === "7"
        && url.searchParams.get("mentioned") === "true"
        && url.searchParams.get("subscribed") === "true"
        && url.searchParams.get("offset") === "0";
    })).toBe(true));
    expect(search).toHaveValue("");
    expect(window.location.search).toContain("localappIssueMilestone=7");
    expect(window.location.search).toContain("localappIssueMentioned=1");
    expect(window.location.search).toContain("localappIssueSubscribed=1");
    expect(screen.getByRole("button", { name: "移除里程碑筛选 v1.0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除提及筛选 我" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除关注筛选 我" })).toBeInTheDocument();
  });

  it("offers keyboard-accessible qualifier suggestions without submitting the list", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input).startsWith("/api/issues/labels")
      ? jsonResponse({ success: true, data: [detail.collaboration.labels[0]] })
      : issueListResponse([openIssue]));
    const onClose = vi.fn();
    render(<IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} onClose={onClose} />);
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    const issueCalls = () => fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/issues?"));
    const callsBeforeSuggestion = issueCalls().length;
    const search = screen.getByRole("searchbox", { name: "搜索 Issue" });

    fireEvent.change(search, { target: { value: "la", selectionStart: 2 } });
    expect(screen.getByRole("listbox", { name: "搜索限定词建议" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "标签 筛选带指定标签的 Issue" })).toBeInTheDocument();
    expect(search).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(search).toHaveValue("label:");
    expect(search).toHaveFocus();
    expect(issueCalls()).toHaveLength(callsBeforeSuggestion);
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 300)); });
    expect(issueCalls()).toHaveLength(callsBeforeSuggestion);

    expect(await screen.findByRole("option", { name: "缺陷 bug" })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "搜索限定词建议" })).toBeNull();
    expect(search).toHaveValue("label:");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Issues" })).toBeInTheDocument();
  });

  it("shows applied structured filters and removes only the selected filter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue]));
    renderModal();
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    const search = screen.getByRole("searchbox", { name: "搜索 Issue" });

    fireEvent.change(search, { target: { value: "upload type:bug author:bob involves:carol" } });
    fireEvent.keyDown(search, { key: "Enter" });

    const filters = await screen.findByRole("region", { name: "已应用筛选" });
    expect(within(filters).getByRole("button", { name: "移除类型筛选 缺陷" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "移除作者筛选 bob" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "移除参与者筛选 carol" })).toBeInTheDocument();
    expect(within(filters).getByRole("button", { name: "清除全部筛选" })).toBeInTheDocument();

    fireEvent.click(within(filters).getByRole("button", { name: "移除作者筛选 bob" }));
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveFocus());
    await waitFor(() => expect(window.location.search).not.toContain("localappIssueAuthor"));
    expect(window.location.search).toContain("localappIssueType=bug");
    expect(window.location.search).toContain("localappIssueParticipant=carol");
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/issues" && !url.searchParams.has("author") && url.searchParams.get("participant") === "carol";
    })).toBe(true);
  });

  it("clears non-status filters without changing lifecycle or sort context", async () => {
    window.history.replaceState(null, "", "/owner/research?localappIssues=1&localappIssueStatus=closed&localappIssueLabel=bug&localappIssueAuthor=bob&localappIssueSubscribed=1&localappIssueSort=comments");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([], { total: 0, open: 0, closed: 0 }));
    renderModal();
    const filters = await screen.findByRole("region", { name: "已应用筛选" });

    fireEvent.click(within(filters).getByRole("button", { name: "清除全部筛选" }));

    await waitFor(() => {
      const url = new URL(String(fetchMock.mock.calls.at(-1)?.[0]), "http://localhost");
      expect(url.searchParams.get("status")).toBe("closed");
      expect(url.searchParams.get("sort")).toBe("comments");
      expect(url.searchParams.get("direction")).toBe("desc");
      expect(url.searchParams.get("offset")).toBe("0");
      for (const key of ["q", "label", "author", "participant", "assignee", "subscribed", "mentioned", "locked"]) expect(url.searchParams.has(key)).toBe(false);
    });
    expect(window.location.search).toContain("localappIssueStatus=closed");
    expect(window.location.search).toContain("localappIssueSort=comments");
    expect(screen.getByRole("button", { name: "已关闭 0" })).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveFocus());
  });

  it("supports list shortcuts without stealing editable targets", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue]));
    renderModal();
    const search = await screen.findByRole("searchbox", { name: "搜索 Issue" });
    const title = screen.getByRole("button", { name: "新建 Issue" });
    title.focus();

    fireEvent.keyDown(document, { key: "/" });
    expect(search).toHaveFocus();

    title.focus();
    fireEvent.keyDown(document, { key: "/", metaKey: true });
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("aria-keyshortcuts", "Meta+/ Control+/");

    fireEvent.change(search, { target: { value: "c" } });
    fireEvent.keyDown(search, { key: "/" });
    expect(search).toHaveValue("c");
    expect(search).toHaveFocus();

    title.focus();
    fireEvent.keyDown(document, { key: "c" });
    expect(screen.getByRole("heading", { name: "新建 Issue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回 Issue 列表" })).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowLeft");

    const createTitle = screen.getByRole("textbox", { name: "标题" });
    fireEvent.keyDown(createTitle, { key: "ArrowLeft", altKey: true });
    expect(screen.getByRole("heading", { name: "新建 Issue" })).toBeInTheDocument();

    screen.getByRole("button", { name: "返回 Issue 列表" }).focus();
    fireEvent.keyDown(document, { key: "ArrowLeft", altKey: true });
    expect(await screen.findByRole("link", { name: "#12 修复上传失败" })).toBeInTheDocument();
  });

  it("cycles visible Issue title links with J and K without stealing editable targets", async () => {
    const secondIssue = { ...openIssue, id: 13, issue_number: 13, title: "第二条 Issue" };
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => issueListResponse([openIssue, secondIssue]));
    renderModal();

    const first = await screen.findByRole("link", { name: "#12 修复上传失败" });
    const second = screen.getByRole("link", { name: "#13 第二条 Issue" });
    const create = screen.getByRole("button", { name: "新建 Issue" });
    expect(first).toHaveAttribute("aria-keyshortcuts", "J K ArrowDown ArrowUp O Enter");
    expect(first).toHaveAttribute("data-localapp-issue-link");
    expect(first).toHaveClass("focus-visible:outline-none", "focus-visible:ring-2", "focus-visible:ring-ring");

    create.focus();
    fireEvent.keyDown(document, { key: "j" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "j" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(document, { key: "j" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "k" });
    expect(second).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(second).toHaveFocus();

    create.focus();
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(create).toHaveFocus();

    const search = screen.getByRole("searchbox", { name: "搜索 Issue" });
    search.focus();
    fireEvent.keyDown(search, { key: "j" });
    expect(search).toHaveFocus();
  });

  it("focuses GitHub triage filters and opens the J/K focused Issue with O", async () => {
    mockWorkspaceApi();
    renderModal();

    const issueLink = await screen.findByRole("link", { name: "#12 修复上传失败" });
    const create = screen.getByRole("button", { name: "新建 Issue" });
    const shortcuts = [
      ["u", "按创建者筛选", "U"],
      ["l", "按标签筛选", "L"],
      ["m", "按里程碑筛选", "M"],
      ["a", "按负责人筛选", "A"],
    ] as const;
    for (const [key, label, ariaShortcut] of shortcuts) {
      create.focus();
      fireEvent.keyDown(document, { key });
      const filter = screen.getByRole("combobox", { name: label });
      await waitFor(() => expect(filter).toHaveFocus());
      expect(filter).toHaveAttribute("aria-keyshortcuts", ariaShortcut);
    }
    expect(screen.getByTestId("issue-advanced-filters")).not.toHaveClass("hidden");

    const search = screen.getByRole("searchbox", { name: "搜索 Issue" });
    search.focus();
    fireEvent.keyDown(search, { key: "l" });
    expect(search).toHaveFocus();

    create.focus();
    fireEvent.keyDown(document, { key: "j" });
    expect(issueLink).toHaveFocus();
    expect(issueLink).toHaveAttribute("aria-keyshortcuts", "J K ArrowDown ArrowUp O Enter");
    fireEvent.keyDown(document, { key: "o" });
    expect(await screen.findByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
  });

  it("aborts and suppresses an older response after a new list query", async () => {
    let resolveOpen!: (response: Response) => void;
    const openResponse = new Promise<Response>((resolve) => { resolveOpen = resolve; });
    const closedIssue = { ...openIssue, id: 13, issue_number: 13, title: "已关闭问题", status: "closed" as const };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input).includes("status=open")) return openResponse;
      return issueListResponse([closedIssue], { open: 4, closed: 3, total: 7 });
    });
    renderModal(null);

    fireEvent.click(screen.getByRole("button", { name: /已关闭/ }));
    expect(await screen.findByRole("link", { name: "#13 已关闭问题" })).toBeInTheDocument();
    const openListRequest = fetchMock.mock.calls.find(([url]) => String(url).includes("status=open"));
    expect((openListRequest?.[1] as RequestInit).signal?.aborted).toBe(true);
    await act(async () => resolveOpen(issueListResponse([openIssue])));
    expect(screen.queryByRole("button", { name: "#12 修复上传失败" })).toBeNull();
  });

  it("shows server counters, pagination, and a reset that preserves empty filters until requested", async () => {
    const secondIssue = { ...openIssue, id: 13, issue_number: 13, title: "第二页 Issue" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const query = new URL(String(input), "http://localhost").searchParams;
      if (query.get("q") === "missing") return issueListResponse([], { total: 0, open: 3, closed: 2 });
      if (query.get("offset") === "25") return issueListResponse([secondIssue], { total: 26, open: 24, closed: 2, offset: 25 });
      return issueListResponse([openIssue], { total: 26, open: 24, closed: 2 });
    });
    renderModal(null);

    expect(await screen.findByRole("button", { name: "开启 24" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "已关闭 2" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(await screen.findByRole("link", { name: "#13 第二页 Issue" })).toBeInTheDocument();
    expect(screen.getByLabelText("当前显示第 26 至 26 条，共 26 条 Issue")).toHaveTextContent("26-26 / 26");

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Issue" }), { target: { value: "missing" } });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索 Issue" }), { key: "Enter" });
    expect(await screen.findByText("当前筛选没有匹配的 Issue")).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveValue("missing");
    fireEvent.click(screen.getByRole("button", { name: "重置筛选" }));
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).not.toContain("q=missing"));
  });

  it("recovers from an out-of-range page without clearing the current query", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const query = new URL(String(input), "http://localhost").searchParams;
      if (query.get("offset") === "25") return issueListResponse([], { total: 25, open: 25, closed: 0, offset: 25 });
      return issueListResponse([openIssue], { total: 26, open: 26, closed: 0 });
    });
    renderModal(null);
    await screen.findByRole("link", { name: "#12 修复上传失败" });
    fireEvent.change(screen.getByRole("combobox", { name: "排序 Issue" }), { target: { value: "created:asc" } });
    await waitFor(() => expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("sort=created&direction=asc"));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("当前页已无 Issue")).toBeInTheDocument();
    expect(screen.getByText("0 / 25")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "返回第一页" }));
    await waitFor(() => {
      const request = String(fetchMock.mock.calls.at(-1)?.[0]);
      expect(request).toContain("sort=created&direction=asc");
      expect(request).toContain("offset=0");
    });
  });

  it("keeps the loaded list structure during a refresh and retries the same failed query", async () => {
    let rejectSearch!: (error: Error) => void;
    let resolveRetry!: (response: Response) => void;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (!url.includes("q=upload")) return issueListResponse([openIssue]);
      if (!rejectSearch) return new Promise<Response>((_resolve, reject) => { rejectSearch = reject; });
      return new Promise<Response>((resolve) => { resolveRetry = resolve; });
    });
    renderModal(null);
    await screen.findByRole("link", { name: "#12 修复上传失败" });

    fireEvent.change(screen.getByRole("searchbox", { name: "搜索 Issue" }), { target: { value: "upload" } });
    fireEvent.keyDown(screen.getByRole("searchbox", { name: "搜索 Issue" }), { key: "Enter" });
    expect(screen.getByRole("list", { name: "开启的 Issues" })).toHaveAttribute("data-stale", "true");
    expect(screen.getByRole("list", { name: "开启的 Issues" })).not.toHaveClass("opacity-60");
    expect(screen.getByRole("list", { name: "开启的 Issues" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("正在更新结果").closest('[role="status"]')).toHaveTextContent("正在更新结果");
    await act(async () => rejectSearch(new Error("network down")));
    expect(await screen.findByRole("alert")).toHaveTextContent("显示上次结果：network down");
    expect(await screen.findByRole("button", { name: "重试" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain("q=upload");
    await act(async () => resolveRetry(issueListResponse([openIssue])));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByRole("list", { name: "开启的 Issues" })).toHaveAttribute("aria-busy", "false");
    await waitFor(() => expect(screen.getByRole("searchbox", { name: "搜索 Issue" })).toHaveFocus());
  });

  it("shows a dedicated first-load error instead of a successful empty state", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse());
    renderModal(null);

    expect(await screen.findByRole("alert")).toHaveTextContent("无法加载 Issues");
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    expect(screen.queryByText(/此应用还没有/)).toBeNull();
    expect(screen.queryByText("当前筛选没有匹配的 Issue")).toBeNull();
  });

  it("shows built-in labels when the catalog fails and retries in place", async () => {
    const custom = { id: "urgent", name: "紧急", color: "b60205", description: "立即处理", built_in: 0, created_at: "", updated_at: "" };
    const customDetail = { ...detail, collaboration: { ...detail.collaboration, labels: [detail.collaboration.labels[0], custom] } };
    let labelAttempts = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") {
        labelAttempts += 1;
        return labelAttempts <= 2 ? htmlResponse() : jsonResponse({ success: true, data: [detail.collaboration.labels[0], custom] });
      }
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: customDetail });
      if (url === "/api/issues/12/labels" && init?.method === "PUT") return jsonResponse({ success: true, data: { ...customDetail, collaboration: { ...customDetail.collaboration, labels: [detail.collaboration.labels[0]] } } });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    expect(await screen.findByRole("alert")).toHaveTextContent("标签目录暂不可用");
    expect(screen.getByRole("button", { name: "重试标签目录" })).toHaveClass("h-11", "shrink-0", "sm:h-7");
    expect(screen.getByRole("combobox", { name: "按标签筛选" })).not.toHaveTextContent("缺陷");
    await openDetail();
    const metadata = within(screen.getByTestId("issue-metadata-desktop"));
    fireEvent.click(metadata.getByRole("button", { name: "编辑标签" }));
    const customLabel = metadata.getByRole("checkbox", { name: "紧急" });
    expect(customLabel).toBeChecked();
    fireEvent.click(customLabel);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/labels", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === "/api/issues/12/labels")?.[1]?.body))).toEqual({ pagePath: "owner/research", labelIds: ["bug"] });
    fireEvent.click(screen.getByRole("button", { name: "重试标签目录" }));

    await waitFor(() => expect(screen.queryByText("标签目录暂不可用")).toBeNull());
    await waitFor(() => expect(screen.getByRole("heading", { name: "修复上传失败" })).toHaveFocus());
    expect(screen.queryByText("标签目录暂不可用")).toBeNull();
    expect(labelAttempts).toBe(3);
  });

  it("keeps known users when the assignee catalog fails and retries in place", async () => {
    let userAttempts = 0;
    const assignedDetail = { ...detail, collaboration: { ...detail.collaboration, assignee_ids: ["legacy-user"] } };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/users") {
        userAttempts += 1;
        return userAttempts <= 2 ? htmlResponse() : jsonResponse({ success: true, data: [{ id: "bob", name: "bob", displayName: "Bob", avatarUrl: null }] });
      }
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail.collaboration.labels });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: assignedDetail });
      if (url === "/api/issues/12/assignees" && init?.method === "PUT") return jsonResponse({ success: true, data: { ...assignedDetail, collaboration: { ...assignedDetail.collaboration, assignee_ids: [] } } });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    expect(await screen.findByRole("alert")).toHaveTextContent("负责人目录加载失败，正在显示已知用户");
    await openDetail();
    const metadata = within(screen.getByTestId("issue-metadata-desktop"));
    fireEvent.click(metadata.getByRole("button", { name: "编辑负责人" }));
    const legacyAssignee = metadata.getByRole("checkbox", { name: "legacy-user" });
    expect(legacyAssignee).toBeChecked();
    expect(metadata.getByRole("checkbox", { name: "Owner" })).toBeInTheDocument();
    fireEvent.click(legacyAssignee);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/assignees", expect.objectContaining({ method: "PUT" })));
    expect(JSON.parse(String(fetchMock.mock.calls.find(([url]) => url === "/api/issues/12/assignees")?.[1]?.body))).toEqual({ pagePath: "owner/research", userIds: [] });
    fireEvent.click(screen.getByRole("button", { name: "重试负责人目录" }));

    await waitFor(() => expect(screen.queryByText("负责人目录加载失败，正在显示已知用户")).toBeNull());
    expect(await metadata.findByRole("checkbox", { name: "Bob" })).toBeInTheDocument();
    expect(userAttempts).toBe(3);
  });

  it("shows milestone catalog failures and retries into the current create workspace", async () => {
    let milestoneAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") {
        milestoneAttempts += 1;
        return milestoneAttempts <= 2 ? htmlResponse() : jsonResponse({ success: true, data: [{ id: 7, title: "v1.0", description: "Release", due_on: null, state: "open", created_by: "owner", created_at: "", updated_at: "", open_issues: 0, closed_issues: 0 }] });
      }
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail.collaboration.labels });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    expect(await screen.findByRole("alert")).toHaveTextContent("里程碑目录加载失败，正在显示已知里程碑");
    const retry = screen.getByRole("button", { name: "重试里程碑目录" });
    fireEvent.click(screen.getByRole("button", { name: "新建 Issue" }));
    expect(screen.getByRole("combobox", { name: "里程碑" })).not.toHaveTextContent("v1.0");
    fireEvent.click(retry);

    await waitFor(() => expect(screen.queryByText("里程碑目录加载失败，正在显示已知里程碑")).toBeNull());
    expect(screen.getByRole("combobox", { name: "里程碑" })).toHaveTextContent("v1.0");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "标题" })).toHaveFocus());
    expect(milestoneAttempts).toBe(3);
  });

  it("recovers a transient milestone catalog failure without showing a warning", async () => {
    let milestoneAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/milestones?pagePath=owner%2Fresearch") {
        milestoneAttempts += 1;
        return milestoneAttempts === 1 ? htmlResponse() : jsonResponse({ success: true, data: [{ id: 7, title: "v1.0", description: "Release", due_on: null, state: "open", created_by: "owner", created_at: "", updated_at: "", open_issues: 0, closed_issues: 0 }] });
      }
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail.collaboration.labels });
      if (url === "/api/users") return jsonResponse({ success: true, data: [] });
      return issueListResponse([openIssue]);
    });
    renderModal({ id: "owner", name: "Owner" });

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    await waitFor(() => expect(screen.getByRole("combobox", { name: "里程碑" })).toHaveTextContent("v1.0"));
    expect(screen.queryByText("里程碑目录加载失败，正在显示已知里程碑")).toBeNull();
    expect(milestoneAttempts).toBe(2);
  });

  it("does not request the authenticated user directory for anonymous readers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/users") return htmlResponse();
      if (url === "/api/issues/labels?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail.collaboration.labels });
      return issueListResponse([openIssue]);
    });

    renderModal(null);
    expect(await screen.findByRole("link", { name: "#12 修复上传失败" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/users")).toBe(false);
    expect(screen.queryByText("负责人目录加载失败，正在显示已知用户")).toBeNull();
    expect(screen.queryByRole("button", { name: "分配给我的" })).toBeNull();
    expect(screen.queryByRole("button", { name: "我创建的" })).toBeNull();
    expect(screen.queryByRole("button", { name: "我参与的" })).toBeNull();
  });

  it("renders a stable detail skeleton until the detail request resolves", async () => {
    let resolveDetail!: (response: Response) => void;
    const deferredDetail = new Promise<Response>((resolve) => { resolveDetail = resolve; });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? deferredDetail : issueListResponse([openIssue]));
    renderModal(null);
    fireEvent.click(await screen.findByRole("link", { name: "#12 修复上传失败" }));

    expect(screen.getByRole("status", { name: "正在加载 Issue 详情" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "返回 Issue 列表" })).toBeInTheDocument();
    await act(async () => resolveDetail(jsonResponse({ success: true, data: detail })));
    expect(await screen.findByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "正在加载 Issue 详情" })).toBeNull();
  });

  it("previews Markdown before submitting a comment", async () => {
    mockWorkspaceApi();
    renderModal();
    await openDetail();

    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "# 新日志\n\n- 第一项" } });
    fireEvent.click(screen.getByRole("tab", { name: "预览" }));

    expect(screen.getByRole("heading", { name: "新日志" })).toBeInTheDocument();
    expect(screen.getByText("第一项")).toBeInTheDocument();
  });

  it("provides a selection-safe Markdown toolbar, shortcuts, and preview round trip", async () => {
    mockWorkspaceApi();
    renderModal();
    await openDetail();

    const editor = screen.getByLabelText("评论内容") as HTMLTextAreaElement;
    const editorRoot = editor.closest("[data-localapp-issue-editor]");
    expect(editorRoot).not.toBeNull();
    const markdownToolbar = editorRoot?.querySelector("[data-localapp-issue-toolbar]");
    expect(markdownToolbar).not.toBeNull();
    expect(markdownToolbar).toHaveClass("flex-wrap", "overflow-x-hidden", "sm:flex-nowrap", "sm:overflow-x-auto");
    const modeTabs = screen.getByRole("tablist", { name: "Markdown 模式" });
    const editTab = within(modeTabs).getByRole("tab", { name: "编辑" });
    const previewTab = within(modeTabs).getByRole("tab", { name: "预览" });
    expect(editTab).toHaveAttribute("aria-selected", "true");
    expect(editTab).toHaveAttribute("aria-controls");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", editTab.id);
    expect(screen.getByLabelText("附件队列状态")).toHaveAttribute("aria-live", "polite");
    for (const label of ["标题格式", "粗体", "斜体", "引用", "行内代码", "链接", "无序列表", "有序列表", "任务列表"]) {
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("title");
      expect(screen.getByRole("button", { name: label })).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    }

    fireEvent.change(editor, { target: { value: "选择文本" } });
    editor.focus();
    editor.setSelectionRange(0, 2);
    fireEvent.mouseDown(screen.getByRole("button", { name: "粗体" }));
    fireEvent.click(screen.getByRole("button", { name: "粗体" }));
    await waitFor(() => expect(editor).toHaveValue("**选择**文本"));
    await waitFor(() => expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 4]));

    fireEvent.change(editor, { target: { value: "LocalApp" } });
    editor.setSelectionRange(0, 8);
    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });
    fireEvent.keyUp(editor, { key: "k", ctrlKey: true });
    await waitFor(() => expect(editor).toHaveValue("[LocalApp](url)"));
    await waitFor(() => expect([editor.selectionStart, editor.selectionEnd]).toEqual([11, 14]));

    fireEvent.click(screen.getByRole("tab", { name: "预览" }));
    expect(screen.getByText("LocalApp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "编辑" }));
    const restored = screen.getByLabelText("评论内容") as HTMLTextAreaElement;
    await waitFor(() => expect(restored).toHaveFocus());
    expect(restored).toHaveValue("[LocalApp](url)");
    await waitFor(() => expect([restored.selectionStart, restored.selectionEnd]).toEqual([11, 14]));

    fireEvent.keyDown(editTab, { key: "ArrowRight" });
    expect(previewTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(previewTab).toHaveFocus());
    fireEvent.keyDown(previewTab, { key: "ArrowLeft" });
    expect(editTab).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(editTab).toHaveFocus());
  });

  it("posts a comment and can close or reopen it with the comment", async () => {
    const onIssuesChanged = vi.fn();
    const fetchMock = mockWorkspaceApi();
    render(
      <IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} onIssuesChanged={onIssuesChanged} onClose={vi.fn()} />,
    );
    await openDetail();
    fireEvent.change(screen.getByRole("combobox", { name: "关闭原因" }), { target: { value: "not_planned" } });
    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "已补充日志" } });
    fireEvent.click(screen.getByRole("button", { name: "评论并关闭" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/12/comments",
      expect.objectContaining({ method: "POST" }),
    ));
    const [, closeRequest] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST" && String(init.body).includes("closed"))!;
    expect(JSON.parse(String(closeRequest?.body))).toMatchObject({ body: "已补充日志", statusAction: "closed", stateReason: "not_planned" });
    expect(onIssuesChanged).toHaveBeenCalledOnce();
  });

  it("uses the IssueDetail returned by comment POST without fetching detail again", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal();
    await openDetail();

    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "已补充日志" } });
    fireEvent.click(screen.getByRole("button", { name: "评论" }));

    expect(await screen.findByText("已补充日志")).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch")).toHaveLength(1);
  });

  it("uses card-scoped action menus with keyboard and outside-click focus restoration", async () => {
    mockWorkspaceApi();
    renderModal();
    await openDetail();

    const workspaceHeading = screen.getByRole("heading", { level: 2, name: "Issue #12 · 修复上传失败" });
    expect(workspaceHeading).toHaveAttribute("title", "Issue #12 · 修复上传失败");
    expect(workspaceHeading).toHaveClass("truncate", "min-w-0");

    expect(screen.queryByRole("button", { name: "编辑 Issue" })).toBeNull();
    const issueActions = within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" });
    expect(issueActions).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    issueActions.focus();
    fireEvent.keyDown(issueActions, { key: "ArrowDown" });
    expect(screen.getByRole("menu", { name: "Issue 操作" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "编辑 Issue" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("menu", { name: "Issue 操作" }), { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "Issue 操作" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Issue #12 · 修复上传失败" })).toBeInTheDocument();
    await waitFor(() => expect(issueActions).toHaveFocus());

    const commentActions = within(screen.getByTestId("issue-comment-6")).getByRole("button", { name: "评论操作" });
    expect(commentActions).toHaveClass("h-11", "w-11", "sm:h-8", "sm:w-8");
    fireEvent.click(commentActions);
    const copyComment = screen.getByRole("menuitem", { name: "复制评论链接" });
    const referenceComment = screen.getByRole("menuitem", { name: "引用到新 Issue" });
    const quoteComment = screen.getByRole("menuitem", { name: "引用回复" });
    const editComment = screen.getByRole("menuitem", { name: "编辑评论" });
    const deleteComment = screen.getByRole("menuitem", { name: "删除评论" });
    await waitFor(() => expect(copyComment).toHaveFocus());
    expect(deleteComment).toHaveClass("text-destructive");
    fireEvent.keyDown(copyComment, { key: "ArrowDown" });
    expect(referenceComment).toHaveFocus();
    fireEvent.keyDown(referenceComment, { key: "ArrowDown" });
    expect(quoteComment).toHaveFocus();
    fireEvent.keyDown(quoteComment, { key: "ArrowDown" });
    expect(editComment).toHaveFocus();
    fireEvent.keyDown(editComment, { key: "ArrowDown" });
    expect(deleteComment).toHaveFocus();
    fireEvent.keyDown(deleteComment, { key: "ArrowDown" });
    expect(copyComment).toHaveFocus();
    fireEvent.keyDown(copyComment, { key: "ArrowUp" });
    expect(deleteComment).toHaveFocus();
    fireEvent.keyDown(deleteComment, { key: "Home" });
    expect(copyComment).toHaveFocus();
    fireEvent.keyDown(copyComment, { key: "End" });
    expect(deleteComment).toHaveFocus();
    fireEvent.keyDown(deleteComment, { key: "编" });
    expect(editComment).toHaveFocus();
    fireEvent.keyDown(editComment, { key: "删" });
    expect(deleteComment).toHaveFocus();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu", { name: "评论操作" })).toBeNull();
    await waitFor(() => expect(commentActions).toHaveFocus());

    vi.restoreAllMocks();
    cleanup();
    mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    expect(screen.getByRole("button", { name: "Issue 操作" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "评论操作" }));
    expect(screen.getByRole("menuitem", { name: "引用回复" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "编辑评论" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "删除评论" })).toBeNull();
  });

  it("skips disabled action-menu items for trigger and cyclic keyboard navigation", async () => {
    render(<IssueActionMenu label="测试操作" items={[{ label: "不可用", disabled: true, onSelect: vi.fn() }, { label: "可用操作", onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "测试操作" });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    await waitFor(() => expect(screen.getByRole("menuitem", { name: "可用操作" })).toHaveFocus());
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "可用操作" }), { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "可用操作" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "可用操作" }), { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "可用操作" })).toHaveFocus();
  });

  it("appends a Markdown quote reply without replacing the current comment draft", async () => {
    mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();

    const composer = screen.getByLabelText("评论内容");
    fireEvent.change(composer, { target: { value: "我的补充" } });
    fireEvent.click(screen.getByRole("tab", { name: "预览" }));
    fireEvent.click(within(screen.getByTestId("issue-comment-6")).getByRole("button", { name: "评论操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "引用回复" }));

    expect(screen.getByRole("tab", { name: "编辑", selected: true })).toBeInTheDocument();
    const updatedComposer = screen.getByLabelText("评论内容");
    expect(updatedComposer).toHaveValue("我的补充\n\n> 复现步骤：\n> \n> - 打开页面\n> - **上传** 图片\n\n@alice ");
    await waitFor(() => expect(updatedComposer).toHaveFocus());

    vi.restoreAllMocks();
    cleanup();
    mockWorkspaceApi();
    renderModal(null);
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "评论操作" }));
    expect(screen.getByRole("menuitem", { name: "复制评论链接" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "引用回复" })).toBeNull();
  });

  it("opens an isolated Issue draft from a comment and returns to its action menu", async () => {
    mockWorkspaceApi();
    window.sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:owner:create", JSON.stringify({ title: "普通草稿", label: "feature" }));
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();

    const actions = within(screen.getByTestId("issue-comment-6")).getByRole("button", { name: "评论操作" });
    fireEvent.click(actions);
    fireEvent.click(screen.getByRole("menuitem", { name: "引用到新 Issue" }));

    expect(screen.getByText("引用自 #12 评论")).toBeInTheDocument();
    expect(screen.getByLabelText("标题")).toHaveValue("");
    expect(screen.getByLabelText<HTMLTextAreaElement>("描述").value).toContain("来源：#12");
    expect(screen.getByLabelText<HTMLTextAreaElement>("描述").value).toContain("localappIssueCommentId=6");
    expect(JSON.parse(window.sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:owner:create")!)).toMatchObject({ title: "普通草稿", label: "feature" });

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(await screen.findByTestId("issue-comment-6")).toBeInTheDocument();
    await waitFor(() => expect(within(screen.getByTestId("issue-comment-6")).getByRole("button", { name: "评论操作" })).toHaveFocus());
  });

  it("quotes the Issue body into the existing comment draft", async () => {
    mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();

    const composer = screen.getByLabelText("评论内容");
    fireEvent.change(composer, { target: { value: "我的补充" } });
    fireEvent.click(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "引用回复" }));

    expect(composer).toHaveValue(`我的补充\n\n> ${detail.issue.description}\n\n@alice `);
    await waitFor(() => expect(composer).toHaveFocus());

    vi.restoreAllMocks();
    cleanup();
    mockWorkspaceApi();
    renderModal(null);
    await openDetail();
    expect(within(screen.getByTestId("issue-body-card")).queryByRole("button", { name: "Issue 操作" })).toBeNull();
  });

  it("lets only the comment author edit or delete a comment", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal();
    await openDetail();

    selectCommentAction("编辑评论");
    await waitFor(() => expect(screen.getByLabelText("编辑评论内容")).toHaveFocus());
    const commentEditor = within(screen.getByTestId("issue-comment-6"));
    expect(commentEditor.getByRole("tab", { name: "编辑", selected: true })).toBeInTheDocument();
    expect(commentEditor.getByRole("tab", { name: "预览" })).toBeInTheDocument();
    expect(commentEditor.getByRole("toolbar", { name: "Markdown 工具栏" })).toBeInTheDocument();
    expect(commentEditor.getByRole("button", { name: "添加附件" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("编辑评论内容"), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "保存评论" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("编辑评论内容"), { target: { value: "更新后的复现步骤" } });
    fireEvent.click(screen.getByRole("button", { name: "保存评论" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/12/comments/6",
      expect.objectContaining({ method: "PATCH" }),
    ));
    const [, commentEditRequest] = fetchMock.mock.calls.find(([url, init]) => url === "/api/issues/12/comments/6" && init?.method === "PATCH")!;
    expect(JSON.parse(String(commentEditRequest?.body))).toMatchObject({
      body: "更新后的复现步骤",
      expectedUpdatedAt: "2026-07-10T10:00:00.000Z",
    });
    await waitFor(() => expect(screen.getByTestId("issue-comment-6")).toHaveFocus());

    selectCommentAction("删除评论");
    window.history.replaceState(window.history.state, "", "/?localappIssues=1&localappIssueId=12&localappIssueCommentId=6");
    expect(screen.getByRole("alertdialog", { name: "删除评论确认" })).toBeInTheDocument();
    const cancelDelete = screen.getByRole("button", { name: "取消删除" });
    const confirmDelete = screen.getByRole("button", { name: "确认删除评论" });
    expect(screen.getByRole("button", { name: "取消删除" })).toHaveClass("h-11", "sm:h-8");
    expect(confirmDelete).toHaveClass("h-11", "sm:h-8");
    await waitFor(() => expect(cancelDelete).toHaveFocus());
    fireEvent.keyDown(cancelDelete, { key: "Tab", shiftKey: true });
    expect(confirmDelete).toHaveFocus();
    fireEvent.keyDown(confirmDelete, { key: "Tab" });
    expect(cancelDelete).toHaveFocus();
    expect(screen.getByRole("alertdialog", { name: "删除评论确认" })).toHaveAccessibleDescription("删除后评论内容将不再显示。");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/issues/12/comments/6?pagePath=owner%2Fresearch",
      expect.objectContaining({ method: "DELETE" }),
    );
    fireEvent.keyDown(screen.getByRole("alertdialog", { name: "删除评论确认" }), { key: "Escape" });
    expect(screen.queryByRole("alertdialog", { name: "删除评论确认" })).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "评论操作" })).toHaveFocus());
    expect(screen.getByRole("dialog", { name: "Issue #12 · 修复上传失败" })).toBeInTheDocument();
    selectCommentAction("删除评论");
    fireEvent.click(screen.getByRole("button", { name: "确认删除评论" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/12/comments/6?pagePath=owner%2Fresearch",
      expect.objectContaining({ method: "DELETE" }),
    ));
    await waitFor(() => expect(screen.getByTestId("issue-comment-6")).toHaveFocus());
    expect(screen.getByText("评论已删除")).toHaveClass("sr-only");
    expect(new URL(window.location.href).searchParams.get("localappIssueCommentId")).toBeNull();

    vi.restoreAllMocks();
    cleanup();
    mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();
    fireEvent.click(screen.getByRole("button", { name: "评论操作" }));
    expect(screen.getByRole("menuitem", { name: "引用回复" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "编辑评论" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "删除评论" })).toBeNull();
  });

  it("keeps an edit-comment failure beside its preserved draft without a duplicate workspace alert", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/12/comments/6" && init?.method === "PATCH") return jsonResponse({ success: false, error: "评论版本已过期" }, 409);
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();
    selectCommentAction("编辑评论");
    const editor = screen.getByLabelText("编辑评论内容");
    fireEvent.change(editor, { target: { value: "需要保留的评论修改" } });
    fireEvent.click(screen.getByRole("button", { name: "保存评论" }));

    const comment = screen.getByTestId("issue-comment-6");
    expect(await within(comment).findByRole("alert")).toHaveTextContent("评论版本已过期");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(editor).toHaveValue("需要保留的评论修改");

    fireEvent.change(editor, { target: { value: "修改后重试" } });
    expect(within(comment).queryByRole("alert")).toBeNull();
  });

  it("refreshes a conflicting comment version without overwriting the local edit draft", async () => {
    let detailReads = 0;
    const remoteDetail = {
      ...detail,
      timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, body: "远端评论内容", updated_at: "2026-07-10T12:00:00.000Z" } } : item),
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") {
        detailReads += 1;
        return jsonResponse({ success: true, data: detailReads === 1 ? detail : remoteDetail });
      }
      if (url === "/api/issues/12/comments/6" && init?.method === "PATCH") return jsonResponse({ success: false, code: "issue_content_conflict", error: "stale" }, 409);
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();
    selectCommentAction("编辑评论");
    const editor = screen.getByLabelText("编辑评论内容");
    fireEvent.change(editor, { target: { value: "我的评论草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "保存评论" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("内容已被其他用户更新，当前草稿已保留");
    expect(editor).toHaveValue("我的评论草稿");
    expect(await screen.findByText("此评论有新变更，当前草稿尚未被覆盖。")).toBeInTheDocument();
    expect(detailReads).toBe(2);
    expect(screen.getByRole("button", { name: "加载最新内容" })).toHaveClass("h-11", "shrink-0", "sm:h-8");
    fireEvent.click(screen.getByRole("button", { name: "加载最新内容" }));

    expect(screen.queryByLabelText("编辑评论内容")).toBeNull();
    expect(screen.getByText("远端评论内容")).toBeInTheDocument();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body")).toBeNull();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:version")).toBeNull();
  });

  it("restores an interrupted comment edit with its original concurrency version", async () => {
    const fetchMock = mockWorkspaceApi();
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body", "恢复的评论编辑");
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:version", "2026-07-09T09:00:00.000Z");
    renderModal();
    await openDetail();

    selectCommentAction("编辑评论");
    expect(screen.getByLabelText("编辑评论内容")).toHaveValue("恢复的评论编辑");
    const restoredCommentStatus = screen.getAllByRole("status").find((status) => status.textContent?.includes("已恢复上次未完成的编辑"));
    expect(restoredCommentStatus).toHaveTextContent("已恢复上次未完成的编辑");
    expect(restoredCommentStatus).toHaveClass("flex-wrap");
    fireEvent.click(screen.getByRole("button", { name: "保存评论" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments/6", expect.objectContaining({ method: "PATCH" })));
    const [, request] = fetchMock.mock.calls.find(([url, init]) => url === "/api/issues/12/comments/6" && init?.method === "PATCH")!;
    expect(JSON.parse(String(request?.body))).toMatchObject({ body: "恢复的评论编辑", expectedUpdatedAt: "2026-07-09T09:00:00.000Z" });
    await waitFor(() => expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body")).toBeNull());
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:version")).toBeNull();
  });

  it("discards only the restored comment draft without mutating the server", async () => {
    const fetchMock = mockWorkspaceApi();
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body", "待丢弃评论编辑");
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:version", "2026-07-09T09:00:00.000Z");
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body:attachments", JSON.stringify({ draftId: "comment-draft", attachments: [{ id: "comment-upload", url: "/api/issues/attachments/comment-upload?pagePath=owner%2Fresearch", issue_id: null, comment_id: null, draft_id: "comment-draft", uploader_id: "alice", file_name: "comment.png", mime_type: "image/png", size_bytes: 10, created_at: "2026-07-10T11:00:00.000Z" }] }));
    renderModal();
    await openDetail();

    selectCommentAction("编辑评论");
    fireEvent.click(screen.getByRole("button", { name: "丢弃已恢复草稿" }));

    expect(screen.getByRole("alertdialog", { name: "丢弃草稿确认" })).toBeInTheDocument();
    expect(screen.getByLabelText("编辑评论内容")).toHaveValue("待丢弃评论编辑");
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body")).toBe("待丢弃评论编辑");
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃" }));

    expect(screen.queryByLabelText("编辑评论内容")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("issue-comment-6")).toHaveFocus());
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body")).toBeNull();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:version")).toBeNull();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit-comment:6:body:attachments")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/attachments/comment-upload?pagePath=owner%2Fresearch&draftId=comment-draft", expect.objectContaining({ method: "DELETE" })));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("keeps destructive comment confirmation available after a delete failure", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url.includes("/comments/6") && init?.method === "DELETE") return htmlResponse();
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    selectCommentAction("删除评论");
    fireEvent.click(screen.getByRole("button", { name: "确认删除评论" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Issue 服务暂不可用");
    expect(screen.getByRole("alertdialog", { name: "删除评论确认" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认删除评论" })).toBeEnabled();
  });

  it("lets the reporter edit title and body without exposing or submitting label", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal();
    await openDetail();

    const closeReason = screen.getByRole("combobox", { name: "关闭原因" });
    expect(screen.getByRole("group", { name: "关闭 Issue" })).toHaveClass("grid", "w-full", "grid-cols-2", "sm:w-fit");
    expect(closeReason).toHaveValue("completed");
    expect(closeReason.closest("label")).toHaveClass("focus-within:ring-2", "focus-within:ring-ring");
    expect(screen.getByRole("button", { name: "关闭 Issue" })).toHaveClass("h-11", "sm:h-8");
    selectIssueAction("编辑 Issue");
    expect(screen.getByLabelText("Issue 描述")).toHaveAttribute("placeholder", "更新 Issue 描述");
    expect(screen.getByRole("tab", { name: "编辑", selected: true })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "预览" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "Markdown 工具栏" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加附件" })).toBeInTheDocument();
    expect(screen.getByLabelText("Issue 标题")).toHaveClass("h-11", "sm:h-10");
    expect(screen.queryByRole("button", { name: "功能" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Issue 标题"), { target: { value: "修复图像上传" } });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.getByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Issue 标题")).toBeNull();
    await waitFor(() => expect(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" })).toHaveFocus());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);

    selectIssueAction("编辑 Issue");
    fireEvent.change(screen.getByLabelText("Issue 标题"), { target: { value: "修复图像上传" } });
    fireEvent.change(screen.getByLabelText("Issue 描述"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Issue" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/12",
      expect.objectContaining({ method: "PATCH" }),
    ));
    await waitFor(() => expect(within(screen.getByTestId("issue-body-card")).getByRole("button", { name: "Issue 操作" })).toHaveFocus());
    const [, request] = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    const body = JSON.parse(String(request?.body));
    expect(body).toMatchObject({ title: "修复图像上传", description: "", expectedUpdatedAt: detail.issue.updated_at });
    expect(body).not.toHaveProperty("label");
    await waitFor(() => expect(screen.queryByLabelText("Issue 标题")).toBeNull());
  });

  it("restores an interrupted Issue edit without refreshing its concurrency version", async () => {
    const fetchMock = mockWorkspaceApi();
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:meta", JSON.stringify({ title: "恢复的 Issue 标题", label: "feature", expectedUpdatedAt: "2026-07-09T08:00:00.000Z" }));
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:body", "恢复的 Issue 正文");
    renderModal();
    await openDetail();

    selectIssueAction("编辑 Issue");
    expect(screen.getByLabelText("Issue 标题")).toHaveValue("恢复的 Issue 标题");
    expect(screen.getByLabelText("Issue 描述")).toHaveValue("恢复的 Issue 正文");
    const restoredStatus = screen.getAllByRole("status").find((status) => status.textContent?.includes("已恢复上次未完成的编辑"));
    expect(restoredStatus).toHaveClass("flex-wrap");
    expect(screen.getByRole("button", { name: "放弃草稿并加载最新" })).toHaveClass("h-11", "shrink-0", "sm:h-8");
    fireEvent.click(screen.getByRole("button", { name: "保存 Issue" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12", expect.objectContaining({ method: "PATCH" })));
    const [, request] = fetchMock.mock.calls.find(([url, init]) => url === "/api/issues/12" && init?.method === "PATCH")!;
    expect(JSON.parse(String(request?.body))).toMatchObject({ title: "恢复的 Issue 标题", description: "恢复的 Issue 正文", expectedUpdatedAt: "2026-07-09T08:00:00.000Z" });
    await waitFor(() => expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:meta")).toBeNull());
  });

  it("discards a restored Issue draft and returns to the server version", async () => {
    const fetchMock = mockWorkspaceApi();
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:meta", JSON.stringify({ title: "待丢弃标题", label: "feature", expectedUpdatedAt: detail.issue.updated_at }));
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:body", "待丢弃正文");
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:body:attachments", JSON.stringify({ draftId: "issue-draft", attachments: [{ id: "issue-upload", url: "/api/issues/attachments/issue-upload?pagePath=owner%2Fresearch", issue_id: null, comment_id: null, draft_id: "issue-draft", uploader_id: "alice", file_name: "issue.png", mime_type: "image/png", size_bytes: 10, created_at: "2026-07-10T11:00:00.000Z" }] }));
    renderModal();
    await openDetail();

    selectIssueAction("编辑 Issue");
    fireEvent.click(screen.getByRole("button", { name: "丢弃已恢复草稿" }));

    expect(screen.getByRole("alertdialog", { name: "丢弃草稿确认" })).toBeInTheDocument();
    expect(screen.getByLabelText("Issue 标题")).toHaveValue("待丢弃标题");
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:meta")).not.toBeNull();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "确认丢弃" }));

    expect(screen.getByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "修复上传失败" })).toHaveFocus());
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:meta")).toBeNull();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:body")).toBeNull();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:body:attachments")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/attachments/issue-upload?pagePath=owner%2Fresearch&draftId=issue-draft", expect.objectContaining({ method: "DELETE" })));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("lets the app owner edit and submit the Issue type", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal({ id: "owner", name: "Owner" });
    await openDetail();

    expect(screen.getByRole("button", { name: "关闭 Issue" })).toBeInTheDocument();
    selectIssueAction("编辑 Issue");
    expect(screen.getByRole("button", { name: "功能" })).toHaveClass("h-11", "sm:h-8");
    fireEvent.click(screen.getByRole("button", { name: "功能" }));
    fireEvent.click(screen.getByRole("button", { name: "保存 Issue" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/issues/12",
      expect.objectContaining({ method: "PATCH" }),
    ));
    const [, request] = fetchMock.mock.calls.find(([, init]) => init?.method === "PATCH")!;
    expect(JSON.parse(String(request?.body))).toMatchObject({ issueType: "feature" });
  });

  it("rejects a stale Issue edit while preserving the local draft", async () => {
    let detailReads = 0;
    const remoteIssueDetail = { ...detail, issue: { ...detail.issue, title: "远端 Issue 标题", description: "远端 Issue 正文", updated_at: "2026-07-10T12:00:00.000Z" } };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") {
        detailReads += 1;
        return jsonResponse({ success: true, data: detailReads === 1 ? detail : remoteIssueDetail });
      }
      if (url === "/api/issues/12" && init?.method === "PATCH") {
        return jsonResponse({ success: false, code: "issue_content_conflict", error: "stale" }, 409);
      }
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();
    selectIssueAction("编辑 Issue");
    fireEvent.change(screen.getByLabelText("Issue 标题"), { target: { value: "我的并发草稿" } });
    fireEvent.change(screen.getByLabelText("Issue 描述"), { target: { value: "不能被远端版本覆盖" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 Issue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("内容已被其他用户更新，当前草稿已保留");
    expect(screen.getByLabelText("Issue 标题")).toHaveValue("我的并发草稿");
    expect(screen.getByLabelText("Issue 描述")).toHaveValue("不能被远端版本覆盖");
    expect(screen.getByRole("button", { name: "放弃草稿并加载最新" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放弃草稿并加载最新" }));

    expect(await screen.findByRole("heading", { name: "远端 Issue 标题" })).toBeInTheDocument();
    expect(screen.getByText("远端 Issue 正文")).toBeInTheDocument();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:meta")).toBeNull();
    expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:body")).toBeNull();
  });

  it("cancels removed uploads, removes inserted Markdown, and never binds removed IDs", async () => {
    let resolveSlowUpload!: (response: Response) => void;
    const slowUpload = new Promise<Response>((resolve) => { resolveSlowUpload = resolve; });
    let uploadCount = 0;
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/attachments" && init?.method === "POST") {
        uploadCount += 1;
        if (uploadCount === 1) return slowUpload;
        return jsonResponse({ success: true, data: {
          id: "done-id",
          url: "/api/issues/attachments/done-id?pagePath=owner%2Fresearch",
          issue_id: null,
          comment_id: null,
          draft_id: "draft",
          uploader_id: "alice",
          file_name: "done.png",
          mime_type: "image/png",
          size_bytes: 4,
          created_at: "2026-07-10T11:00:00.000Z",
        } });
      }
      if (url.startsWith("/api/issues/attachments/") && init?.method === "DELETE") throw new Error("cleanup offline");
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/12/comments" && init?.method === "POST") return jsonResponse({ success: true, data: detail });
      return jsonResponse({ success: true, data: [openIssue] });
    });
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn(); });
    renderModal();
    await openDetail();

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["slow"], "slow.png", { type: "image/png" })] } });
    fireEvent.click(await screen.findByRole("button", { name: "移除 slow.png" }));
    await act(async () => resolveSlowUpload(jsonResponse({ success: true, data: {
      id: "slow-id",
      url: "/api/issues/attachments/slow-id?pagePath=owner%2Fresearch",
      issue_id: null,
      comment_id: null,
      draft_id: "draft",
      uploader_id: "alice",
      file_name: "slow.png",
      mime_type: "image/png",
      size_bytes: 4,
      created_at: "2026-07-10T11:00:00.000Z",
    } })));
    expect((screen.getByLabelText("评论内容") as HTMLTextAreaElement).value).not.toContain("slow-id");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/attachments/slow-id?pagePath=owner%2Fresearch&draftId=draft", expect.objectContaining({ method: "DELETE" })));

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["done"], "done.png", { type: "image/png" })] } });
    await waitFor(() => expect((screen.getByLabelText("评论内容") as HTMLTextAreaElement).value).toContain("done-id"));
    fireEvent.click(screen.getByRole("button", { name: "移除 done.png" }));
    expect((screen.getByLabelText("评论内容") as HTMLTextAreaElement).value).not.toContain("done-id");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/attachments/done-id?pagePath=owner%2Fresearch&draftId=draft", expect.objectContaining({ method: "DELETE" })));

    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "正文" } });
    fireEvent.click(screen.getByRole("button", { name: "评论" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments", expect.objectContaining({ method: "POST" })));
    const [, request] = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/issues/12/comments" && init?.method === "POST")!;
    expect(JSON.parse(String(request?.body))).toMatchObject({ body: "正文", attachmentIds: [] });
  });

  it("uploads selected, dropped, and pasted attachments with previews and retry controls", async () => {
    const fetchMock = mockWorkspaceApi();
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn(); });
    renderModal();
    await openDetail();

    expect(screen.getAllByRole("button", { name: "添加附件" })).toHaveLength(1);
    expect(screen.getByTestId("issue-attachment-input")).toHaveAttribute("hidden");
    expect(screen.getByTestId("issue-attachment-input")).not.toHaveAttribute("aria-label");
    const image = new File(["image"], "screenshot.png", { type: "image/png" });
    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [image] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/attachments", expect.objectContaining({ method: "POST" })));
    expect(screen.getByAltText("screenshot.png 预览")).toHaveAttribute("src", "blob:preview");
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    const dropZone = screen.getByLabelText("拖拽附件到此处");
    fireEvent.drop(dropZone, { dataTransfer: { files: [new File(["log"], "debug.log", { type: "text/plain" })] } });
    fireEvent.paste(screen.getByLabelText("评论内容"), {
      clipboardData: { files: [new File(["paste"], "paste.webp", { type: "image/webp" })], items: [] },
    });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/issues/attachments")).toHaveLength(3));
    expect(screen.getByText("debug.log")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除 screenshot.png" })).toBeInTheDocument();

    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["x"], "retry.txt", { type: "text/plain" })] } });
    expect(await screen.findByRole("button", { name: "重试 retry.txt" })).toBeInTheDocument();
  });

  it("blocks comment submission until every attachment is uploaded or removed", async () => {
    let rejectUpload!: (error: Error) => void;
    const pendingUpload = new Promise<Response>((_resolve, reject) => { rejectUpload = reject; });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/attachments" && init?.method === "POST") return pendingUpload;
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return jsonResponse({ success: true, data: [openIssue] });
    });
    renderModal();
    await openDetail();

    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "等待附件" } });
    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["slow"], "slow.txt", { type: "text/plain" })] } });
    expect(screen.getByRole("button", { name: "评论" })).toBeDisabled();

    rejectUpload(new Error("upload failed"));
    expect(await screen.findByRole("button", { name: "重试 slow.txt" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "评论" })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/issues/12/comments")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "移除 slow.txt" }));
    expect(screen.getByRole("button", { name: "评论" })).toBeEnabled();
  });

  it("escapes a hostile attachment name while preserving the controlled upload URL", async () => {
    const hostileName = "report\\](https://evil.example/steal)[draft].png";
    const controlledUrl = "/api/issues/attachments/safe-id?pagePath=owner%2Fresearch&token=a%28b%29";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/attachments" && init?.method === "POST") return jsonResponse({ success: true, data: {
        id: "safe-id",
        url: controlledUrl,
        issue_id: null,
        comment_id: null,
        draft_id: "draft",
        uploader_id: "alice",
        file_name: hostileName,
        mime_type: "image/png",
        size_bytes: 4,
        created_at: "2026-07-10T11:00:00.000Z",
      } });
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return jsonResponse({ success: true, data: [openIssue] });
    });
    const NativeURL = URL;
    vi.stubGlobal("URL", class extends NativeURL { static createObjectURL = vi.fn(() => "blob:preview"); static revokeObjectURL = vi.fn(); });
    renderModal();
    await openDetail();

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["data"], hostileName, { type: "image/png" })] } });
    await waitFor(() => expect((screen.getByLabelText("评论内容") as HTMLTextAreaElement).value).toContain(controlledUrl));
    const markdown = (screen.getByLabelText("评论内容") as HTMLTextAreaElement).value;
    expect(markdown).toContain("\\\\");
    expect(markdown).toContain("\\]");
    expect(markdown).toContain("\\(");
    expect(markdown).toContain(`](${controlledUrl})`);

    fireEvent.click(screen.getByRole("tab", { name: "预览" }));
    expect(await screen.findByRole("img", { name: hostileName })).toHaveAttribute("src", controlledUrl);
    expect(document.querySelector('img[src^="https://evil.example"]')).toBeNull();
  });

  it("binds a comment attachment with the same draft ID used for its upload", async () => {
    const fetchMock = mockWorkspaceApi();
    renderModal();
    await openDetail();

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["log"], "debug.log", { type: "text/plain" })] } });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/attachments", expect.objectContaining({ method: "POST" })));
    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "请看附件" } });
    fireEvent.click(screen.getByRole("button", { name: "评论" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments", expect.objectContaining({ method: "POST" })));
    const [, uploadRequest] = fetchMock.mock.calls.find(([input]) => String(input) === "/api/issues/attachments")!;
    const [, commentRequest] = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/issues/12/comments" && init?.method === "POST")!;
    expect(JSON.parse(String(commentRequest?.body))).toMatchObject({
      draftId: (uploadRequest?.body as FormData).get("draftId"),
      attachmentIds: [expect.any(String)],
    });
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).startsWith("/api/issues/attachments/") && init?.method === "DELETE")).toBe(false);
    await waitFor(() => expect(screen.getByTestId("issue-comment-7")).toHaveFocus());
    expect(new URL(window.location.href).searchParams.get("localappIssueCommentId")).toBe("7");
  });

  it("restores an uploaded attachment draft and submits it with the original draft ID", async () => {
    let uploadedDraftId = "";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/issues/attachments" && init?.method === "POST") {
        uploadedDraftId = String((init.body as FormData).get("draftId"));
        return jsonResponse({ success: true, data: {
          id: "restored-attachment",
          url: "/api/issues/attachments/restored-attachment?pagePath=owner%2Fresearch",
          issue_id: null,
          comment_id: null,
          draft_id: uploadedDraftId,
          uploader_id: "alice",
          file_name: "restored.log",
          mime_type: "text/plain",
          size_bytes: 8,
          created_at: "2026-07-10T11:00:00.000Z",
        } });
      }
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      if (url === "/api/issues/12/comments" && init?.method === "POST") return jsonResponse({ success: true, data: { ...detail, timeline: [...detail.timeline, { kind: "comment", comment: { id: 7, issue_id: 12, body: "恢复后提交", author_id: "alice", created_at: "2026-07-10T11:00:00.000Z", updated_at: "2026-07-10T11:00:00.000Z", deleted_at: null } }] } });
      return issueListResponse([openIssue]);
    });
    const first = renderModal();
    await openDetail();

    fireEvent.change(screen.getByTestId("issue-attachment-input"), { target: { files: [new File(["restored"], "restored.log", { type: "text/plain" })] } });
    await screen.findByRole("status", { name: "restored.log 已上传" });
    first.unmount();

    renderModal();
    await openDetail();
    expect(screen.getByText("restored.log")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "restored.log 已上传" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("评论内容"), { target: { value: "恢复后提交" } });
    fireEvent.click(screen.getByRole("button", { name: "评论" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments", expect.objectContaining({ method: "POST" })));
    const [, request] = fetchMock.mock.calls.find(([input, requestInit]) => String(input) === "/api/issues/12/comments" && requestInit?.method === "POST")!;
    expect(JSON.parse(String(request?.body))).toMatchObject({ draftId: uploadedDraftId, attachmentIds: ["restored-attachment"] });
    await waitFor(() => expect(sessionStorage.getItem("localapp:issues:draft:v1:owner%2Fresearch:alice:comment:12:body:attachments")).toBeNull());
  });

  it("opens issue and comment attachments without replacing the workspace", async () => {
    const attachedDetail = { ...detail, attachments: [
      { id: "issue-shot", url: "/ignored", issue_id: 12, comment_id: null, draft_id: "issue-draft", uploader_id: "alice", file_name: "issue.png", mime_type: "image/png", size_bytes: 10, created_at: "2026-07-10T11:00:00.000Z" },
      { id: "comment-log", url: "/ignored", issue_id: 12, comment_id: 6, draft_id: "comment-draft", uploader_id: "alice", file_name: "debug.log", mime_type: "text/plain", size_bytes: 20, created_at: "2026-07-10T11:00:00.000Z" },
    ] };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: attachedDetail }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    for (const name of ["在新标签页打开附件 issue.png", "在新标签页打开附件 debug.log"]) {
      const link = screen.getByRole("link", { name });
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    }
    expect(screen.getByRole("link", { name: "在新标签页打开附件 debug.log" })).toHaveClass("min-h-11", "min-w-0");
    expect(screen.getByRole("img", { name: "issue.png" })).toHaveAttribute("loading", "lazy");
    expect(screen.getByRole("img", { name: "issue.png" })).toHaveAttribute("decoding", "async");
  });

  it("renders referenced attachments only through Markdown and keeps unreferenced fallbacks", async () => {
    const issueUrl = "/api/issues/attachments/issue-shot?pagePath=owner%2Fresearch";
    const commentUrl = "/api/issues/attachments/comment-log?pagePath=owner%2Fresearch";
    const referencedDetail = {
      ...detail,
      issue: { ...detail.issue, description: `正文截图\n\n![内联截图](${issueUrl})` },
      timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, body: `日志：[内联日志](${commentUrl})` } } : item),
      attachments: [
        { id: "issue-shot", url: issueUrl, issue_id: 12, comment_id: null, draft_id: "issue-draft", uploader_id: "alice", file_name: "issue.png", mime_type: "image/png", size_bytes: 10, created_at: "2026-07-10T11:00:00.000Z" },
        { id: "comment-log", url: commentUrl, issue_id: 12, comment_id: 6, draft_id: "comment-draft", uploader_id: "alice", file_name: "debug.log", mime_type: "text/plain", size_bytes: 20, created_at: "2026-07-10T11:00:00.000Z" },
        { id: "orphan", url: "/api/issues/attachments/orphan?pagePath=owner%2Fresearch", issue_id: 12, comment_id: null, draft_id: "issue-draft", uploader_id: "alice", file_name: "notes.txt", mime_type: "text/plain", size_bytes: 30, created_at: "2026-07-10T11:00:00.000Z" },
      ],
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: referencedDetail }) : issueListResponse([openIssue]));
    renderModal();
    await openDetail();

    expect(screen.getByRole("img", { name: "内联截图" })).toHaveAttribute("src", issueUrl);
    expect(screen.getByRole("link", { name: "内联日志" })).toHaveAttribute("href", commentUrl);
    expect(screen.queryByRole("link", { name: "在新标签页打开附件 issue.png" })).toBeNull();
    expect(screen.queryByRole("link", { name: "在新标签页打开附件 debug.log" })).toBeNull();
    expect(screen.getByRole("link", { name: "在新标签页打开附件 notes.txt" })).toBeInTheDocument();
  });

  it("keeps existing attachments visible and permits saving an attachment-only comment edit", async () => {
    const attachmentOnlyDetail = {
      ...detail,
      timeline: detail.timeline.map((item) => item.kind === "comment" ? { ...item, comment: { ...item.comment, body: "" } } : item),
      attachments: [{ id: "comment-log", url: "/ignored", issue_id: 12, comment_id: 6, draft_id: "comment-draft", uploader_id: "alice", file_name: "debug.log", mime_type: "text/plain", size_bytes: 20, created_at: "2026-07-10T11:00:00.000Z" }],
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/issues/12/comments/6" && init?.method === "PATCH") return jsonResponse({ success: true, data: { ...attachmentOnlyDetail, attachments: [] } });
      return String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? jsonResponse({ success: true, data: attachmentOnlyDetail }) : issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();

    selectCommentAction("编辑评论");
    const editor = within(screen.getByTestId("issue-comment-6"));
    expect(editor.getByRole("link", { name: "在新标签页打开附件 debug.log" })).toBeInTheDocument();
    expect(editor.getByRole("button", { name: "保存评论" })).toBeEnabled();
    fireEvent.click(editor.getByRole("button", { name: "移除现有附件 debug.log" }));
    expect(editor.queryByRole("link", { name: "在新标签页打开附件 debug.log" })).toBeNull();
    expect(editor.getByRole("button", { name: "保存评论" })).toBeDisabled();
    fireEvent.change(editor.getByRole("textbox", { name: "编辑评论内容" }), { target: { value: "移除过期附件" } });
    fireEvent.click(editor.getByRole("button", { name: "保存评论" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12/comments/6", expect.objectContaining({ method: "PATCH" })));
    const request = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/issues/12/comments/6" && init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ removedAttachmentIds: ["comment-log"] });
  });

  it("shows and removes an existing Issue attachment while editing", async () => {
    let removed = false;
    const attachedDetail = { ...detail, issue: { ...detail.issue, description: `${detail.issue.description}\n\n![custom screenshot](/ignored)` }, attachments: [{ id: "issue-shot", url: "/ignored", issue_id: 12, comment_id: null, draft_id: "issue-draft", uploader_id: "alice", file_name: "issue.png", mime_type: "image/png", size_bytes: 10, created_at: "2026-07-10T11:00:00.000Z" }] };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input) === "/api/issues/12" && init?.method === "PATCH") { removed = true; return jsonResponse({ success: true, data: detail.issue }); }
      if (String(input) === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: removed ? { ...attachedDetail, attachments: [] } : attachedDetail });
      return issueListResponse([openIssue]);
    });
    renderModal();
    await openDetail();
    selectIssueAction("编辑 Issue");

    expect(screen.getByRole("link", { name: "在新标签页打开附件 issue.png" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "移除现有附件 issue.png" }));
    expect(screen.queryByRole("link", { name: "在新标签页打开附件 issue.png" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "Issue 描述" })).not.toHaveValue(expect.stringContaining("/ignored"));
    fireEvent.click(screen.getByRole("button", { name: "保存 Issue" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/issues/12", expect.objectContaining({ method: "PATCH" })));
    const request = fetchMock.mock.calls.find(([input, init]) => String(input) === "/api/issues/12" && init?.method === "PATCH")?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({ description: detail.issue.description, removedAttachmentIds: ["issue-shot"] });
  });

  it("keeps list, create, and non-JSON error behavior compatible", async () => {
    const onIssuesChanged = vi.fn();
    const onIssueNavigate = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (init?.method === "POST") return jsonResponse({ success: true, data: openIssue });
      if (String(input) === "/api/issues/12?pagePath=owner%2Fresearch") return jsonResponse({ success: true, data: detail });
      return jsonResponse({ success: true, data: [] });
    });
    render(
      <IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={{ id: "alice", name: "Alice" }} onIssuesChanged={onIssuesChanged} onIssueNavigate={onIssueNavigate} onClose={vi.fn()} />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    expect(screen.getByLabelText("描述")).toHaveAttribute("placeholder", "详细描述问题、复现步骤或期望结果");
    fireEvent.change(screen.getByLabelText("标题"), { target: { value: "修复上传失败" } });
    fireEvent.click(screen.getByRole("button", { name: "提交 Issue" }));
    await waitFor(() => expect(onIssuesChanged).toHaveBeenCalledOnce());
    const [, createRequest] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(String(createRequest?.body))).toMatchObject({ title: "修复上传失败", description: "" });
    expect(await screen.findByRole("heading", { name: "修复上传失败" })).toBeInTheDocument();
    expect(onIssueNavigate).toHaveBeenCalledWith(12);

    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(htmlResponse());
    renderModal();
    await waitFor(() => expect(screen.getAllByRole("alert").some((alert) => alert.textContent?.includes("Issue 服务暂不可用"))).toBe(true));
    expect(fetchMock).toHaveBeenCalled();
  });

  it("counts Unicode create titles, preserves an overlong value, and blocks submission", async () => {
    mockWorkspaceApi();
    renderModal();
    fireEvent.click(await screen.findByRole("button", { name: "新建 Issue" }));
    const title = screen.getByLabelText("标题");
    const invalidTitle = "😀".repeat(257);
    fireEvent.change(title, { target: { value: invalidTitle } });
    expect(title).toHaveValue(invalidTitle);
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("257 / 256")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Issue 标题不能超过 256 个字符");
    expect(screen.getByRole("button", { name: "提交 Issue" })).toBeDisabled();
    fireEvent.change(title, { target: { value: "😀".repeat(256) } });
    expect(screen.getByText("256 / 256")).toBeInTheDocument();
    expect(title).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText("Issue 标题不能超过 256 个字符")).toBeNull();
    expect(screen.getByRole("button", { name: "提交 Issue" })).toBeEnabled();
  });

  it("preserves a restored overlong Issue edit title while blocking save", async () => {
    mockWorkspaceApi();
    const invalidTitle = "恢".repeat(257);
    sessionStorage.setItem("localapp:issues:draft:v1:owner%2Fresearch:alice:edit:12:meta", JSON.stringify({ title: invalidTitle, label: "feature", expectedUpdatedAt: detail.issue.updated_at }));
    renderModal();
    await openDetail();
    selectIssueAction("编辑 Issue");
    const title = screen.getByLabelText("Issue 标题");
    expect(title).toHaveValue(invalidTitle);
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("257 / 256")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存 Issue" })).toBeDisabled();
  });

  it("retries the failed detail request instead of only refreshing the list", async () => {
    let detailAttempts = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url === "/api/issues/12?pagePath=owner%2Fresearch") {
        detailAttempts += 1;
        return detailAttempts === 1 ? htmlResponse() : jsonResponse({ success: true, data: detail });
      }
      return issueListResponse([openIssue]);
    });
    renderModal();

    fireEvent.click(await screen.findByRole("link", { name: "#12 修复上传失败" }));
    const detailError = await screen.findByRole("alert", { name: "无法加载 Issue 详情" });
    expect(detailError).toHaveAccessibleDescription("Issue 服务暂不可用");
    const errorHeading = screen.getByRole("heading", { name: "无法加载 Issue 详情" });
    await waitFor(() => expect(errorHeading).toHaveFocus());
    expect(errorHeading).not.toHaveClass("focus-visible:ring-2", "focus-visible:ring-ring");
    expect(screen.getByRole("button", { name: "重试加载 Issue 详情" })).toHaveClass("h-11", "sm:h-8");
    fireEvent.click(screen.getByRole("button", { name: "重试加载 Issue 详情" }));

    await screen.findByRole("heading", { name: "修复上传失败" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "修复上传失败" })).toHaveFocus());
    expect(detailAttempts).toBe(2);
  });

  it("restores the originating Issue row when leaving a failed detail", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => String(input) === "/api/issues/12?pagePath=owner%2Fresearch" ? htmlResponse() : issueListResponse([openIssue]));
    renderModal();
    fireEvent.click(await screen.findByRole("link", { name: "#12 修复上传失败" }));
    await screen.findByRole("heading", { name: "无法加载 Issue 详情" });
    fireEvent.click(screen.getByRole("button", { name: "从错误页返回 Issue 列表" }));
    await waitFor(() => expect(screen.getByRole("link", { name: "#12 修复上传失败" })).toHaveFocus());
  });

  it("traps focus, ignores backdrop clicks, and restores the opener on explicit closes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ success: true, data: [] }));
    function FocusHarness() {
      const [open, setOpen] = React.useState(false);
      return <><button type="button" onClick={() => setOpen(true)}>Issue 入口</button>{open && <IssuesModal pagePath="owner/research" pageName="Research Pipeline" user={null} onClose={() => setOpen(false)} />}</>;
    }
    render(<FocusHarness />);
    const opener = screen.getByRole("button", { name: "Issue 入口" });

    opener.focus();
    fireEvent.click(opener);
    let dialog = await screen.findByRole("dialog");
    const focusable = Array.from(dialog.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"));
    focusable.at(-1)!.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(focusable[0]).toHaveFocus();
    focusable[0].focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(focusable.at(-1)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "关闭 Issue 面板" }));
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    dialog = await screen.findByRole("dialog");
    fireEvent.click(dialog.previousElementSibling as HTMLElement);
    expect(dialog).toBeInTheDocument();
    expect(opener).not.toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "关闭 Issue 面板" }));
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(opener).toHaveFocus();
  });

  it("excludes controls inside a CSS-hidden detail sidebar from the focus trap", async () => {
    mockWorkspaceApi();
    renderModal();
    await openDetail();
    const dialog = screen.getByRole("dialog", { name: "Issue #12 · 修复上传失败" });
    const sidebar = dialog.querySelector<HTMLElement>("[data-localapp-issue-metadata]")!;
    sidebar.style.display = "none";

    dialog.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });

    expect(sidebar.contains(document.activeElement)).toBe(false);
    expect(document.activeElement).not.toBe(dialog);
  });

  it("detects focus targets hidden by a CSS-hidden ancestor", () => {
    const boundary = document.createElement("div");
    const hiddenRegion = document.createElement("aside");
    const button = document.createElement("button");
    hiddenRegion.style.display = "none";
    hiddenRegion.append(button);
    boundary.append(hiddenRegion);
    document.body.append(boundary);

    expect(isIssueFocusTargetVisible(button, boundary)).toBe(false);
    boundary.remove();
  });

  it("fills its application-area parent without viewport-sized modal limits", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ success: true, data: [] }));
    renderModal(null);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveClass("min-h-[420px]");
    expect(dialog).toHaveClass("h-full", "w-full");
    expect(dialog).not.toHaveClass("max-w-[780px]", "max-h-[calc(100dvh-2rem)]");
    expect(dialog.parentElement).toHaveAttribute("data-localapp-issues-layer");
    expect(dialog.parentElement).toHaveClass("absolute", "inset-0", "sm:p-2");
  });
});
