import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const TRANSPARENT = "rgba(0, 0, 0, 0)";

function readTemplateFile(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf-8");
}

function cssForRuntimeTokens() {
  const preset = readTemplateFile(path.join("runtime", "styles", "preset.css"));
  const tokenNames = [
    "--localapp-dev-muted",
    "--localapp-dev-muted-foreground",
    "--localapp-dev-border",
    "--localapp-dev-focus",
    "--localapp-dev-accent",
    "--localapp-dev-accent-foreground",
    "--localapp-dev-stripe-from",
    "--localapp-dev-stripe-via",
    "--localapp-dev-stripe-to",
  ];
  const declarations = tokenNames
    .map((token) => preset.match(new RegExp(`${token}:\\s*([^;]+);`))?.[0])
    .filter(Boolean)
    .join("\n");

  return `
    :root { ${declarations} }
    .bg-localapp-dev-muted { background-color: var(--localapp-dev-muted); }
    .text-localapp-dev-muted-foreground { color: var(--localapp-dev-muted-foreground); }
    .border-localapp-dev-border { border-color: var(--localapp-dev-border); border-width: 1px; border-style: solid; }
    .ring-localapp-dev-focus { outline-color: var(--localapp-dev-focus); }
    .bg-localapp-dev-accent { background-color: var(--localapp-dev-accent); }
    .text-localapp-dev-accent-foreground { color: var(--localapp-dev-accent-foreground); }
    .from-localapp-dev-stripe-from { --tw-gradient-from: var(--localapp-dev-stripe-from); }
    .via-localapp-dev-stripe-via { --tw-gradient-via: var(--localapp-dev-stripe-via); }
    .to-localapp-dev-stripe-to { --tw-gradient-to: var(--localapp-dev-stripe-to); }
  `;
}

describe("dev-shell template", () => {
  it("nav 标签内最后一个子元素是视觉锚点彩条", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const expectedGradient =
      "h-[3px] bg-gradient-to-r from-localapp-dev-stripe-from via-localapp-dev-stripe-via to-localapp-dev-stripe-to";
    expect(devShell).toContain(expectedGradient);
  });

  it("彩条作为 nav 标签内的最后一个子元素", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const expectedGradient =
      "h-[3px] bg-gradient-to-r from-localapp-dev-stripe-from via-localapp-dev-stripe-via to-localapp-dev-stripe-to";
    const navEndIndex = devShell.indexOf("</nav>");
    expect(navEndIndex).toBeGreaterThan(0);
    const lastGradientIndex = devShell.lastIndexOf(expectedGradient);
    expect(lastGradientIndex).toBeGreaterThan(0);
    expect(lastGradientIndex).toBeLessThan(navEndIndex);
  });

  it("彩条配色使用 runtime 声明的 DevShell token", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("from-localapp-dev-stripe-from");
    expect(devShell).toContain("via-localapp-dev-stripe-via");
    expect(devShell).toContain("to-localapp-dev-stripe-to");
  });

  it("包含开发工具入口和身份/时间/数据/诊断分区", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("开发工具");
    expect(devShell).toContain("身份");
    expect(devShell).toContain("时间");
    expect(devShell).toContain("数据");
    expect(devShell).toContain("诊断");
  });

  it("DEV 按钮是顶栏最左侧入口，替代独立开发徽章", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("DEV_NAV_LABEL");
    expect(devShell).toContain("aria-label=\"打开 DEV 菜单\"");
    expect(devShell).not.toContain(">开发</span>");
  });

  it("DevShell 顶栏显式派生自平台 nav-shell 结构模型", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("PLATFORM_NAV_SHELL_MODEL");
    expect(devShell).toContain("deriveDevShellNavModel");
    expect(devShell).toContain("localapp-platform-nav-left");
    expect(devShell).toContain("localapp-platform-nav-right");
  });

  it("工具列表和开发工具入口收纳在 DEV 下拉菜单中", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("DEV_MENU_TOOLS");
    expect(devShell).toContain("DEV_MENU_TOOLKIT");
    expect(devShell).toContain("devMenuOpen");
    expect(devShell).not.toContain("工具 {toolCount}");
    expect(devShell).not.toContain("devToolkitOpen ? DEV_BUTTON_SUCCESS : DEV_BUTTON_IDLE");
  });

  it("DEV 下拉菜单项会关闭下拉并打开对应面板", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("openToolsFromDevMenu");
    expect(devShell).toContain("openDevToolkitFromDevMenu");
    expect(devShell).toContain("setDevMenuOpen(false)");
    expect(devShell).toContain("setToolsOpen(true)");
    expect(devShell).toContain("setDevToolkitOpen(true)");
  });

  it("DEV 下拉菜单支持键盘和外部点击关闭", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("devMenuRef");
    expect(devShell).toContain('event.key === "Escape"');
    expect(devShell).toContain('document.addEventListener("keydown"');
    expect(devShell).toContain('document.addEventListener("mousedown"');
  });

  it("身份切换会调用 dev context API 并派发刷新事件", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("/api/dev/context");
    expect(devShell).toContain("localapp:dev-context-changed");
    expect(devShell).toContain("window.dispatchEvent");
  });

  it("身份切换只使用平台用户搜索和固定快捷项，不提供编造用户入口", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("/api/dev/users");
    expect(devShell).toContain("ownUser");
    expect(devShell).toContain("setOwnUser");
    expect(devShell).toContain("搜索平台用户");
    expect(devShell).toContain("历史用户 1");
    expect(devShell).toContain("历史用户 2");
    expect(devShell).not.toContain('setUser("dev-user"');
    expect(devShell).not.toContain('setUser("alice"');
    expect(devShell).not.toContain('setUser("bob"');
    expect(devShell).not.toContain('placeholder="用户 ID"');
  });

  it("dev context 失败时提示使用 localapp dev 启动", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("请使用 npm run dev 或 localapp dev 启动开发环境");
    expect(devShell).toContain("readDevContextError");
    expect(devShell).toContain("readDevJson");
    expect(devShell).toContain("Expected JSON");
    expect(devShell).toContain('readDevJson(res, "Server time request")');
    expect(devShell).toContain('readDevJson(res, "Dev context update")');
  });

  it("时间切换支持固定时间和恢复真实时间", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("timeMode");
    expect(devShell).toContain("fixed");
    expect(devShell).toContain("real");
  });

  it("时间设置使用常规日期和时间输入，不暴露 ISO 字符串编辑", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('type="date"');
    expect(devShell).toContain('type="time"');
    expect(devShell).toContain("toDevIsoDateTime");
    expect(devShell).not.toContain('useState("2026-07-01T09:00:00.000Z")');
  });

  it("DevShell 不复制生产 nav-shell 用户入口", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).not.toContain("Login");
    expect(devShell).not.toContain("Logout");
    expect(devShell).not.toContain("Favorites");
    expect(devShell).not.toContain("DEV_NAV_NOTIFICATIONS");
  });

  it("DevShell 顶栏对齐生产 nav-shell 的应用名和用户头像用户名", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("appTitle");
    expect(devShell).toContain("getDevShellAppTitle");
    expect(devShell).toContain("DevShellUserEntry");
    expect(devShell).toContain("avatarUrl");
    expect(devShell).toContain("getUserInitial");
    expect(devShell).not.toContain("<span className={navModel.appTitleClass}>App</span>");
  });

  it("DevShell AI 侧栏复用生产 AI 侧栏的核心能力", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("react-markdown");
    expect(devShell).toContain("remark-gfm");
    expect(devShell).toContain("ReactMarkdown");
    expect(devShell).toContain("remarkPlugins={[remarkGfm]}");
    expect(devShell).toContain("localapp-ai-sidebar-width");
    expect(devShell).toContain("handleDragStart");
    expect(devShell).toContain("cursor-col-resize");
  });

  it("数据和诊断分区接入 mini-server dev-only API", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("localapp:platform_request");
    expect(devShell).toContain("localapp:platform_response");
    expect(devShell).toContain("handlePlatformRequest");
    expect(devShell).toContain("respondToPlatformRequest");
    expect(devShell).toContain("confirmDialog");
    expect(devShell).toContain("downloadFromDevShell");
    expect(devShell).not.toContain("localapp:platform-ai");
    expect(devShell).not.toContain("localapp:platform-download");
    expect(devShell).toContain("/api/dev/data/reset");
    expect(devShell).toContain("/api/dev/data/snapshots");
    expect(devShell).toContain("/api/dev/diagnostics/requests");
    expect(devShell).toContain("/api/dev/business");
  });

  it("DevShell 在当前页面接管登录请求并打开身份选择", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('case "auth.login"');
    expect(devShell).toContain("setDevToolkitOpen(true)");
    expect(devShell).toContain("event.preventDefault()");
  });

  it("DevShell 同时提供 SDK native tool registry，与生产 shell 使用同一工具契约", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("@localapp/sdk-agent/native-registry");
    expect(devShell).toContain("setPlatformToolRegistry");
    expect(devShell).toContain("registerDevTools");
  });

  it("DevShell 提供编辑会话入口和快捷键宿主", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("setPlatformEditSessionRegistry");
    expect(devShell).toContain("registerEditSession");
    expect(devShell).toContain("DEV_NAV_SAVE");
    expect(devShell).toContain("DEV_NAV_UNDO");
    expect(devShell).toContain("DEV_NAV_REDO");
    expect(devShell).toContain("isEditableShortcutTarget");
    expect(devShell).toContain("Ctrl+S");
    expect(devShell).toContain("Ctrl+Z");
    expect(devShell).toContain("Ctrl+Y");
  });

  it("DevShell 订阅本地 presence 并在左侧显示在线人数", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("/api/presence/events");
    expect(devShell).toContain("/api/presence/heartbeat");
    expect(devShell).toContain("/api/presence/leave");
    expect(devShell).toContain("clientId");
    expect(devShell).toContain("navigator.sendBeacon");
    expect(devShell).toContain("presence:snapshot");
    expect(devShell).toContain("authenticatedUsers");
    expect(devShell).toContain('document.visibilityState === "hidden"');
    expect(devShell).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
    expect(devShell).toContain('window.addEventListener("blur", handleWindowBlur)');
    expect(devShell).toContain('window.addEventListener("focus", handleWindowFocus)');
    expect(devShell).toContain('window.addEventListener("pagehide", handlePageHide)');
    expect(devShell).toContain('window.addEventListener("pageshow", handleWindowFocus)');
    expect(devShell).toContain("DEV_NAV_ONLINE_USERS");
    expect(devShell).toContain("当前在线用户");
  });

  it("DevShell 提供与生产一致的本地 Issue 入口和三态工作台", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("DEV_NAV_ISSUES");
    expect(devShell).toContain("openIssueCount");
    expect(devShell).toContain("data-localapp-issues-workspace");
    expect(devShell).toContain('kind: "detail"');
    expect(devShell).toContain('kind: "create"');
    expect(devShell).toContain("/api/issues");
    expect(devShell).toContain("Issue 服务暂不可用");
    expect(devShell).toContain("按标签筛选");
    expect(devShell).toContain('aria-label="按创建者筛选"');
    expect(devShell).toContain('aria-label="按负责人筛选"');
    expect(devShell).toContain("[&_label:focus-within]:ring-2 [&_label:focus-within]:ring-localapp-dev-focus");
    expect(devShell).toContain('<option value="none">未分配</option>');
    expect(devShell).toContain('<option value="none">无标签</option>');
    expect(devShell).toContain('updateIssueQuery({ assignee: event.target.value })');
    expect(devShell).toContain('updateIssueQuery({ author: event.target.value })');
    expect(devShell).toContain("activeDevIssueAdvancedFilterCount(query, user?.id)");
    expect(devShell).toContain('aria-controls="localapp-dev-issue-advanced-filters"');
    expect(devShell).toContain('data-testid="issue-advanced-filters"');
    expect(devShell).toContain("advancedIssueFiltersOpen ? \"grid\" : \"hidden\"");
    expect(devShell).toContain("sm:contents");
    expect(devShell).toContain("sm:hidden");
    expect(devShell).toContain('select aria-label="Issue 视图" value={activeSavedViewId ? `saved:${activeSavedViewId}` : activeView}');
    expect(devShell).toContain('if (value.startsWith("saved:"))');
    expect(devShell).toContain("selectIssueView(value as DevIssueListView)");
    expect(devShell).toContain('className="hidden max-w-full gap-1 lg:flex lg:flex-col" aria-label="Issue 视图导航"');
    expect(devShell).toContain("关闭 Issue");
    expect(devShell).not.toContain("window.alert");
  });

  it("DevShell Open count 优先读取 meta.open，并仅在其非法时回退 data.length", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("requestDevIssueBody<DevIssue[]>(`/api/issues?${query.toString()}`");
    expect(devShell).toContain("const open = body.meta?.open");
    expect(devShell).toContain("typeof open === \"number\" && Number.isFinite(open) && open >= 0");
    expect(devShell).toContain("Array.isArray(body.data) ? body.data.length : 0");
    expect(devShell).toContain("if (active) setOpenIssueCount(open)");
    expect(devShell).not.toContain('if (active) setOpenIssueCount(null)');
    expect(devShell).toContain('throw new Error("Issue 服务暂不可用")');
  });

  it("DevShell Issue 状态按钮、列表和详情使用一致的中文状态名称", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain('aria-label={`开启 ${meta.open}`}');
    expect(devShell).toContain('aria-label={`已关闭 ${meta.closed}`}');
    expect(devShell).toContain('开启 {meta.open}');
    expect(devShell).toContain('已关闭 {meta.closed}');
    expect(devShell).toContain('`${query.status === "open" ? "开启" : "已关闭"}的 Issues`');
    expect(devShell).toContain('detail.issue.status === "open" ? "开启"');
    expect(devShell).toContain('"已关闭 · 不计划处理" : "已关闭 · 已完成"');
  });

  it("DevShell 批量标签操作按当前标签集合添加或移除并保留失败项", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain('aria-label="批量标签操作"');
    expect(workspace).toContain("[&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-2");
    expect(workspace).toContain("[&_[data-localapp-issue-bulk-toolbar]_label:focus-within]:ring-localapp-dev-focus");
    expect(workspace).toContain('grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:contents [&>label]:min-w-0');
    expect(workspace).toContain('value={`add:${label.id}`}');
    expect(workspace).toContain('value={`remove:${label.id}`}');
    expect(workspace).toContain('aria-label="批量类型操作"');
    expect(workspace).toContain('JSON.stringify({ pagePath, issueType })');
    expect(workspace).toContain('setBulkIssueTypeAction("")');
    expect(workspace).toContain('issue?.labels?.map((label) => label.id) ?? []');
    expect(workspace).toContain("const applyBulkIssueLabel = async");
    expect(workspace).toContain("const focusSelectAllAfterBulkSave = () =>");
    expect(workspace).toContain("document.querySelector<HTMLInputElement>('[data-localapp-issues-workspace] input[aria-label=\"选择当前页全部 Issue\"]')");
    expect(workspace).toContain("if (!control || control.disabled)");
    expect(workspace).toContain("if (stableChecks < 3 && attempts++ < 20)");
    expect(workspace).toContain("if (failedIds.length === 0) focusSelectAllAfterBulkSave()");
    expect(workspace).toContain("const selectionAnchorIssueIdRef = useRef<number | null>(null)");
    expect(workspace).toContain("const toggleIssueSelectionRange = (issueId: number, selected: boolean, range: boolean)");
    expect(workspace).toContain("event.shiftKey && event.detail > 0");
    expect(workspace).toContain('if (event.key === " ")');
    expect(workspace).toContain("requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}/labels`");
    expect(workspace).toContain("setSelectedIssueIds(new Set(failedIds))");
  });

  it("DevShell 批量负责人操作合并当前集合并保留失败项", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain('aria-label="批量负责人操作"');
    expect(workspace).toContain("const applyBulkIssueAssignee = async");
    expect(workspace).toContain("const current = issue?.assignee_ids ?? []");
    expect(workspace).toContain("requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}/assignees`");
    expect(workspace).toContain("body: JSON.stringify({ pagePath, userIds })");
  });

  it("DevShell 批量里程碑操作支持设置、清除并保留失败项", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain('aria-label="批量里程碑操作"');
    expect(workspace).toContain('<option value="none">清除里程碑</option>');
    expect(workspace).toContain("const applyBulkIssueMilestone = async");
    expect(workspace).toContain("const milestoneId = value === \"none\" ? null : Number(value)");
    expect(workspace).toContain("requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}/milestone`");
    expect(workspace).toContain("body: JSON.stringify({ pagePath, milestoneId })");
    expect(workspace).toContain("setSelectedIssueIds(new Set(failedIds))");
  });

  it("DevShell 在列表行显示可解析里程碑并复用结构化筛选", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const issueMilestone = availableMilestones.find((milestone) => milestone.id === issue.milestone_id)");
    expect(workspace).toContain('aria-label={`按里程碑筛选 ${issueMilestone.title}`}');
    expect(workspace).toContain("updateIssueQuery({ milestone: String(issueMilestone.id), offset: 0 })");
    expect(workspace).toContain("<CalendarDays className=\"h-3.5 w-3.5 shrink-0\"");
  });

  it("DevShell 仅将列表标签升级为结构化筛选入口", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const badge = devShell.slice(devShell.indexOf("function DevIssueLabelBadge"), devShell.indexOf("function DevIssueLabelManager"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(badge).toContain("onSelect?: (labelId: string) => void");
    expect(badge).toContain('aria-label={`按标签筛选 ${label.name}`}');
    expect(workspace).toContain("onSelect={(labelId) => updateIssueQuery({ label: labelId, offset: 0 })}");
    expect(workspace).toContain("<DevIssueLabelBadge key={label.id} label={label} onSelect=");
    expect(devShell).toContain("<DevIssueLabelBadge key={label.id} label={label} />");
  });

  it("DevShell 将可见负责人头像升级为筛选入口并保持溢出静态", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const assignees = devShell.slice(devShell.indexOf("function DevIssueListAssignees"), devShell.indexOf("function DevIssueDetailSkeleton"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(assignees).toContain("onSelect: (userId: string) => void");
    expect(assignees).toContain('aria-label={`按负责人筛选 ${identity.displayName}`}');
    expect(assignees).toContain("onClick={() => onSelect(identity.id)}");
    expect(assignees).toContain('aria-label={`另外 ${overflow} 位负责人`}');
    expect(workspace).toContain("onSelect={(userId) => updateIssueQuery({ assignee: userId, offset: 0 })}");
  });

  it("DevShell 解析列表创建者名称并按稳定 ID 筛选", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const issueReporter = resolveDevIssueIdentity(issue.reporter_id, issueMentionCandidates)");
    expect(workspace).toContain('aria-label={`按创建者筛选 ${issueReporter.displayName}`}');
    expect(workspace).toContain('title={`${issueReporter.displayName} @${issueReporter.id}`}');
    expect(workspace).toContain("updateIssueQuery({ author: issueReporter.id, offset: 0 })");
  });

  it("DevShell 区分列表创建时间与后续活动时间", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const activity = devShell.slice(devShell.indexOf("function DevIssueListActivityTime"), devShell.indexOf("function DevIssueListAssignees"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(activity).toContain("issue.last_activity_at ?? issue.updated_at ?? issue.created_at");
    expect(activity).toContain('data-kind={created ? "created" : "activity"}');
    expect(activity).toContain('{created ? "创建于" : "活动于"}');
    expect(activity).toContain("<DevIssueTime timestamp={timestamp} />");
    expect(workspace).toContain("<DevIssueListActivityTime issue={issue} />");
  });

  it("DevShell 在 Closed 列表区分已完成与不计划处理", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const status = devShell.slice(devShell.indexOf("function DevIssueListStatusIcon"), devShell.indexOf("function DevIssueListActivityTime"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(status).toContain('issue.state_reason === "not_planned"');
    expect(status).toContain("<CircleSlash2");
    expect(status).toContain('notPlanned ? "已关闭：不计划处理" : "已关闭：已完成"');
    expect(workspace).toContain("<DevIssueListStatusIcon issue={issue} className=\"mt-1 h-4 w-4 shrink-0\" />");
  });

  it("DevShell 支持 assignee 搜索限定词、URL 状态和服务端筛选", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('assignee: "localappIssueAssignee"');
    expect(devShell).toContain('["assignee:", "负责人", "筛选分配给指定用户的 Issue"]');
    expect(devShell).toContain('updates[key === "author" ? "author" : key === "assignee" ? "assignee" : "participant"]');
    expect(devShell).toContain('requestQuery.set("assignee", nextQuery.assignee)');
    expect(devShell).toContain('kind: "负责人"');
  });

  it("DevShell Issue 行显示紧凑负责人组与溢出计数", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("function DevIssueListAssignees(");
    expect(devShell).toContain('aria-label={`负责人：${resolved.map((identity) => identity.displayName).join("、")}`}');
    expect(devShell).toContain("const visible = resolved.slice(0, 3)");
    expect(devShell).toContain("另外 ${overflow} 位负责人");
    expect(devShell).toContain("<DevIssueListAssignees ids={issue.assignee_ids ?? []} identities={issueMentionCandidates} onSelect={(userId) => updateIssueQuery({ assignee: userId, offset: 0 })} />");
  });

  it("DevShell 支持负责人、标签与里程碑缺失元数据筛选", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('["no:", "缺失项", "筛选缺少元数据的 Issue"]');
    expect(devShell).toContain('add("assignee", "无负责人", "仅显示尚未分配负责人的 Issue")');
    expect(devShell).toContain('add("label", "无标签", "仅显示尚未添加标签的 Issue")');
    expect(devShell).toContain('add("milestone", "无里程碑", "仅显示尚未设置里程碑的 Issue")');
    expect(devShell).toContain('key === "no" && /^(assignee|label|milestone)$/i.test(rawValue)');
    expect(devShell).toContain('updates[rawValue.toLowerCase() as "assignee" | "label" | "milestone"] = "none"');
    expect(devShell).toContain('query.assignee === "none" ? "未分配"');
    expect(devShell).toContain('query.label === "none" ? "未添加"');
    expect(devShell).toContain('(issue.labels ?? [])');
    expect(devShell).toContain('issue?.labels?.map((label) => label.id) ?? []');
  });

  it("DevShell Issue 详情从 mini-server 加载 GitHub 风格 Markdown 时间线", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("interface DevIssueDetail");
    expect(devShell).toContain("type DevIssueTimelineItem");
    expect(devShell).toContain("loadIssueDetail");
    expect(devShell).toContain("/api/issues/${issueId}?");
    expect(devShell).toContain("aria-label=\"Issue 时间线\"");
    expect(devShell).toContain("DevIssueMarkdown");
    expect(devShell).toContain("inline-flex h-11 w-11 cursor-pointer");
    expect(devShell).toContain("sm:h-6 sm:w-6");
    expect(devShell).toContain("remarkPlugins={[remarkGfm]}");
    expect(devShell).toContain("event_type === \"opened\"");
    expect(devShell).toContain("event_type === \"closed\"");
    expect(devShell).toContain("event_type === \"reopened\"");
    expect(devShell).toContain('event.event_type === "labels_changed"');
    expect(devShell).toContain('event.event_type === "assignees_changed"');
    expect(devShell).toContain('event.event_type === "subscribed"');
    expect(devShell).toContain('event.event_type === "unsubscribed"');
    expect(devShell).toContain("将 ${addedName} 设为负责人");
  });

  it("DevShell Issue 详情同步 Hosted 的讨论流、元数据和响应式契约", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    for (const attribute of [
      "data-localapp-issue-detail",
      "data-localapp-issue-discussion",
      "data-localapp-issue-metadata",
      "data-localapp-issue-body-card",
      "data-localapp-issue-comment-card",
      "data-localapp-issue-event",
    ]) {
      expect(devShell).toContain(attribute);
    }
    expect(devShell).toContain("text-2xl font-normal leading-8 tracking-normal");
    expect(devShell).toContain("sm:text-[32px] sm:leading-10");
    expect(devShell).toContain("lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)]");
    expect(devShell).toContain("lg:gap-6");
    expect(devShell).toContain("<details data-localapp-issue-metadata");
    expect(devShell).toContain("className=\"border-b border-localapp-dev-border py-3 lg:hidden\"");
    expect(devShell).toContain("max-lg:hidden min-w-0 border-l");
    expect(devShell).toContain("[&_[data-localapp-issue-body-card]]:rounded-[6px]");
    expect(devShell).toContain("data-localapp-issue-comment-card data-localapp-issue-comment-pinned={comment.pinned_at ? \"true\" : undefined} data-localapp-issue-comment-id={comment.id}");
    expect(devShell).toContain('className={`min-w-0 overflow-hidden rounded-[6px]');
    expect(devShell).toContain("min-w-0 max-w-none overflow-hidden");
    expect(devShell).toContain("max-w-full overflow-x-auto");
    expect(devShell).toContain("break-all");
  });

  it("DevShell Issue 身份按当前、最近、平台缓存和未知 ID 依次降级", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("function resolveDevIssueIdentity");
    expect(devShell).toContain("function DevIssueActor");
    expect(devShell).toContain("currentUser");
    expect(devShell).toContain("recentUsers");
    expect(devShell).toContain("platformUsers");
    expect(devShell).toContain("displayName?.trim() || user.name?.trim() || user.id");
    expect(devShell).toContain('displayName: userId || "未知用户"');
    expect(devShell).toContain("avatarUrl: null");
    expect(devShell).toContain("@{identity.id || \"未知\"}");
    expect(devShell).toContain("getDevIssueIdentityInitial(identity)");
    expect(devShell).toContain("platformUsers={platformUsers}");
    expect(devShell).toContain("recentUsers={devContext?.recentUsers ?? []}");
  });

  it("DevShell Issue composer 支持 Markdown 编辑预览和评论状态动作", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("function DevIssueComposer");
    expect(devShell).toContain('useState<"edit" | "preview">("edit")');
    expect(devShell).toContain(">编辑</button>");
    expect(devShell).toContain(">预览</button>");
    expect(devShell).toContain("评论并关闭");
    expect(devShell).toContain("重新打开并评论");
    expect(devShell).toContain("statusAction");
    expect(devShell).toContain('stateReason: statusAction === "close" ? closeReason : undefined');
    expect(devShell).toContain("/comments");
  });

  it("DevShell Markdown 工具栏同步命令、选择区、快捷键和附件队列契约", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("type DevIssueMarkdownCommand");
    expect(devShell).toContain("function applyDevIssueMarkdownCommand");
    for (const command of ["heading", "bold", "italic", "quote", "code", "link", "bullet-list", "ordered-list", "task-list"]) {
      expect(devShell).toContain(`command: "${command}"`);
    }
    for (const label of ["标题格式", "粗体", "斜体", "引用", "行内代码", "链接", "无序列表", "有序列表", "任务列表"]) {
      expect(devShell).toContain(`label: "${label}"`);
    }
    expect(devShell).toContain("data-localapp-issue-editor");
    expect(devShell).toContain("data-localapp-issue-toolbar");
    expect(devShell).toContain("flex-wrap");
    expect(devShell).toContain("overflow-x-hidden");
    expect(devShell).toContain("sm:flex-nowrap");
    expect(devShell).toContain("sm:overflow-x-auto");
    expect(devShell).toContain("const toolbarButtonRefs = useRef<Array<HTMLButtonElement | null>>([])");
    expect(devShell).toContain("const [toolbarFocusIndex, setToolbarFocusIndex] = useState(0)");
    expect(devShell).toContain("handleDevIssueToolbarKeyDown");
    expect(devShell).toContain('event.key === "Home"');
    expect(devShell).toContain('event.key === "End"');
    expect(devShell).toContain('event.key === "ArrowLeft" || event.key === "ArrowUp"');
    expect(devShell).toContain('tabIndex={toolbarFocusIndex === index ? 0 : -1}');
    expect(devShell).toContain("onFocus={() => setToolbarFocusIndex(index)}");
    expect(devShell).toContain('role="tablist" aria-label="Markdown 模式"');
    expect(devShell).toContain('role="tab" aria-selected={mode === "edit"}');
    expect(devShell).toContain('role="tabpanel"');
    expect(devShell).toContain('event.key === "ArrowRight"');
    expect(devShell).toContain('event.key === "ArrowLeft"');
    expect(devShell).toContain("data-localapp-issue-attachment-queue");
    expect(devShell).toContain('aria-busy={hasUploadingIssueAttachments || undefined}');
    expect(devShell).toContain('role="status" aria-label="附件队列状态" aria-live="polite" aria-atomic="true"');
    expect(devShell).toContain('role="status" aria-label={`${attachment.fileName} 已上传`}');
    expect(devShell).toContain("已上传 · {formatDevIssueFileSize(attachment.fileSize)}");
    expect(devShell).toContain('<Check className="h-3.5 w-3.5"');
    expect(devShell).toContain("function devIssueAttachmentMarkdown(");
    expect(devShell).toContain("DEV_ISSUE_MARKDOWN_PUNCTUATION");
    expect(devShell).toContain("Array.from(attachment.file_name, (character)");
    expect(devShell).toContain('DEV_ISSUE_MARKDOWN_PUNCTUATION.has(character) ? `\\\\${character}` : character');
    expect(devShell).toContain("function removeDevIssueAttachmentMarkdown(");
    expect(devShell).toContain("setBody((current) => removeDevIssueAttachmentMarkdown(current, attachment.attachment))");
    expect(devShell).toContain('aria-live="polite"');
    expect(devShell).toContain("textarea.selectionStart");
    expect(devShell).toContain("textarea.selectionEnd");
    expect(devShell).toContain("textarea.setSelectionRange");
    expect(devShell).toContain("event.ctrlKey || event.metaKey");
    expect(devShell).toContain("h-11 rounded px-3 text-xs font-medium sm:h-7");
    expect(devShell).toContain("h-11 w-11 shrink-0 sm:h-8 sm:w-8");
    expect(devShell).toContain("h-11 sm:h-8");
    expect(devShell).toContain('event.key.toLowerCase() === "b"');
    expect(devShell).toContain('event.key.toLowerCase() === "i"');
    expect(devShell).toContain('event.key.toLowerCase() === "k"');
  });

  it("DevShell 同步多标签、负责人、本人订阅与动态筛选契约", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("interface DevIssueCollaborationMetadata");
    expect(devShell).toContain("/api/issues/labels?");
    expect(devShell).toContain('kind: "labels" | "assignees" | "subscription" | "milestone" | "lock"');
    expect(devShell).toContain('label === "Labels" ? "标签" : "负责人"');
    expect(devShell).toContain('aria-label={`编辑${localizedLabel}`}');
    expect(devShell).toContain(">通知</h4>");
    expect(devShell).toContain("取消订阅");
    expect(devShell).toContain("availableLabels.map");
    expect(devShell).toContain("collaboration?.assignee_ids");
    expect(devShell).toContain("collaboration?.subscriber_ids");
    expect(devShell).toContain('aria-label="Issue 元数据状态"');
    expect(devShell).toContain('aria-live="polite"');
    expect(devShell).toContain("localMetadataError");
    expect(devShell).toContain('role="alert" className="rounded');
  });

  it("DevShell 使用列表快捷键且不劫持编辑控件", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("issueSearchInputRef");
    expect(devShell).toContain('event.key === "/"');
    expect(devShell).toContain('event.key.toLowerCase() === "c"');
    expect(devShell).toContain("target.isContentEditable");
    expect(devShell).toContain('["INPUT", "TEXTAREA", "SELECT"]');
    expect(devShell).toContain("issueSearchInputRef.current?.focus()");
    expect(devShell).toContain('setView({ kind: "create",');
  });

  it("DevShell reporter 编辑标题正文，owner 单独编辑 label，评论仍只允许作者管理", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("canEditIssueContent");
    expect(devShell).toContain("user?.id === detail.issue.reporter_id");
    expect(devShell).toContain("canEditIssueType");
    expect(devShell).toContain('user?.role === "owner"');
    expect(devShell).toContain("canEditIssueContent || canEditIssueType");
    expect(devShell).toContain("编辑 Issue");
    expect(devShell).toContain("保存 Issue");
    expect(devShell).toContain("DEV_ISSUE_TITLE_MAX_CHARACTERS = 256");
    expect(devShell).toContain("Array.from(createTitle.trim()).length");
    expect(devShell).toContain("Array.from(title.trim()).length");
    expect(devShell).toContain("Issue 标题不能超过 256 个字符");
    expect(devShell).toContain('aria-invalid={createTitleTooLong || undefined}');
    expect(devShell).toContain('data-localapp-issue-create-title aria-label="标题"');
    expect(devShell).toContain('aria-invalid={titleTooLong || undefined}');
    expect(devShell).toContain("{createTitleCharacterCount} / {DEV_ISSUE_TITLE_MAX_CHARACTERS}");
    expect(devShell).toContain('textareaLabel="编辑 Issue 正文" placeholder="更新 Issue 描述" submitLabel="保存 Issue"');
    expect(devShell).toContain('placeholder="更新 Issue 描述"');
    expect(devShell).toContain('placeholder="更新评论"');
    expect(devShell).toContain('placeholder="留下评论"');
    expect(devShell).toContain('placeholder="详细描述问题、复现步骤或期望结果"');
    expect(devShell).toContain("placeholder?: string;");
    expect(devShell).toContain("placeholder={resolvedPlaceholder}");
    expect(devShell).toContain('textareaLabel.includes("评论")');
    expect(devShell).toContain('draftId={`edit-issue-${detail.issue.id}`}');
    expect(devShell).toContain("saveIssue(body, attachmentIds, draftId)");
    expect(devShell).toContain("canEditIssueContent &&");
    expect(devShell).toContain("canEditIssueType &&");
    expect(devShell).toContain('aria-label="编辑 Issue 类型"');
    expect(devShell).toContain("canEditIssueType ? { issueType: editingIssueType }");
    expect(devShell).toContain('user.id === detail.issue.reporter_id || user.role === "owner"');
    expect(devShell).toContain("comment.author_id === currentUserId");
    expect(devShell).toContain("编辑评论");
    expect(devShell).toContain('textareaLabel="编辑评论内容" placeholder="更新评论" submitLabel="保存评论"');
    expect(devShell).toContain('draftId={`edit-comment-${comment.id}`}');
    expect(devShell).toContain("onCancel={() => { clearCommentDraft(comment.id, true); setEditingCommentId(null); setEditingCommentVersion(null); setRemovedCommentAttachmentIds([]); }}");
    expect(devShell).toContain("删除评论");
    expect(devShell).toContain('role="alertdialog" aria-label="删除评论确认"');
    expect(devShell).toContain("取消删除");
    expect(devShell).toContain("确认删除评论");
    expect(devShell).toContain("deleteCommentCancelRef");
    expect(devShell).toContain('event.key === "Escape"');
    expect(devShell).toContain("restoreDeleteCommentTriggerFocus");
    expect(devShell).toContain("contentMissing || submitDisabled");
    expect(devShell).toContain("allowEmpty={visibleCommentAttachments.length > 0}");
    expect(devShell).toContain("<DevIssueAttachmentLinks attachments={visibleCommentAttachments}");
    expect(devShell).toContain("移除现有附件");
    expect(devShell).toContain("removedAttachmentIds");
    expect(devShell).toContain("removedIssueAttachmentIds");
    expect(devShell).toContain("visibleIssueAttachments");
    expect(devShell).toContain("issueAttachmentRemoveRequest");
    expect(devShell).toContain("removeTextRequest={issueAttachmentRemoveRequest}");
    expect(devShell).toContain("/comments/${commentId}");
    expect(devShell).toContain('method: "DELETE"');
  });

  it("DevShell Issue composer 支持选择、拖拽和粘贴附件及其上传生命周期", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("handleIssueFiles");
    expect(devShell).toContain("handleIssueDrop");
    expect(devShell).toContain("handleIssuePaste");
    expect(devShell).toContain('type="file"');
    expect(devShell).toContain('data-testid="issue-attachment-input"');
    expect(devShell).toContain('data-testid="issue-attachment-input" hidden type="file"');
    expect(devShell).not.toContain('data-testid="issue-attachment-input" aria-label="添加附件"');
    expect(devShell).toContain("拖拽文件或粘贴截图");
    expect(devShell).toContain("new FormData()");
    expect(devShell).toContain("/api/issues/attachments");
    expect(devShell).toContain('status: "uploading"');
    expect(devShell).toContain('status: "uploaded"');
    expect(devShell).toContain('status: "error"');
    expect(devShell).toContain("URL.createObjectURL");
    expect(devShell).toContain("URL.revokeObjectURL");
    expect(devShell).toContain("移除 ${attachment.fileName}");
    expect(devShell).toContain("重试 ${attachment.fileName}");
    expect(devShell).toContain("h-11 w-11 shrink-0 sm:h-7 sm:w-7");
    expect(devShell).toContain("单个附件不能超过 25 MiB");
    expect(devShell).toContain("DEV_ISSUE_MAX_DRAFT_ATTACHMENTS = 20");
    expect(devShell).toContain("const acceptedFiles = files.slice(0, remainingCapacity)");
    expect(devShell).toContain("files.length - acceptedFiles.length");
    expect(devShell).toContain("每个草稿最多添加 20 个附件；已忽略");
    expect(devShell).toContain("setAttachmentLimitError(null)");
    expect(devShell).toContain("const [attachmentsExpanded, setAttachmentsExpanded] = useState(false)");
    expect(devShell).toContain("DEV_ISSUE_VISIBLE_UPLOADED_ATTACHMENTS = 4");
    expect(devShell).toContain("attachment.status !== \"uploaded\"");
    expect(devShell).toContain("显示其余 ${hiddenUploadedAttachmentCount} 个已上传附件");
    expect(devShell).toContain('aria-expanded={attachmentsExpanded}');
    expect(devShell).toContain('aria-controls={attachmentListId}');
    expect(devShell).toContain("收起已上传附件");
    expect(devShell).toContain("const addAttachmentButtonRef = useRef<HTMLButtonElement | null>(null)");
    expect(devShell).toContain("const attachmentRemoveButtonRefs = useRef(new Map<string, HTMLButtonElement>())");
    expect(devShell).toContain("visibleAttachments.findIndex((item) => item.clientId === attachment.clientId)");
    expect(devShell).toContain("window.requestAnimationFrame(() =>");
    expect(devShell).toContain("attachmentRemoveButtonRefs.current.get(nextAttachmentId)");
    expect(devShell).toContain("addAttachmentButtonRef.current");
  });

  it("DevShell 新建 Issue 表单使用移动触控尺寸和桌面紧凑尺寸", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const createStart = devShell.indexOf('{view.kind === "create" && (');
    const createForm = devShell.slice(createStart, devShell.indexOf('{view.kind === "detail" && (', createStart));

    expect(createForm).toContain("block h-11 w-full rounded");
    expect(createForm).toContain("sm:h-9");
    expect(createForm).toContain("h-11 rounded px-3 text-xs font-medium sm:h-8");
    expect(createForm).toContain("`${DEV_OUTLINE_BUTTON} h-11 sm:h-8`");
    expect(createForm).toContain('data-localapp-issue-create-workspace className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(240px,1fr)] lg:gap-6"');
    expect(createForm).toContain('data-localapp-issue-create-main className="min-w-0 space-y-4"');
    expect(createForm).toContain('data-localapp-issue-create-triage aria-label="Issue 分诊" className="min-w-0 space-y-4 border-t border-localapp-dev-border pt-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0"');
    expect(createForm.indexOf("data-localapp-issue-create-main")).toBeLessThan(createForm.indexOf("data-localapp-issue-create-triage"));
  });

  it("DevShell 按应用、用户和 Issue 隔离会话草稿并在提交后清理", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("localapp:issues:draft:v1");
    expect(devShell).toContain("sessionStorage.getItem");
    expect(devShell).toContain("sessionStorage.setItem");
    expect(devShell).toContain("sessionStorage.removeItem");
    expect(devShell).toContain('persistenceKey={`${issueDraftPrefix}:comment:${detail.issue.id}:body`}');
    expect(devShell).toContain('title || issueType !== "task"');
    expect(devShell).toContain("pendingIssueFocusIdRef");
  });

  it("DevShell 恢复 Issue 与评论编辑草稿时保留原并发版本", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain(":edit:${detail.issue.id}:meta");
    expect(devShell).toContain(":edit:${detail.issue.id}:body");
    expect(devShell).toContain('commentDraftKey(comment.id, "version")');
    expect(devShell).toContain("preferPersistedDraft");
    expect(devShell).toContain("expectedUpdatedAt: editingIssueVersion");
  });

  it("DevShell 在编辑上下文内提示并允许局部丢弃已恢复草稿", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("已恢复上次未完成的编辑");
    expect(devShell).toContain("丢弃已恢复草稿");
    expect(devShell).toContain("restoredIssueDraft");
    expect(devShell).toContain("restoredCommentDraft");
    expect(devShell).toContain("clearCommentDraft(comment.id)");
    expect(devShell).toContain("const bodyKey = commentDraftKey(commentId, \"body\")");
    expect(devShell).toContain("discardDevIssueAttachmentDraft(pagePath, issueEditBodyKey)");
    expect(devShell).toContain("window.sessionStorage.removeItem(key)");
    expect(devShell).toContain("discardDevIssueAttachmentDraft(pagePath, bodyKey)");
    expect(devShell).toContain("discardDevIssueAttachmentDraft(pagePath, issueEditBodyKey)");
    expect(devShell).toContain('method: "DELETE"');
    expect(devShell).toContain("releaseDevIssueAttachment(pagePath, attachment)");
    expect(devShell).toContain('className="mb-3 flex flex-wrap items-center justify-between');
    expect(devShell).toContain('role="alertdialog" aria-label="丢弃草稿确认"');
    expect(devShell).toContain("未提交内容和已上传附件将被清除且无法恢复");
    expect(devShell).toContain("保留草稿");
    expect(devShell).toContain("确认丢弃");
    expect(devShell).toContain('event.key === "Escape"');
    expect(devShell).toContain("discardDraftCancelRef.current?.focus()");
    expect(devShell).toContain("discardDraftTriggerRef.current?.focus()");
  });

  it("DevShell 对齐 Issue 搜索和 Markdown 预览高频快捷键", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain('event.key === "/" && (event.metaKey || event.ctrlKey)');
    expect(devShell).toContain('aria-keyshortcuts="Meta+/ Control+/"');
    expect(devShell).toContain('aria-label="清除 Issue 搜索"');
    expect(devShell).not.toContain('role="combobox" aria-expanded={visibleSearchSuggestions.length > 0}');
    expect(devShell).toContain("[&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none");
    expect(devShell).toContain("const clearIssueSearch = () =>");
    expect(devShell).toContain('if (event.key === "Escape" && searchInput)');
    expect(devShell).toContain('updateIssueQuery({ q: "", searchIn: "", offset: 0 })');
    expect(devShell).toContain('issueSearchInputRef.current?.focus()');
    expect(devShell).toContain('aria-keyshortcuts="Alt+ArrowLeft"');
    expect(devShell).toContain('aria-keyshortcuts="C"');
    expect(devShell).toContain('aria-keyshortcuts="Escape"');
    expect(devShell).toContain("data-localapp-issue-link");
    expect(devShell).toContain('aria-keyshortcuts="J K ArrowDown ArrowUp O Enter"');
    expect(devShell).toContain('const issueFilterShortcutLabels: Record<string, string> = { u: "按创建者筛选", l: "按标签筛选", m: "按里程碑筛选", a: "按负责人筛选" }');
    expect(devShell).toContain('aria-keyshortcuts="U"');
    expect(devShell).toContain('aria-keyshortcuts="L"');
    expect(devShell).toContain('aria-keyshortcuts="M"');
    expect(devShell).toContain('aria-keyshortcuts="A"');
    const issueTitleLink = devShell.split("<a href={createDevIssueHref(issue.id)} data-localapp-issue-link")[1]?.split("</a>")[0] ?? "";
    expect(issueTitleLink).toContain("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus");
    expect(devShell).toContain('querySelectorAll<HTMLAnchorElement>("[data-localapp-issue-link]")');
    expect(devShell).toContain('issueNavigationKey === "j"');
    expect(devShell).toContain('issueNavigationKey === "k"');
    expect(devShell).toContain('event.key === "ArrowDown"');
    expect(devShell).toContain('event.key === "ArrowUp"');
    expect(devShell).toContain("links.includes(document.activeElement as HTMLAnchorElement)");
    expect(devShell).toContain('event.key === "ArrowLeft" && event.altKey');
    expect(devShell).toContain("!nestedDialog");
    expect(devShell).toContain('event.key.toLowerCase() === "p" && event.shiftKey');
    expect(devShell).toContain('aria-keyshortcuts="Meta+Shift+P Control+Shift+P"');
    expect(devShell).toContain('if (event.key === "Escape" && visibleSearchSuggestions.length > 0) { event.preventDefault(); event.stopPropagation();');
  });

  it("DevShell Issue 附件以受控 URL 渲染图片预览和普通文件链接", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("isDevIssueSafeImage");
    expect(devShell).toContain("attachment.url");
    expect(devShell).not.toContain("attachments/${attachment.id}?${new URLSearchParams");
    expect(devShell).toContain("attachment.comment_id === comment.id");
    expect(devShell).toContain("attachment.issue_id === detail.issue.id && attachment.comment_id === null");
    expect(devShell).toContain("alt={attachment.file_name}");
    expect(devShell).toContain("formatDevIssueFileSize");
  });

  it("DevShell 阅读态过滤 Markdown 已引用附件且保留编辑态管理", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("function collectReferencedDevIssueAttachmentIds(");
    expect(devShell).toContain('node.type === "image" || node.type === "link"');
    expect(devShell).toContain("function filterUnreferencedDevIssueAttachments(");
    expect(devShell).toContain("const unreferencedCommentAttachments = filterUnreferencedDevIssueAttachments(comment.body, commentAttachments)");
    expect(devShell).toContain("<DevIssueAttachmentLinks attachments={unreferencedCommentAttachments}");
    expect(devShell).toContain('filterUnreferencedDevIssueAttachments(detail.issue.description ?? "", detail.attachments.filter');
    expect(devShell).toContain("<DevIssueAttachmentLinks attachments={visibleCommentAttachments} onRemove=");
    expect(devShell).toContain("<DevIssueAttachmentLinks attachments={visibleIssueAttachments} onRemove=");
  });

  it("DevShell 只向具状态权限的用户显示评论并关闭或重开", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("canChangeStatus={canManageIssue}");
    expect(devShell).toContain("canChangeStatus?: boolean");
    expect(devShell).toContain('canChangeStatus && status === "open"');
    expect(devShell).toContain('canChangeStatus && status === "closed"');
  });

  it("statusAction 成功后同步详情并刷新服务端权威列表", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("syncIssueStatusAcrossViews");
    expect(devShell).toContain("current.map((issue) => issue.id === updatedIssue.id ? updatedIssue : issue)");
    expect(devShell).toContain("await Promise.all([loadIssueDetail(issue.id), fetchIssues(query)])");
    expect(devShell).toContain("requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/comments`");
    expect(devShell).toContain("syncIssueDetailAcrossViews(commentDetail)");
    expect(devShell).not.toContain("commentResult.issue");
    expect(devShell).toContain("onIssuesChanged()");
    expect(devShell).not.toContain("setStatus(nextStatus)");
  });

  it("DELETE comment 使用 pagePath query 且不发送 JSON body", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const start = devShell.indexOf("const deleteComment");
    const end = devShell.indexOf("const deleteCurrentIssue", start);
    const deleteComment = devShell.slice(start, end);

    expect(deleteComment).toContain("new URLSearchParams({ pagePath })");
    expect(deleteComment).toContain("/comments/${commentId}?${requestQuery.toString()}");
    expect(deleteComment).toContain('method: "DELETE"');
    expect(deleteComment).not.toContain('headers: { "Content-Type": "application/json" }');
    expect(deleteComment).not.toContain("body: JSON.stringify");
  });

  it("composer 在附件上传中或失败时显示错误并拒绝任何提交", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("hasBlockingIssueAttachments");
    expect(devShell).toContain('attachment.status === "uploading"');
    expect(devShell).toContain('attachment.status === "error"');
    expect(devShell).toContain("请移除或重试上传失败的附件");
    expect(devShell).toContain("if (hasBlockingIssueAttachments) return");
    expect(devShell).toContain("disabled={submitting || hasBlockingIssueAttachments || contentMissing || submitDisabled}");
    expect(devShell).toContain('attachment.status === "uploading" && <LoaderCircle className="h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />');
    expect(devShell).not.toContain('className="animate-pulse text-localapp-dev-muted-foreground">上传中</span>');
    expect(devShell).toContain('<Upload className="h-3.5 w-3.5" aria-hidden="true" />添加附件');
    expect(devShell).toContain('title={`重试 ${attachment.fileName}`}');
    expect(devShell).toContain('<RotateCw className="h-3.5 w-3.5" aria-hidden="true" />');
    expect(devShell).toContain('title={`移除 ${attachment.fileName}`}');
    expect(devShell).toContain('<Trash2 className="h-3.5 w-3.5" aria-hidden="true" />');
    expect(devShell).toContain("h-11 w-11 shrink-0 sm:h-7 sm:w-7");
  });

  it("附件上传只接受最新代次，且提交、移除和卸载均使旧结果失效", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("issueAttachmentUploadGenerationsRef");
    expect(devShell).toContain("nextIssueAttachmentUploadGeneration");
    expect(devShell).toContain("issueAttachmentUploadGenerationsRef.current.get(pending.clientId) !== generation");
    expect(devShell).toContain("uploadIssueAttachment(pending, nextIssueAttachmentUploadGeneration(pending.clientId))");
    expect(devShell).toContain("nextIssueAttachmentUploadGeneration(attachment.clientId)");
    expect(devShell).toContain("issueAttachmentUploadGenerationsRef.current.clear()");
    expect(devShell).toContain("revokeDevIssueAttachmentPreview");
    expect(devShell).toContain("releaseDevIssueAttachments");
    expect(devShell).toContain("releaseDevIssueAttachments(attachments)");
  });

  it("DevShell 只持久化已上传附件并恢复原 draftId", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("readDevIssueAttachmentDraft");
    expect(devShell).toContain("writeDevIssueAttachmentDraft");
    expect(devShell).toContain('attachment.url.startsWith("/api/issues/attachments/")');
    expect(devShell).toContain('item.status === "uploaded" && item.attachment');
    expect(devShell).toContain("initialAttachmentDraft?.draftId ?? draftId");
    expect(devShell).toContain("draftId: activeDraftId");
    expect(devShell).toContain("fileName: attachment.file_name");
    expect(devShell).toContain("previewUrl: isDevIssueSafeImage(attachment.mime_type) ? attachment.url : null");
  });

  it("Issue 工作台关闭时恢复 opener 焦点并限制 Tab 在 dialog 内", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("DEV_ISSUE_FOCUSABLE_SELECTOR");
    expect(devShell).toContain("previouslyFocused");
    expect(devShell).toContain("previouslyFocused.focus()");
    expect(devShell).toContain('event.key === "Tab"');
    expect(devShell).toContain("focusableElements[0]");
    expect(devShell).toContain("focusableElements[focusableElements.length - 1]");
  });

  it("Issue 工作台与遮罩只铺满应用内容区并移除小窗宽度限制", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const start = devShell.indexOf("function DevIssuesWorkspace");
    const end = devShell.indexOf("function DevIssueStatusIcon", start);
    const workspace = devShell.slice(start, end);

    expect(workspace).toContain("data-localapp-issues-layer");
    expect(workspace).toContain("absolute inset-0");
    expect(workspace).toContain("h-full w-full");
    expect(workspace).toContain("sm:p-2");
    expect(workspace).not.toContain("fixed inset-0");
    expect(workspace).not.toContain("max-w-[680px]");
    expect(workspace).not.toContain("max-h-[calc(100vh-2rem)]");
    expect(workspace).toContain('className="pointer-events-none absolute inset-0 bg-black/45"');
    expect(workspace).not.toContain('className="absolute inset-0 bg-black/45" aria-hidden="true" onClick={onClose}');
  });

  it("DevShell 用保留查询参数同步 Issue 直达与浏览器历史", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain('const DEV_ISSUE_DEEP_LINK_PARAM = "localappIssueId"');
    expect(devShell).toContain("readDevIssueDeepLinkId");
    expect(devShell).toContain("updateDevIssueDeepLinkUrl");
    expect(devShell).toContain('window.addEventListener("popstate"');
    expect(devShell).toContain("selectedIssueId={selectedIssueId}");
    expect(devShell).toContain("onIssueNavigate={navigateToIssue}");
    expect(devShell).toContain("url.searchParams.delete(DEV_ISSUE_DEEP_LINK_PARAM)");
    expect(devShell).toContain("deepLinkAttemptKeyRef");
    expect(devShell).toContain('const attemptKey = `${pagePath}:${selectedIssueId}`');
  });

  it("DevShell Issue 列表使用原生链接并在详情提供复制入口", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(workspace).toContain("<a href={createDevIssueHref(issue.id)}");
    expect(workspace).toContain("isPlainDevIssueLinkClick(event)");
    expect(workspace).toContain("flex min-h-11 max-w-full items-center");
    const issueRow = workspace.split("data-localapp-issue-row")[1]?.split(">{canBulkManage")[0] ?? "";
    expect(issueRow).toContain("focus-within:bg-localapp-dev-muted");
    expect(workspace).toContain("sm:min-h-6");
    expect(workspace).toContain("(issue.comment_count ?? 0) > 0");
    expect(workspace).toContain('aria-label={`${issue.issue_number} 的评论数 ${issue.comment_count}`}');
    const commentCountLink = workspace.split('aria-label={`${issue.issue_number} 的评论数 ${issue.comment_count}`}')[1]?.split("</a>")[0] ?? "";
    expect(commentCountLink).toContain("focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-localapp-dev-focus");
    expect(workspace).toContain('aria-hidden="true" className="h-11 w-11 shrink-0');
    expect(workspace).toContain("sm:h-6 sm:w-10");
    expect(workspace).toContain("event.preventDefault()");
    expect(detail).toContain('aria-label={linkCopied ? "已复制 Issue 链接" : "复制 Issue 链接"}');
    expect(detail).toContain("flex shrink-0 items-center gap-1");
    expect(detail).toContain("h-11 w-11 sm:h-8 sm:w-8");
    expect(detail).toContain("copyDevIssueUrl(createDevIssueHref(detail.issue.id))");
    expect(detail).toContain("无法复制 Issue 链接");
  });

  it("DevShell 为 Issue 正文和评论提供与 Platform 同构的 reactions", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    const reactions = devShell.slice(devShell.indexOf("const DEV_ISSUE_REACTION_EMOJI"), devShell.indexOf("function DevIssueTimeline"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(devShell).toContain('const DEV_ISSUE_REACTION_CONTENTS = ["+1", "-1", "laugh", "hooray", "confused", "heart", "rocket", "eyes"] as const');
    expect(workspace).toContain("/reactions`");
    expect(workspace).toContain("content, reacted");
    expect(reactions).toContain("data-localapp-issue-reactions");
    expect(reactions).toContain('aria-label="添加表态"');
    expect(devShell).toContain("SmilePlus");
    expect(reactions).toContain('<SmilePlus aria-hidden="true" className="h-4 w-4" />');
    expect(reactions).toContain('aria-haspopup="menu"');
    expect(reactions).toContain('role="menu"');
    expect(reactions).toContain('role="menuitemcheckbox"');
    expect(reactions).toContain('aria-checked={selected}');
    expect(reactions).toContain('selected ? "取消" : "添加"');
    expect(reactions).toContain('void toggle(content, !selected)');
    expect(reactions).toContain('["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"]');
    expect(reactions).toContain('event.key === "Escape"');
    expect(reactions).toContain("reactionTriggerRef.current?.focus()");
    expect(reactions).not.toContain("if (additionsDisabled) currentUserId = undefined");
    expect(reactions).toContain("disabled={pendingContent !== null || (additionsDisabled && !selected)}");
    expect(reactions).toContain("{currentUserId && !additionsDisabled && <>");
    expect(reactions).toContain("return currentUserId");
    expect(reactions).toContain("${count} 个表态");
    expect(reactions).toContain('aria-label="选择表态"');
    expect(reactions).toContain('${selected ? "取消" : "添加"} ${DEV_ISSUE_REACTION_EMOJI[content]} 表态');
    expect(reactions).toContain("onToggleReaction(content, reacted");
    expect(reactions).toContain("if (additionsDisabled || !currentUserId) setPickerOpen(false)");
    expect(reactions).toContain("if (additionsDisabled || !currentUserId) setReactionError");
    expect(reactions).toContain("const [reactionError, setReactionError]");
    expect(reactions).toContain('role="alert"');
    expect(reactions).toContain(': <span key={content} aria-label={label}');
    expect(reactions).toContain("h-11 min-w-11");
    expect(reactions).toContain("h-11 w-11 rounded-full");
    expect(reactions).toContain("h-11 w-11 text-base sm:h-8 sm:w-8");
    expect(reactions).toContain("bottom-12");
    expect(reactions).toContain("sm:bottom-9");
    expect(reactions).not.toContain("top-12");
    expect(reactions).not.toContain('<span aria-hidden="true">＋</span>');
    expect(detail).toContain("reactions={detail.reactions ?? []}");
    expect(detail).toContain("onToggleReaction={onToggleReaction}");
  });

  it("DevShell 提供完全离线的 Issue 对话锁定状态和操作", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("locked_at?: string | null");
    expect(devShell).toContain("locked_by?: string | null");
    expect(devShell).toContain('updateIssueCollaboration("lock", { locked, ...(locked && reason ? { reason } : {}) })');
    expect(devShell).toContain('aria-label={detail.issue.locked_at ? "解锁对话" : "锁定对话"}');
    expect(devShell).toContain("对话已锁定");
    expect(devShell).toContain('event.event_type === "locked"');
    expect(devShell).toContain('event.event_type === "unlocked"');
    expect(devShell).toContain('role="dialog" aria-modal="true" aria-labelledby="dev-issue-lock-title"');
    expect(devShell).toContain('aria-label="锁定原因"');
    expect(devShell).toContain("const lockDialogRef = useRef<HTMLDivElement | null>(null)");
    expect(devShell).toContain("dialog.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled])')");
    expect(devShell).toContain('event.key !== "Tab"');
    expect(devShell).toContain("document.activeElement === first");
    expect(devShell).toContain("document.activeElement === last");
    expect(devShell).toContain("window.requestAnimationFrame(() => window.requestAnimationFrame(() => lockTriggerRef.current?.focus()))");
    expect(devShell).toContain("DEV_ISSUE_LOCK_REASON_LABELS");
    expect(devShell).toContain('onToggleLock(true, lockReason)');
  });

  it("DevShell 折叠同一用户连续编辑事件并保留可展开的原始时间", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("function groupDevIssueTimeline(");
    expect(devShell).toContain('next.event.actor_id !== item.event.actor_id');
    expect(devShell).toContain("function DevIssueEditEventGroup(");
    expect(devShell).toContain('aria-expanded={expanded}');
    expect(devShell).toContain('编辑了此 Issue {item.events.length} 次');
    expect(devShell).toContain('visibleDisplayTimeline.map((item) => item.kind === "event-group"');
  });

  it("DevShell 折叠连续历史事件批次并可展开完整动作", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('groupType: "edited" | "history"');
    expect(devShell).toContain("DEV_ISSUE_HISTORY_BATCH_THRESHOLD = 4");
    expect(devShell).toContain('groupType: "history"');
    expect(devShell).toContain("function DevIssueHistoryEventGroup(");
    expect(devShell).toContain('aria-label={`历史更新明细，共 ${item.events.length} 项`}');
    expect(devShell).toContain("devIssueEventText(event, identities)");
    expect(devShell).toContain("<DevIssueTime timestamp={event.created_at} precise />");
  });

  it("DevShell 提供完全离线的时间线活动筛选、计数和空态", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('type DevIssueTimelineFilter = "all" | "comments" | "history"');
    expect(devShell).toContain("function filterDevIssueTimeline(");
    expect(devShell).toContain('role="radiogroup" aria-label="筛选时间线活动"');
    expect(devShell).toContain('className="shrink-0 whitespace-nowrap text-xs font-medium text-localapp-dev-muted-foreground">活动</span>');
    expect(devShell).toContain('role="radiogroup" aria-label="筛选时间线活动" className="grid w-full grid-cols-3');
    expect(devShell).toContain('aria-label={`显示更早的 ${hiddenTimelineCount} 条活动`}');
    expect(devShell).toContain("DEV_ISSUE_TIMELINE_PAGE_SIZE = 20");
    expect(devShell).toContain("setVisibleActivityCount((count) => count + DEV_ISSUE_TIMELINE_PAGE_SIZE)");
    expect(devShell).toContain("hiddenTimelineCount <= DEV_ISSUE_TIMELINE_PAGE_SIZE");
    expect(devShell).toContain("revealEarlierRef.current?.focus()");
    expect(devShell).not.toContain("showAllActivity");
    expect(devShell).toContain('className="mt-4 grid w-full grid-cols-2 gap-2 sm:ml-auto sm:w-fit');
    expect(devShell).toContain("h-11 rounded px-2.5 text-xs font-medium");
    expect(devShell).toContain("sm:h-7");
    expect(devShell).toContain('role="radio" aria-checked={activityFilter === option.value}');
    expect(devShell).toContain('tabIndex={activityFilter === option.value ? 0 : -1}');
    expect(devShell).toContain('event.key === "Home"');
    expect(devShell).toContain('event.key === "End"');
    expect(devShell).toContain('setActivityFilter("all")');
    expect(devShell).toContain('filterDevIssueTimeline(timeline, activityFilter)');
    expect(devShell).toContain('activityFilter === "comments" ? "还没有评论"');
  });

  it("DevShell 在正文和提交者评论中显示 Author 身份徽标", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("badge?: React.ReactNode");
    expect(devShell).toContain('badge={comment.author_id === reporterId ? "Author" : undefined}');
    expect(devShell).toContain('badge="Author"');
    expect(devShell).toContain('timestampHref={createDevIssueHref(detail.issue.id)}');
    expect(devShell).toContain('const localizedBadge = badge === "Author" ? "作者" : badge');
    expect(devShell).toContain('timestampSuffix.props.children === "edited"');
    expect(devShell).toContain('children: "已编辑"');
    expect(devShell).toContain('data-localapp-issue-actor-action className="shrink-0 self-start"');
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function revokeDevIssueAttachmentPreview"));
    expect(timeline).toContain('action={!comment.deleted_at ? <DevIssueActionMenu label="评论操作"');
    expect(timeline).not.toContain('flex flex-wrap items-center justify-between gap-2 border-b border-localapp-dev-border');
  });

  it("DevShell 在详情头部显示创建时间、可见评论数和首评链接", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));
    expect(detail).toContain('item is Extract<DevIssueTimelineItem, { kind: "comment" }>');
    expect(detail).toContain('<DevIssueTime timestamp={detail.issue.created_at} />');
    expect(detail).toContain('href={createDevIssueCommentHref(detail.issue.id, firstVisibleComment.comment.id)}');
    expect(detail).toContain("inline-flex h-11 items-center px-1");
    expect(detail).toContain('{visibleComments.length} 条评论');
    expect(detail).toContain('<span>0 条评论</span>');
    expect(detail).toContain("打开了此 Issue");
    expect(detail).toContain('className="inline-flex items-center gap-2 whitespace-nowrap"');
    expect(detail).toContain('className="hidden sm:inline" aria-hidden="true">·</span>');
  });

  it("DevShell 显示并局部丢弃新建与评论的恢复草稿", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer"), devShell.indexOf("function DevIssueDetailPanel"));
    expect(composer).toContain("showRestoredDraftNotice?: boolean");
    expect(composer).toContain("onDiscardRestoredDraft?: () => void");
    expect(composer).toContain("已恢复未提交的草稿");
    expect(composer).toContain("丢弃草稿");
    expect(composer).toContain("DevIssueDiscardDraftControl");
    expect(composer).toContain('writeDevIssueSessionDraft(persistenceKey, "")');
    expect(devShell).toContain("showRestoredDraftNotice restoredDraft={createWasRestoredDraft}");
    expect(devShell).toContain('writeDevIssueCreateDraft(createPersistenceKey, "", "task", [], [], null)');
    expect(devShell).toContain('persistenceKey={`${issueDraftPrefix}:comment:${detail.issue.id}:body`} showRestoredDraftNotice');
  });

  it("DevShell owner 可在创建时原子提交附加标签与负责人", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("const [createLabelIds, setCreateLabelIds]");
    expect(devShell).toContain("const [createAssigneeIds, setCreateAssigneeIds]");
    expect(devShell).toContain("data-localapp-create-metadata");
    expect(devShell).toContain('user?.role === "owner"');
    expect(devShell).toContain('labelIds: createLabelIds');
    expect(devShell).toContain("issueType, draftId, attachmentIds");
    expect(devShell).toContain('(["task", "bug", "feature"] as const)');
    expect(devShell).toContain("assigneeIds: createAssigneeIds");
    expect(devShell).toContain('id !== "bug" && id !== "feature"');
    expect(devShell).toContain("milestoneId: number | null");
    expect(devShell).toContain("Number.isSafeInteger(value?.milestoneId)");
    expect(devShell).toContain('milestoneCatalogLoaded && createMilestoneId !== null && !availableMilestones.some((item) => item.id === createMilestoneId)');
    expect(devShell).toContain("writeDevIssueCreateDraft(createPersistenceKey, createTitle, issueType, createLabelIds, createAssigneeIds, createMilestoneId)");
    expect(devShell).toContain('writeDevIssueCreateDraft(createPersistenceKey, "", "task", [], [], null)');
  });

  it("DevShell 将 Issue 类型作为独立的列表和 URL 筛选条件", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('issueType: "localappIssueType"');
    expect(devShell).toContain('requestQuery.set("type", nextQuery.issueType)');
    expect(devShell).toContain('aria-label="按类型筛选"');
    expect(devShell).toContain('<DevIssueTypeBadge issue={issue}');
    expect(devShell).toContain('DEV_ISSUE_TYPE_LABELS[detail.issue.issue_type ?? detail.issue.label]');
    expect(devShell).toContain('aria-label="设置 Issue 类型"');
    expect(devShell).toContain('onSetIssueType={(issueType) => onUpdateIssue({ issueType })}');
  });

  it("DevShell 为文件拖拽提供稳定激活态和无障碍提示", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer"), devShell.indexOf("function DevIssueDetailPanel"));
    expect(composer).toContain("const [dragActive, setDragActive] = useState(false)");
    expect(composer).toContain("const dragDepthRef = useRef(0)");
    expect(composer).toContain('includes("Files")');
    expect(composer).toContain('data-drag-active={dragActive ? "true" : undefined}');
    expect(composer).toContain('aria-label="附件拖拽状态"');
    expect(composer).toContain("松开以上传文件");
    expect(composer).toContain("dragDepthRef.current = 0");
  });

  it("DevShell 从评论引用创建独立的本地 Issue 草稿", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('label: "引用到新 Issue"');
    expect(devShell).toContain("referenceDevIssueComment(");
    expect(devShell).toContain("reference-comment:${source.issue.id}:${commentId}");
    expect(devShell).toContain("原评论保持不变，提交后将创建独立 Issue。");
    expect(devShell).toContain("onReferenceComment={onReferenceComment}");
    expect(devShell).toContain("onClick={cancelCreateIssue}");
    expect(devShell).toContain('`[data-localapp-issue-comment-id="${commentId}"] button[aria-label="评论操作"]`');
    expect(devShell).toContain("window.setTimeout(focusCommentMenu, 150)");
  });

  it("DevShell 自动揭示被活动筛选隐藏的有效评论深链", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function revokeDevIssueAttachmentPreview"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));
    expect(timeline).toContain("const selectedCommentVisible = Boolean(");
    expect(timeline).toContain('if (selectedCommentVisible) setActivityFilter("comments")');
    expect(timeline).toContain('activityFilter !== "comments"');
    expect(timeline).toContain("!item.comment.deleted_at");
    expect(detail).toContain('href={createDevIssueCommentHref(detail.issue.id, firstVisibleComment.comment.id)}');
  });

  it("DevShell 统一相对时间并保留精确语义提示", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("function formatDevIssueRelativeTime(");
    expect(devShell).toContain("function DevIssueTime(");
    expect(devShell).toContain("if (!Number.isFinite(milliseconds)) return timestamp");
    expect(devShell).toContain('<time dateTime={timestamp} title={exact}');
    expect(devShell).toContain('<DevIssueTime timestamp={timestamp} href={timestampHref}');
    expect(devShell).toContain("inline-flex h-11 items-center px-1");
    expect(devShell).toContain('<DevIssueTime timestamp={event.created_at} precise />');
    expect(devShell).toContain('<DevIssueTime timestamp={item.event.created_at} />');
    expect(devShell).toContain('<DevIssueTime timestamp={detail.issue.created_at} />');
    expect(devShell).toContain("<DevIssueListActivityTime issue={issue} />");
  });

  it("DevShell 以紧凑头像 roster 展示参与者和溢出计数", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("function DevIssueParticipantRoster(");
    expect(devShell).toContain("participantIds.slice(0, 8)");
    expect(devShell).toContain('aria-label="Issue 参与者"');
    expect(devShell).toContain('aria-label={`另外 ${overflow} 位参与者`}');
    expect(devShell).toContain("<DevIssueParticipantRoster participantIds={participantIds} identities={identities} />");
  });

  it("DevShell 将正文与评论低频动作收纳到同构操作菜单", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const actionMenu = devShell.slice(devShell.indexOf("function DevIssueActionMenu"), devShell.indexOf("const DEV_ISSUE_REACTION_EMOJI"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function revokeDevIssueAttachmentPreview"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(actionMenu).toContain('aria-haspopup="menu"');
    expect(actionMenu).toContain("const menuId = React.useId()");
    expect(actionMenu).toContain("aria-controls={menuId}");
    expect(actionMenu).toContain("id={menuId}");
    expect(actionMenu).toContain('role="menu"');
    expect(actionMenu).toContain('role="menuitem"');
    expect(actionMenu).toContain("h-11 w-11 sm:h-8 sm:w-8");
    expect(actionMenu).toContain("min-h-11");
    expect(actionMenu).toContain('event.key === "Escape"');
    expect(actionMenu).toContain('document.addEventListener("mousedown"');
    expect(actionMenu).toContain('document.addEventListener("keydown", onKeyDown, true)');
    expect(actionMenu).toContain("triggerRef.current?.focus()");
    expect(actionMenu).toContain('initialFocusRef = useRef<"first" | "last">("first")');
    expect(actionMenu).toContain('event.key !== "ArrowDown" && event.key !== "ArrowUp"');
    expect(devShell).toContain("restoreFocus?: boolean");
    expect(actionMenu).toContain("close(item.restoreFocus !== false)");
    expect(timeline).toContain('label: "复制评论链接"');
    expect(timeline).toContain('label: "引用回复", restoreFocus: false');
    expect(actionMenu).toContain('event.key === "Home"');
    expect(actionMenu).toContain('event.key === "End"');
    expect(actionMenu).toContain("startsWith(key)");
    expect(actionMenu).toContain("!item.disabled");
    expect(actionMenu).toContain("if (items.length === 0) setOpen(false)");
    expect(actionMenu).toContain("rootRef.current?.contains(document.activeElement)");
    expect(timeline).toContain('label="评论操作"');
    expect(timeline).toContain('label: "编辑评论"');
    expect(timeline).toContain('label: "删除评论", restoreFocus: false, destructive: true');
    expect(detail).toContain('label="Issue 操作"');
    expect(detail).toContain('label: "编辑 Issue"');
    expect(detail).toContain('label: "引用回复", restoreFocus: false');
    expect(detail).toContain("quoteDevIssueComment(detail.issue.description ?? \"\", detail.issue.reporter_id)");
    expect(detail).not.toContain('aria-label="编辑 Issue"');
  });

  it("DevShell 将评论引用追加到现有草稿并聚焦 composer", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function revokeDevIssueAttachmentPreview"));
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer"), devShell.indexOf("function DevIssueMetadata"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(devShell).toContain("function quoteDevIssueComment");
    expect(timeline).toContain('label: "引用回复"');
    expect(timeline).toContain("onQuoteComment(comment.body, comment.author_id)");
    expect(timeline).toContain('...(currentUserId && !interactionsLocked ? [{ label: "引用回复"');
    expect(composer).toContain("insertRequest");
    expect(composer).toContain('current.trim() ? `${current}\\n\\n${insertRequest.text}` : insertRequest.text');
    expect(composer).toContain('setMode("edit")');
    expect(composer).toContain("selectionRestorePendingRef.current = true");
    expect(detail).toContain("commentInsertRequest");
    expect(detail).toContain("onInsertRequestApplied");
  });

  it("DevShell 提供保留应用 URL 状态的评论 permalink 和直达定位", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function revokeDevIssueAttachmentPreview"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(devShell).toContain('const DEV_ISSUE_COMMENT_DEEP_LINK_PARAM = "localappIssueCommentId"');
    expect(devShell).toContain("readDevIssueCommentDeepLinkId");
    expect(devShell).toContain("updateDevIssueCommentDeepLinkUrl");
    expect(devShell).toContain("createDevIssueCommentHref");
    expect(timeline).toContain('label: "复制评论链接"');
    expect(timeline).toContain('aria-current={selectedCommentId === comment.id && !comment.deleted_at ? "location" : undefined}');
    expect(timeline).toContain("scrollIntoView?.({ block: \"center\" })");
    expect(timeline).toContain('aria-live="polite"');
    expect(detail).toContain("selectedCommentId={selectedCommentId}");
    expect(detail).toContain("getCommentHref");
    expect(detail).toContain("onCopyCommentLink");
  });

  it("DevShell 从保留 URL 参数恢复列表筛选并同步浏览器历史", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(devShell).toContain('q: "localappIssueQ"');
    expect(devShell).toContain('searchIn: "localappIssueIn"');
    expect(devShell).toContain('status: "localappIssueStatus"');
    expect(devShell).toContain("readDevIssueListQueryFromUrl");
    expect(devShell).toContain("updateDevIssueListQueryUrl");
    expect(workspace).toContain('historyMode: "push" | "replace" = "push"');
    expect(workspace).toContain('window.history[historyMode === "push" ? "pushState" : "replaceState"]');
    expect(workspace).toContain('window.addEventListener("popstate", restoreIssueListQuery)');
    expect(workspace).toContain('updateIssueQuery(parseDevIssueSearchInput(searchInput');
    expect(workspace).toContain("setSearchInput(formatDevIssueSearchInput(restored.q, restored.searchIn))");
    expect(workspace).toContain("return formatDevIssueSearchInput(restored.q, restored.searchIn)");
  });

  it("DevShell 搜索框解析 GitHub 风格限定词并同步结构化筛选", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const parser = devShell.slice(devShell.indexOf("function parseDevIssueSearchInput"), devShell.indexOf("function readDevIssueListMeta"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(parser).toContain('key === "is"');
    expect(parser).toContain('key === "in"');
    expect(parser).toContain('["title", "body", "comments"]');
    expect(parser).toContain('/^(locked|unlocked)$/i');
    expect(parser).toContain('key === "label"');
    expect(parser).toContain('key === "author" || key === "involves"');
    expect(parser).toContain('key === "milestone"');
    expect(parser).toContain('key === "mentions" && rawValue.toLowerCase() === "@me"');
    expect(parser).toContain('rawValue.toLowerCase() === "subscribed"');
    expect(parser).toContain('/^(assignee|label|milestone)$/i');
    expect(parser).toContain('/^(activity|created|updated|comments)-(asc|desc)$/i');
    expect(parser).toContain('rawValue.toLowerCase() === "@me"');
    expect(workspace).toContain("parseDevIssueSearchInput(searchInput");
    expect(workspace).toContain("milestones: availableMilestones");
    expect(workspace).toContain('setSearchInput(formatDevIssueSearchInput(updates.q, updates.searchIn ?? ""))');
    expect(workspace).toContain("updateIssueQuery(updates)");
  });

  it("DevShell 搜索框提供完全离线且键盘可访问的限定词建议", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(devShell).toContain("function getDevIssueSearchSuggestions(");
    expect(devShell).toContain("function applyDevIssueSearchSuggestion(");
    expect(workspace).toContain('role="listbox" aria-label="搜索限定词建议"');
    expect(workspace).toContain('role="option"');
    expect(workspace).toContain('event.key === "ArrowDown"');
    expect(workspace).toContain('event.key === "ArrowUp"');
    expect(workspace).toContain('event.key === "Tab"');
    expect(workspace).toContain('event.key === "Escape"');
    expect(workspace).toContain("issueMentionCandidates");
    expect(devShell).toContain('add("locked", "Locked"');
    expect(devShell).toContain('add("unlocked", "Unlocked"');
    expect(devShell).toContain('["in:", "范围", "限定搜索标题、正文或评论"]');
    expect(devShell).toContain('add("comments", "评论", "仅搜索未删除评论")');
  });

  it("DevShell 显示可单独移除且响应式换行的已应用筛选摘要", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    expect(workspace).toContain('kind: "对话"');
    expect(workspace).toContain('aria-label="对话已锁定"');

    expect(workspace).toContain('role="region" aria-label="已应用筛选"');
    expect(workspace).toContain("appliedIssueFilters.map");
    expect(workspace).toContain('aria-label={`移除${filter.kind}筛选 ${filter.value}`}');
    expect(workspace).toContain('filter.key === "subscribed" ? { subscribed: false } : filter.key === "mentioned" ? { mentioned: false } : { [filter.key]: "" }');
    expect(workspace).toContain('aria-label="清除全部筛选"');
    expect(workspace).toContain("focusIssueSearchAfterFilterChange");
    expect(workspace).toContain("flex-wrap");
    expect(workspace).toContain("h-11 shrink-0 rounded");
    expect(workspace).toContain("sm:h-7");
    expect(workspace).toContain("issueMentionCandidates.find");
  });

  it("DevShell 从空结果重置筛选后将焦点恢复到搜索框", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    expect(devShell).toContain("const clearIssueListFiltersAndFocus = () => {");
    expect(devShell).toContain('updateIssueQuery({ q: "", searchIn: "", issueType: "", label: "", author: "", participant: "", assignee: "", milestone: "", reason: "", subscribed: false, mentioned: false, locked: "", offset: 0 })');
    expect(devShell).toContain("focusIssueSearchAfterFilterChange();");
    expect(devShell).toContain('onClick={clearIssueListFiltersAndFocus}>重置筛选</button>');
    expect(devShell).toContain('onClick={clearIssueListFiltersAndFocus} aria-label="清除全部筛选"');
  });

  it("DevShell 支持从详情头部或 R 快捷键直接聚焦评论编辑器", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    expect(devShell).toContain('data-localapp-issue-comment-composer');
    expect(devShell).toContain('aria-label="添加评论"');
    expect(devShell).toContain('aria-keyshortcuts="R"');
    expect(devShell).toContain('event.key.toLowerCase() === "r"');
    expect(devShell).toContain('view.kind === "detail" && user && dialog?.querySelector("[data-localapp-issue-comment-composer]")');
    expect(devShell).toContain("focusDevIssueCommentComposer");
    expect(devShell).toContain('matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"');
  });

  it("DevShell 订阅本地 Issue 失效事件并静默合并刷新", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain('new EventSource(`/api/issues/events?${params.toString()}`)');
    expect(workspace).toContain('events.addEventListener("issue:changed"');
    expect(workspace).toContain('document.visibilityState === "hidden"');
    expect(workspace).toContain("const connect = (refresh: boolean) =>");
    expect(workspace).toContain('const handleVisibilityChange = () => document.visibilityState === "hidden" ? disconnect() : connect(true)');
    expect(workspace).toContain("connect(false)");
    expect(workspace).toContain('document.addEventListener("visibilitychange", handleVisibilityChange)');
    expect(workspace).toContain('document.removeEventListener("visibilitychange", handleVisibilityChange)');
    expect(workspace).toContain('window.addEventListener("blur", handleWindowBlur)');
    expect(workspace).toContain('window.addEventListener("focus", handleWindowFocus)');
    expect(workspace).toContain('window.addEventListener("pagehide", handleWindowBlur)');
    expect(workspace).toContain('window.addEventListener("pageshow", handleWindowFocus)');
    expect(workspace).toContain("if (events) return");
    expect(workspace).toContain("const changed = envelope.data");
    expect(workspace).toContain("issueEventRefreshTimerRef");
    expect(workspace).toContain("window.setTimeout");
    expect(workspace).toContain("refreshIssueDetailSilently");
    expect(workspace).toContain("void fetchIssues(issueQueryRef.current)");
    expect(workspace).toContain("events?.close()");
    expect(workspace).toContain("const [detailUpdateNotice, setDetailUpdateNotice] = useState(false)");
    expect(workspace).toContain("nextDetail.issue.updated_at !== currentDetail.issue.updated_at");
    expect(workspace).toContain('role="status" aria-label="Issue 协作更新"');
    expect(workspace).toContain("已同步最新协作活动");
    expect(workspace).toContain('aria-label="关闭协作更新提示"');
  });

  it("DevShell 提供完全离线的 edited 标记与无障碍修订历史对话框", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const historyDialog = devShell.slice(devShell.indexOf("function DevIssueRevisionDialog"), devShell.indexOf("function DevIssueDetailPanel"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(devShell).toContain("interface DevIssueRevision");
    expect(devShell).toContain("UserRound, X } from \"lucide-react\"");
    expect(historyDialog).toContain("/api/issues/${issueId}/history");
    expect(historyDialog).toContain("/api/issues/${issueId}/comments/${commentId}/history");
    expect(historyDialog).toContain('role="dialog"');
    expect(historyDialog).toContain('aria-modal="true"');
    expect(historyDialog).toContain('aria-describedby="dev-issue-history-target"');
    expect(historyDialog).toContain('id="dev-issue-history-target"');
    expect(historyDialog).toContain('aria-label="编辑历史版本"');
    expect(historyDialog).toContain('event.key === "Escape"');
    expect(historyDialog).toContain('if (event.key !== "Tab" || !dialogRef.current) return;\n    event.stopPropagation();');
    expect(historyDialog).toContain("returnFocus.focus()");
    expect(historyDialog).toContain("正在加载编辑历史");
    expect(historyDialog).toContain("重试");
    expect(historyDialog).toContain("h-11 w-11 sm:h-8 sm:w-8");
    expect(historyDialog).toContain("mt-3 h-11 sm:h-8");
    expect(detail).toContain("查看 Issue 编辑历史");
    expect(detail).toContain("onViewHistory");
    expect(devShell).toContain("查看评论编辑历史");
    expect(devShell).toContain("inline-flex h-11 items-center");
    expect(devShell).toContain("sm:h-6");
  });

  it("DevShell 使用本地身份提供键盘可访问的 mention 自动补全", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer"), devShell.indexOf("function DevIssueMetadata"));

    expect(devShell).toContain("function findDevIssueMentionQuery");
    expect(devShell).toContain("function applyDevIssueMention");
    expect(devShell).toContain("issueMentionCandidates");
    expect(composer).toContain('aria-autocomplete="list"');
    expect(composer).toContain('role="listbox"');
    expect(composer).toContain('aria-label="提及用户建议"');
    expect(composer).not.toContain('aria-label="Mention 用户"');
    expect(composer).toContain('role="option"');
    expect(composer).toContain('aria-label={`${displayName}，账号 @${candidate.id}`}');
    expect(composer).toContain('role="status" aria-label="提及用户建议状态"');
    expect(composer).toContain("没有匹配的用户");
    expect(composer).toContain('aria-activedescendant');
    expect(composer).toContain('["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"]');
    expect(composer).toContain('if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setMentionOpen(false); return; }');
    expect(composer).toContain("selectDevIssueMention");
    expect(composer).toContain("min-h-11 w-full min-w-0");
    expect(composer).toContain("sm:min-h-10");
    expect(devShell).toContain("mentionCandidates={identities}");
    expect(devShell).not.toContain("/api/notifications");
  });

  it("DevShell 修改草稿时清除过期的内联提交错误", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer"), devShell.indexOf("function DevIssueMetadata"));

    expect(composer).toContain("const [submitError, setSubmitError] = useState<string | null>(null)");
    expect(composer).toMatch(/const handleDevIssueBodyChange[\s\S]*?setSubmitError\(null\);[\s\S]*?setBody\(event\.target\.value\)/);
    expect(composer).toContain('(attachmentSubmitError || submitError) && <p role="alert"');
  });

  it("DevShell 支持不绕过阻塞条件的 composer 快捷提交", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer"), devShell.indexOf("function DevIssueMetadata"));

    expect(composer).toContain('event.defaultPrevented || submitting || hasBlockingIssueAttachments || contentMissing || submitDisabled');
    expect(composer).toContain("event.currentTarget.requestSubmit()");
    expect(composer).toContain('aria-keyshortcuts="Meta+Enter Control+Enter"');
    expect(composer.match(/event\.nativeEvent\.isComposing \|\| event\.keyCode === 229/g)).toHaveLength(2);
    expect(composer).toContain('selectionRef.current = { start: 0, end: 0 }');
    expect(composer).toContain("setCaret(0)");
    expect(composer).toContain("setMentionOpen(false)");
    expect(composer).toContain('if (!statusAction) window.requestAnimationFrame(() => textareaRef.current?.focus())');
    expect(composer).toContain('role="status" aria-live="polite" aria-atomic="true" aria-label="提交状态"');
    expect(composer).toContain('statusAction === "close" ? "评论并关闭成功"');
    expect(composer).toContain('statusAction === "reopen" ? "重新打开并评论成功"');
    expect(composer).toContain('submitAnnouncement && (body || attachments.length > 0)');
  });

  it("DevShell 实时详情刷新不会用远端版本重建评论 composer", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(detail).toContain("draftId={commentDraftId}");
    expect(detail).not.toContain('key={`comment-${detail.issue.id}-${detail.issue.updated_at}`}');
  });

  it("DevShell 详情顶栏持续显示 Issue 编号与当前标题", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain('const detailTitle = view.kind === "detail" ? detail?.issue.title ?? view.issue.title : undefined');
    expect(workspace).toContain('`Issue #${view.issue.issue_number} · ${detailTitle}`');
    expect(workspace).toContain('title={detailHeaderTitle}');
    expect(workspace).toContain('className="min-w-0 truncate text-sm font-semibold"');
  });

  it("DevShell 时间线操作结果支持连续原子播报", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function DevIssueComposer"));

    expect(timeline).toContain('role="status" aria-live="polite" aria-atomic="true" aria-label="时间线操作状态"');
    expect(timeline).toContain('label: "复制评论链接", onSelect: () => { setCopyAnnouncement("");');
    expect(timeline).toContain('setCopyAnnouncement("评论链接已复制")');
  });

  it("DevShell 不在附件上传期间关闭 Issue 工作区", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));

    expect(devShell).toContain("function focusBusyDevIssueAttachmentQueue()")
    expect(devShell).toContain("if (focusBusyDevIssueAttachmentQueue()) return")
    expect(devShell).toContain('data-localapp-issue-attachment-queue')
    expect(devShell).toContain('tabIndex={-1}')
    expect(devShell).toContain('if (!nextOpen && focusBusyDevIssueAttachmentQueue())')
    expect(devShell).toContain('restoreDevIssueWorkspaceHistoryUrl')
  });

  it("DevShell 在原 Issue 行消失时把返回焦点回退到搜索框", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain('if (!open || view.kind !== "list" || loading || pendingIssueFocusIdRef.current === null) return');
    expect(workspace).toContain('(link ?? issueSearchInputRef.current)?.focus()');
    expect(workspace).toContain('if (view.kind === "detail" && pendingIssueFocusIdRef.current === null) pendingIssueFocusIdRef.current = view.issue.id');
    expect(workspace).toContain('[issues, loading, open, view.kind]');
  });

  it("DevShell 详情变更后使用服务端权威筛选刷新当前列表", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const functionBody = (name: string, nextName: string) => devShell.slice(devShell.indexOf(`const ${name} =`), devShell.indexOf(`const ${nextName} =`));

    expect(functionBody("toggleIssueStatus", "updateIssueDetail")).toContain("await Promise.all([loadIssueDetail(issue.id), fetchIssues(query)])");
    expect(functionBody("updateIssueDetail", "updateIssueCollaboration")).toContain("await Promise.all([loadIssueDetail(detail.issue.id), fetchIssues(query)])");
  });

  it("DevShell 详情活动不会绕过当前筛选向列表插入记录", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const functionBody = (name: string, nextName: string) => devShell.slice(devShell.indexOf(`const ${name} =`), devShell.indexOf(`const ${nextName} =`));
    const syncBody = functionBody("syncIssueStatusAcrossViews", "syncIssueDetailAcrossViews");
    const deleteBody = devShell.slice(devShell.indexOf("const deleteComment ="), devShell.indexOf("\n\n  return (", devShell.indexOf("const deleteComment =")));

    expect(syncBody).toContain("current.map((issue) => issue.id === updatedIssue.id ? updatedIssue : issue)");
    expect(syncBody).not.toContain("[updatedIssue, ...current]");
    expect(functionBody("toggleIssueReaction", "createComment")).toContain("await fetchIssues(query)");
    expect(functionBody("createComment", "updateComment")).toContain("await fetchIssues(query)");
    expect(functionBody("updateComment", "deleteComment")).toContain("await fetchIssues(query)");
    expect(deleteBody).toContain("await Promise.all([loadIssueDetail(detail.issue.id), fetchIssues(query)])");
  });

  it("DevShell composer 提交失败只由对应 composer 呈现", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const functionBody = (name: string, nextName: string) => devShell.slice(devShell.indexOf(`const ${name} =`), devShell.indexOf(`const ${nextName} =`));

    expect(functionBody("submitIssue", "toggleIssueStatus")).not.toContain("setError(message)");
    expect(functionBody("createComment", "updateComment")).not.toContain("setError(message)");
    expect(functionBody("updateComment", "deleteComment")).not.toContain("setError(message)");
    expect(functionBody("updateIssueDetail", "updateIssueCollaboration")).toContain("if (!updates.draftId) setError(message)");
    expect(functionBody("updateIssueCollaboration", "toggleIssueReaction")).toContain("setError(message)");
  });

  it("DevShell 区分分页越界与普通空状态", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const issuePageOutOfRange = query.offset > 0 && issues.length === 0");
    expect(workspace).toContain("当前页已无 Issue");
    expect(workspace).toContain("updateIssueQuery({ offset: 0 })}>返回第一页");
    expect(workspace).toContain('issues.length === 0 ? `0 / ${meta.total}`');
  });

  it("DevShell 为已渲染详情的实时同步失败提供就地重试", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const [detailSyncFailed, setDetailSyncFailed] = useState(false)");
    expect(workspace).toContain("const retryIssueDetailSync = async () =>");
    expect(workspace).toContain("if (detailSyncing || !currentDetail) return");
    expect(workspace).toContain('detailSyncFailed && <button type="button" disabled={detailSyncing}');
    expect(workspace).toContain('detailSyncing ? "正在同步..." : "重新同步"');
    expect(workspace).toContain("h-11 shrink-0 sm:h-7");
  });

  it("DevShell 将列表刷新错误与详情错误隔离", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const [listError, setListError] = useState<string | null>(null)");
    expect(workspace).toContain("setListError(null)");
    expect(workspace).toContain('requestError.name === "TimeoutError" ? "Issue 服务暂不可用"');
    expect(workspace).toContain("{listError && issues.length > 0");
    expect(workspace).toContain("listError && issues.length === 0");
    expect(workspace).toContain("pendingListRetryFocusRef");
    expect(workspace).toContain("retryIssueList");
    expect(workspace).not.toContain("{error && issues.length > 0");
  });

  it("DevShell 详情导航只接受最新请求并在离开时使旧请求失效", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const detailRequestGenerationRef = useRef(0)");
    expect(workspace).toContain("const generation = ++detailRequestGenerationRef.current");
    expect(workspace).toContain("if (detailRequestGenerationRef.current !== generation) return");
    expect(workspace).toContain("if (detailRequestGenerationRef.current === generation) setDetailLoading(false)");
    expect(workspace).toContain("++detailRequestGenerationRef.current; setDetailLoading(false)");
  });

  it("DevShell 评论编辑冲突保留草稿并显示远端版本入口", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function DevIssueComposer"));
    const updateComment = devShell.slice(devShell.indexOf("const updateComment ="), devShell.indexOf("const deleteComment ="));

    expect(updateComment).toContain("await loadIssueDetail(detail.issue.id).catch(() => undefined)");
    expect(timeline).toContain("editingCommentVersion !== comment.updated_at");
    expect(timeline).toContain("此评论有新变更，当前草稿尚未被覆盖。");
    expect(timeline).toContain("加载最新内容");
    expect(timeline).toContain("h-11 shrink-0 sm:h-8");
  });

  it("DevShell 明确放弃冲突的 Issue 草稿后再加载最新内容", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const detailPanel = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));

    expect(detailPanel).toContain("放弃草稿并加载最新");
    expect(detailPanel).toContain("h-11 shrink-0 sm:h-8");
    expect(detailPanel).toContain("block h-11 w-full rounded");
    expect(detailPanel).toContain("h-11 rounded border");
    expect(detailPanel).toContain("sm:h-9");
    expect(detailPanel).toMatch(/const beginIssueEdit[\s\S]*?if \(editingIssue\)[\s\S]*?writeDevIssueEditMeta\(issueEditMetaKey, null\)[\s\S]*?writeDevIssueSessionDraft\(issueEditBodyKey, \"\"\)/);
  });

  it("DevShell 删除评论失败向确认框传播异常以保留重试", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const deleteComment = devShell.slice(devShell.indexOf("const deleteComment ="), devShell.indexOf("return (", devShell.indexOf("const deleteComment =")));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline"), devShell.indexOf("function DevIssueComposer"));

    expect(deleteComment).toContain("setError(message)");
    expect(deleteComment).toContain("throw requestError instanceof Error ? requestError : new Error(message)");
    expect(timeline).toContain("Keep the confirmation visible so the user can retry.");
  });

  it("DevShell 删除评论确认框约束 Tab 焦点并关联说明", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline("), devShell.indexOf("function DevIssueDetailPanel"));

    expect(timeline).toContain("deleteCommentConfirmRef");
    expect(timeline).toContain("mt-3 flex flex-wrap justify-end gap-2");
    expect(timeline).toContain("h-11 sm:h-8");
    expect(timeline).toContain("handleDeleteConfirmationKeyDown");
    expect(timeline).toContain("confirmedComment && !confirmedComment.comment.deleted_at");
    expect(timeline).toContain("setConfirmingDeleteCommentId(null)");
    expect(timeline).toContain("editedComment && !editedComment.comment.deleted_at");
    expect(timeline).toContain('setCopyAnnouncement("评论已被删除，编辑已结束")');
    expect(timeline).toContain('event.key !== "Tab"');
    expect(timeline).toContain('aria-describedby={`delete-comment-${comment.id}-description`}');
  });

  it("DevShell 仅向 owner 提供永久删除 Issue 并保留失败确认", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const detailPanel = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"));

    expect(devShell).toContain('method: "DELETE", credentials: "include"');
    expect(detailPanel).toContain('user.id === pageOwnerId || user.role === "owner"');
    expect(detailPanel).toContain('aria-label="删除 Issue 确认"');
    expect(detailPanel).toContain("deleteIssueConfirmRef");
    expect(detailPanel).toContain("setDeleteIssueError");
    expect(detailPanel).toContain("此操作无法撤销");
    expect(detailPanel).toContain('label: "删除 Issue", destructive: true, restoreFocus: false');
    expect(detailPanel).toContain("deleteIssueTriggerRef.current = trigger");
    expect(detailPanel).not.toContain('<div className="mt-4 flex justify-end"><button ref={deleteIssueTriggerRef}');
  });

  it("DevShell 提供 owner-only 标签管理视图和完整本地 CRUD", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const manager = devShell.slice(devShell.indexOf("function DevIssueLabelManager"), devShell.indexOf("function DevIssuesWorkspace"));

    expect(devShell).toContain('aria-label="管理 Issue 标签"');
    expect(devShell).toContain('user.id === pageOwnerId || user.role === "owner"');
    expect(devShell).toContain("const deleteTriggerRef = useRef<HTMLElement | null>(null)");
    expect(devShell).toContain("event.key === \"Escape\" && !saving");
    expect(devShell).toContain("document.activeElement === last");
    expect(manager).toContain("新建标签");
    expect(manager).toContain("保存更改");
    expect(manager).toContain("确认删除标签");
    expect(manager).toContain("deleteLabelTriggerRef");
    expect(manager).toContain('event.key !== "Tab"');
    expect(manager).toContain('event.key === "Escape"');
    expect(devShell).toMatch(/import \{[^}]*\bPlus\b[^}]*\} from "lucide-react"/);
    expect(devShell).toContain('method: "POST", credentials: "include"');
    expect(devShell).toContain('method: "PATCH", credentials: "include"');
    expect(devShell).toContain('method: "DELETE", credentials: "include"');
  });

  it("DevShell 删除评论成功后播报结果并聚焦保留卡片", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline("), devShell.indexOf("function DevIssueDetailPanel"));

    expect(timeline).toContain('setCopyAnnouncement("评论已删除")');
    expect(timeline).toContain('`[data-localapp-issue-comment-id="${commentId}"]`');
  });

  it("DevShell 编辑 Composer 打开后聚焦正文", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer("), devShell.indexOf("interface DevIssueMetadataPickerItem"));

    expect(composer).toContain('autoFocus = submitLabel.startsWith("保存")');
    expect(composer).toContain("textareaRef.current?.focus()");
  });

  it("DevShell 退出评论编辑后聚焦对应评论卡片", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const timeline = devShell.slice(devShell.indexOf("function DevIssueTimeline("), devShell.indexOf("function DevIssueDetailPanel"));

    expect(timeline).toContain("previousEditingCommentIdRef");
    expect(timeline).toContain('`[data-localapp-issue-comment-id="${previousEditingCommentId}"]`');
  });

  it("DevShell 退出 Issue 编辑后聚焦操作入口", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel("), devShell.indexOf("function DevToolkitSidebar"));

    expect(detail).toContain("previousEditingIssueRef");
    expect(detail).toContain("[data-localapp-issue-body-card] button[aria-label=\"Issue 操作\"]");
  });

  it("DevShell 创建 Issue 后进入新详情并同步深链", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const submit = devShell.slice(devShell.indexOf("const submitIssue ="), devShell.indexOf("const updateIssueDetail ="));

    expect(submit).toContain('const created = await requestDevIssue<DevIssue>("/api/issues"');
    expect(submit).toContain("onIssueNavigate(created.id)");
    expect(submit).toContain("await loadIssueDetail(created.id)");
    expect(devShell).toContain('data-localapp-issue-title tabIndex={-1}');
    expect(devShell).toContain('[data-localapp-issue-title]');
    const detailTitle = devShell.match(/<h3 data-localapp-issue-title[^>]+>/)?.[0] ?? "";
    expect(detailTitle).not.toContain("focus-visible:ring");
    expect(detailTitle).toContain("outline-none");
    expect(devShell).toContain("createIssueTriggerRef");
    expect(devShell).toContain("pendingCreateIssueFocusRef");
  });

  it("DevShell 创建评论后写入评论深链并聚焦新评论", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const create = devShell.slice(devShell.indexOf("const createComment ="), devShell.indexOf("const updateComment ="));

    expect(create).toContain("const previousCommentIds = new Set(detail.timeline.flatMap");
    expect(create).toContain("createDevIssueCommentHref(detail.issue.id, createdComment.comment.id)");
    expect(create).toContain("window.history.replaceState(window.history.state");
  });

  it("DevShell 删除当前深链评论后清理失效参数", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));

    expect(devShell).toContain("function clearDevIssueCommentDeepLinkUrl(");
    expect(devShell).toContain("clearDevIssueCommentDeepLinkUrl(new URL(window.location.href), commentId)");
  });

  it("DevShell 附件在新标签页打开并保留工作台", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const attachments = devShell.slice(devShell.indexOf("function DevIssueAttachmentLinks("), devShell.indexOf("function DevIssueEventIcon"));

    expect(attachments).toContain('target="_blank" rel="noreferrer"');
    expect(attachments).toContain("在新标签页打开附件");
    expect(attachments).toContain("flex min-h-11 min-w-0 flex-1 items-center");
    expect(attachments).toContain("shrink-0 text-localapp-dev-muted-foreground");
    expect(attachments).toContain('loading="lazy" decoding="async"');
  });

  it("DevShell 锁定失败在活动模态层显示且不重复到后方 metadata", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const metadata = devShell.slice(devShell.indexOf("function DevIssueMetadata"), devShell.indexOf("function DevIssueRevisionDialog"));

    expect(metadata).toContain("localMetadataError && !lockDialogOpen");
    expect(metadata).toContain("localMetadataError && lockDialogOpen");
    expect(metadata).toContain("data-localapp-issue-lock-error role=\"alert\"");
    expect(metadata).toContain("runMetadataAction(onToggleLock(true, lockReason)).then(closeLockDialog).catch(() => undefined)");
  });

  it("DevShell Issue 列表保留 Platform 的查询与并发请求契约", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const start = devShell.indexOf("function DevIssuesWorkspace");
    const end = devShell.indexOf("function DevIssueMarkdown", start);
    const workspace = devShell.slice(start, end);

    for (const parameter of ["status", "sort", "direction", "limit", "offset"]) {
      expect(workspace, `DevShell list query must serialize ${parameter}`).toContain(`requestQuery.set(\"${parameter}\"`);
    }
    for (const parameter of ["q", "label", "author", "participant"]) {
      expect(workspace, `DevShell must omit an empty optional ${parameter}`).toContain(`if (nextQuery.${parameter}) requestQuery.set(\"${parameter}\"`);
    }
    expect(workspace).toContain('if (nextQuery.subscribed) requestQuery.set("subscribed", "true")');
    expect(workspace).toContain("listRequestGenerationRef");
    expect(workspace).toContain("listAbortRef.current?.abort()");
    expect(workspace).toContain("new AbortController()");
    expect(workspace).toContain("signal: controller.signal");
    expect(workspace).toContain("listRequestGenerationRef.current !== generation");
    expect(devShell).toContain('error instanceof Error && error.name === "AbortError"');
    expect(workspace).toContain("window.setTimeout");
    expect(workspace).toContain("}, 250)");
    expect(workspace).toContain('event.key === "Enter"');
  });

  it("DevShell Issue 列表提供 Platform 同构的视图、状态和分页结构", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const start = devShell.indexOf("function DevIssuesWorkspace");
    const end = devShell.indexOf("function DevIssueMarkdown", start);
    const workspace = devShell.slice(start, end);

    for (const attribute of ["data-localapp-issue-list", "data-localapp-issue-view-rail", "data-localapp-issue-toolbar", "data-localapp-issue-row"]) {
      expect(workspace).toContain(attribute);
    }
    expect(workspace).toContain('created: "我创建的"');
    expect(workspace).toContain('participating: "我参与的"');
    expect(workspace).toContain('subscribed: "我关注的"');
    expect(workspace).toContain('mentioned: "提及我的"');
    expect(workspace).toContain('assigned: "分配给我的"');
    expect(workspace).toContain('recent: "最近活动"');
    expect(workspace).toContain('nextView === "assigned" && user');
    expect(workspace).toContain('assignee: user.id');
    expect(workspace).toContain('query.assignee === user.id');
    expect(workspace).toContain("query.subscribed");
    expect(workspace).toContain("query.mentioned");
    expect(workspace).toContain('if (nextQuery.mentioned) requestQuery.set("mentioned", "true")');
    expect(workspace).toContain("meta.open");
    expect(workspace).toContain("meta.closed");
    expect(workspace).toContain("meta.total");
    expect(workspace).toContain("issues.map((issue, index)");
    expect(workspace).toContain("aria-posinset={meta.offset + index + 1}");
    expect(workspace).toContain("aria-setsize={meta.total}");
    expect(workspace).toContain("aria-busy={refreshingIssues}");
    expect(workspace).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(workspace).toContain("当前显示第 ${meta.offset + 1} 至 ${Math.min(meta.offset + issues.length, meta.total)} 条，共 ${meta.total} 条 Issue");
    expect(workspace).toContain("query.offset + query.limit");
    expect(workspace).toContain('id="localapp-dev-issue-results"');
    expect(workspace).toContain('aria-controls="localapp-dev-issue-results"');
    expect(workspace).toContain("paginationFocusPendingRef.current = true");
    expect(workspace).toContain('[data-localapp-issue-link]');
    expect(workspace).toContain("comment_count");
    expect(workspace).toContain("participant_ids?.length");
    expect(workspace).toContain("h-11 shrink-0 rounded px-3");
    expect(workspace).toContain("h-11 min-w-0 w-full");
    expect(workspace).toContain("h-11 items-center gap-1.5");
    expect(workspace).toContain("h-11 w-11");
  });

  it("DevShell Issue 列表涵盖加载、刷新、空态、错误重试与无横向溢出的响应式布局", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const start = devShell.indexOf("function DevIssuesWorkspace");
    const end = devShell.indexOf("function DevIssueMarkdown", start);
    const workspace = devShell.slice(start, end);

    expect(workspace).toContain("Array.from({ length: 6 }");
    expect(workspace).toContain("aria-busy={loading}");
    expect(workspace).toContain("refreshingIssues = loading && issues.length > 0");
    expect(workspace).toContain("正在更新结果");
    expect(workspace).toContain('data-stale={refreshingIssues ? "true" : undefined}');
    expect(workspace).not.toContain('className={refreshingIssues ? "opacity-60" : undefined}');
    expect(workspace).toContain("显示上次结果");
    expect(workspace).toContain("无法加载 Issues");
    expect(workspace).toContain("motion-safe:animate-pulse");
    expect(workspace).toContain("h-11 shrink-0 items-center");
    expect(workspace).toContain("h-11 w-11 shrink-0");
    expect(workspace).toContain("h-11 sm:h-8");
    expect(workspace).toContain("重置筛选");
    expect(workspace).toContain("const hasActiveIssueFilters = Boolean(query.q || query.searchIn || query.issueType || query.label || query.author || query.participant || query.assignee || query.milestone || query.reason || query.subscribed || query.mentioned || query.locked)");
    expect(workspace).toContain('hasActiveIssueFilters ? "当前筛选没有匹配的 Issue"');
    expect(workspace).toContain("hasActiveIssueFilters && <button");
    expect(workspace).toContain("重试");
    expect(workspace).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(workspace).toContain("lg:grid-cols-[240px_minmax(0,1fr)]");
    expect(workspace).toContain("lg:grid-rows-1");
    expect(workspace).toContain("lg:flex-col");
    expect(workspace).toContain("h-full min-w-0 cursor-pointer bg-transparent");
    expect(workspace).toContain("sm:flex-row");
    expect(workspace).toContain("max-w-full");
    expect(workspace).toContain("overflow-x-hidden");
    expect(workspace).toContain("text-base font-semibold leading-6");
    expect(workspace).toContain("text-sm leading-5");
  });

  it("DevShell 离线展示置顶区并只向 page owner 提供置顶维护", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    const metadata = devShell.slice(devShell.indexOf("function DevIssueMetadata"), devShell.indexOf("function DevIssueRevisionDialog"));

    expect(devShell).toContain("pinned?: DevIssue[]");
    expect(workspace).toContain("setPinnedIssues(Array.isArray(body.pinned) ? body.pinned : [])");
    expect(workspace).toContain('data-localapp-pinned-issues');
    expect(workspace).toContain("置顶 Issues");
    expect(workspace).toContain("sm:grid-cols-2 xl:grid-cols-3");
    expect(workspace).toContain('query.status === "open"');
    expect(workspace).toContain('activeView === "all"');
    expect(workspace).toContain('updateIssueCollaboration("pin", { pinned })');
    expect(metadata).toContain('aria-label={detail.issue.pinned_at ? "取消置顶" : "置顶 Issue"}');
    expect(devShell).toContain('canManagePin={Boolean(user && (user.id === pageOwnerId || user.role === "owner"))}');
    expect(metadata).toContain("onTogglePin(!detail.issue.pinned_at)");
  });

  it("DevShell 离线提供同构 Sub-issues 层级、进度与 owner 维护入口", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("subIssues?: DevIssueSubIssueItem[]");
    expect(devShell).toContain("subIssueSummary?: { total: number; completed: number; percent: number }");
    expect(devShell).toContain("function DevIssueSubIssues(");
    expect(devShell).toContain("data-localapp-sub-issues");
    expect(devShell).toContain('aria-label="Sub-issues 完成进度"');
    expect(devShell).toContain("创建子 Issue");
    expect(devShell).toContain("要关联的 Issue 编号");
    expect(devShell).toContain("移除 Sub-issue #");
    expect(devShell).toContain("parentIssueId: view.parentIssueId");
    expect(devShell).toContain("/sub-issues/${child.issue.id}");
    expect(devShell).toContain("canManageSubIssues");
    expect(devShell).toContain("function DevSubIssueReorderControls(");
    expect(devShell).toContain('label={`重排 Sub-issue #${issue.issue_number}`}');
    expect(devShell).toContain('label: "移到顶部"');
    expect(devShell).toContain('label: "移到底部"');
    expect(devShell).toContain('method: "PATCH"');
    expect(devShell).toContain("/sub-issues/priority");
    expect(devShell).toContain("onDragStart");
    expect(devShell).toContain('aria-live="polite">{announcement}');
    expect(devShell).toContain("function DevIssueNestedBranch(");
    expect(devShell).toContain("/sub-issues?${params.toString()}");
    expect(devShell).toContain('aria-label={`${expanded ? "折叠" : "展开"} Sub-issue #${issue.issue_number}`}');
    expect(devShell).toContain('role="tree" aria-label="Sub-issues"');
    expect(devShell).toContain('expanded && state.status === "idle"');
  });

  it("DevShell Issue 详情在请求期间保持稳定骨架并为失败提供恢复操作", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("function DevIssueDetailSkeleton()");
    expect(devShell).toContain('aria-label="正在加载 Issue 详情"');
    expect(devShell).toContain("function DevIssueDetailError(");
    expect(devShell).toContain("无法加载 Issue 详情");
    expect(devShell).toContain("detailErrorHeadingRef");
    expect(devShell).toContain("detailErrorHeadingRef.current?.focus()");
    expect(devShell).toContain('aria-labelledby={headingId} aria-describedby={descriptionId}');
    expect(devShell).toContain('aria-label="从错误页返回 Issue 列表"');
    expect(devShell).toContain('aria-label="重试加载 Issue 详情"');
    const errorHeading = devShell.match(/<h3 ref=\{detailErrorHeadingRef\}[^>]+>/)?.[0] ?? "";
    expect(errorHeading).not.toContain("focus-visible:ring");
    expect(devShell).toContain("<DevIssueDetailSkeleton />");
    expect(devShell).toContain("<DevIssueDetailError");
    expect(devShell).toContain("返回列表");
    expect(devShell).toContain("devContext ? <DevIssuesWorkspace");
    expect(devShell).toContain('data-localapp-shell-nav-background inert={issuesOpen ? ("true" as unknown as boolean) : undefined} aria-hidden={issuesOpen ? true : undefined}');
    expect(devShell).toContain('aria-hidden={issuesOpen ? true : undefined} className="shrink-0"');
    expect(devShell).toContain('data-localapp-app-background inert={issuesOpen ? ("true" as unknown as boolean) : undefined} aria-hidden={issuesOpen ? true : undefined}');
    expect(devShell).toContain('aria-hidden={issuesOpen ? true : undefined} className="absolute inset-0"');
    expect(devShell).toContain('issuesOpen ? <div data-localapp-issues-layer');
    expect(devShell).toContain("function DevIssueContextError(");
    expect(devShell).toContain("无法打开 Issue 工作台");
    expect(devShell).toContain("requestDevContext()");
    expect(devShell).toContain("Dev context request timed out");
    expect(devShell).toContain("controller.abort()");
    expect(devShell).toContain("retryTimer = setTimeout(loadContext, 1_000)");
    expect(devShell).toContain("setDevContextError(null)");
  });

  it("DevShell 在真实 dev context 就绪前不请求虚构应用的 Issue 数量", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const countEffectStart = devShell.indexOf("const query = new URLSearchParams({ pagePath: getDevIssuePagePath(devContext), status: \"open\" })");
    const countEffect = devShell.slice(devShell.lastIndexOf("useEffect(() => {", countEffectStart), devShell.indexOf("const respondToPlatformRequest", countEffectStart));

    expect(countEffect).toContain("if (!devContext)");
    expect(countEffect).toContain("setOpenIssueCount(null)");
    expect(countEffect.indexOf("if (!devContext)")).toBeLessThan(countEffect.indexOf("getDevIssuePagePath(devContext)"));
    expect(countEffect).toContain("controller.abort()")
    expect(countEffect).toContain("[devContext, issuesRevision]");
  });

  it("DevShell 标签目录失败时保持标签为空并提供原地重试", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const [labelCatalogError, setLabelCatalogError] = useState(false)");
    expect(workspace).toContain("const [labelCatalogRevision, setLabelCatalogRevision] = useState(0)");
    expect(devShell).toContain("标签目录暂不可用");
    expect(workspace).toContain("devCatalogRetryLabel(labelCatalogError, userCatalogError, milestoneCatalogError)");
    expect(workspace).toContain("setLabelCatalogRevision((revision) => revision + 1)");
    expect(workspace).toContain("pendingCatalogRetryFocusRef");
    expect(workspace).toContain("catalogRetrying");
    expect(workspace).toContain("focusAfterCatalogRetry");
  });

  it("DevShell 负责人目录失败时保留已知用户并提供原地重试", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const [userCatalog, setUserCatalog] = useState<DevUserBasic[]>(platformUsers)");
    expect(workspace).toContain("const [userCatalogError, setUserCatalogError] = useState(false)");
    expect(workspace).toContain("const [userCatalogRevision, setUserCatalogRevision] = useState(0)");
    expect(workspace).toContain('requestDevIssueCatalogWithRetry((signal) => requestDevIssue<{ users?: DevUserBasic[]; source?: string }>("/api/dev/users", { credentials: "include", signal })');
    expect(devShell).toContain("负责人目录加载失败，正在显示已知用户");
    expect(workspace).toContain("aria-label={devCatalogRetryLabel(labelCatalogError, userCatalogError, milestoneCatalogError)}");
    expect(workspace).toContain("setUserCatalogRevision((revision) => revision + 1)");
    expect(workspace).toContain("...recentUsers, ...platformUsers, ...userCatalog");
  });

  it("DevShell 将有效的离线负责人目录视为成功降级", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("setUserCatalogError(false)");
    expect(workspace).not.toContain('setUserCatalogError(body.source === "unavailable")');
  });

  it("DevShell 里程碑目录失败时保留已知目录并提供原地重试", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("const [milestoneCatalogError, setMilestoneCatalogError] = useState(false)");
    expect(workspace).toContain("const [milestoneCatalogLoading, setMilestoneCatalogLoading] = useState(false)");
    expect(workspace).toContain("const [milestoneCatalogRevision, setMilestoneCatalogRevision] = useState(0)");
    expect(devShell).toContain("里程碑目录加载失败，正在显示已知里程碑");
    expect(devShell).toContain("重试里程碑目录");
    expect(workspace).toContain("if (milestoneCatalogError) setMilestoneCatalogRevision((revision) => revision + 1)");
    expect(workspace).toContain("labelCatalogLoading || userCatalogLoading || milestoneCatalogLoading");
    expect(workspace).toContain("labelCatalogError || userCatalogError || milestoneCatalogError");
  });

  it("DevShell 负责人目录不可用时仍可操作详情已有负责人", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const metadata = devShell.slice(devShell.indexOf("function DevIssueMetadata("), devShell.indexOf("function DevIssueRevisionDialog"));

    expect(metadata).toContain("new Set([...assigneeIds, ...identities.map((identity) => identity.id)])");
    expect(metadata).toContain(".map((id) => resolveDevIssueIdentity(id, identities))");
    expect(metadata).toContain("items={assigneeCandidates.map((identity)");
  });

  it("DevShell 移动端 metadata 折叠摘要显示标签、负责人和锁定状态", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const detail = devShell.slice(devShell.indexOf("function DevIssueDetailPanel("), devShell.indexOf("function DevToolkitSidebar"));
    expect(detail).toContain("mobileMetadataSummary");
    expect(detail).toContain("个标签");
    expect(detail).toContain("未分配");
    expect(detail).toContain("已锁定");
    expect(detail).toContain("data-localapp-issue-metadata-summary");
    expect(detail).toContain('summary className="min-h-11');
    expect(devShell).toContain('className={`${DEV_ICON_BUTTON} h-11 w-11 sm:h-7 sm:w-7`}');
    expect(devShell).toContain('className={`${DEV_OUTLINE_BUTTON} h-11 w-full text-left sm:h-8`}');
  });

  it("DevShell 标签目录不可用时仍可操作详情已有自定义标签", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const metadata = devShell.slice(devShell.indexOf("function DevIssueMetadata("), devShell.indexOf("function DevIssueRevisionDialog"));

    expect(metadata).toContain("[...(collaboration?.labels ?? []), ...availableLabels]");
    expect(metadata).toContain("items={labelCandidates.map((label)");
  });

  it("DevShell 元数据选择器支持方向键和首尾键导航", () => {
    const devShell = readTemplateFile(path.join("runtime", "dev-shell.tsx"));
    const picker = devShell.slice(devShell.indexOf("function DevIssueMetadataPicker("), devShell.indexOf("function DevIssueParticipantRoster"));
    expect(picker).toContain("h-11 w-full rounded");
    expect(picker).toContain("sm:h-8");

    expect(picker).toContain('!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)');
    expect(picker).toContain("optionRefs.current[nextIndex]?.focus()");
    expect(picker).toContain("focus-within:ring-localapp-dev-focus");
  });

  it("DevShell 使用 AST 任务顺序提供进度、直接切换和版本冲突保护", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("function collectDevIssueTasks(");
    expect(devShell).toContain("unified().use(remarkParse).use(remarkGfm).parse(markdown)");
    expect(devShell).toContain("function toggleDevIssueTask(");
    expect(devShell).toContain("function rehypeDevIssueTaskIndexes()");
    expect(devShell).toContain("node.properties.dataIssueTaskIndex = index++");
    expect(devShell).toContain("rehypePlugins={[rehypeDevIssueTaskIndexes]}");
    expect(devShell).toContain('(props as Record<string, unknown>)["data-issue-task-index"]');
    expect(devShell).toContain("index === null || !onToggleTask || tasksDisabled");
    expect(devShell).not.toContain("let taskIndex = 0");
    expect(devShell).toContain("任务 {completed} / {tasks.length}");
    expect(devShell).toContain('role="progressbar" aria-label="任务进度"');
    expect(devShell).toContain("aria-valuenow={completed} aria-valuemin={0} aria-valuemax={tasks.length}");
    expect(devShell).toContain('aria-valuetext={`已完成 ${completed} / ${tasks.length} 个任务`}');
    expect(devShell).toContain("expectedUpdatedAt: detail.issue.updated_at");
    expect(devShell).toContain("expectedUpdatedAt ? { expectedUpdatedAt } : {}");
    expect(devShell).toContain("issue_content_conflict");
    expect(devShell).toContain("savingTaskTarget");
    expect(devShell).toContain("onToggleCommentTask={toggleCommentTask}");
  });

  it("DevShell 完全离线确认并转换首帖任务为 Sub-issue", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("convertible: !node.checked");
    expect(devShell).toContain("将任务 ${index! + 1} 转换为 Sub-issue");
    expect(devShell).toContain("/tasks/${taskIndex}/convert");
    expect(devShell).toContain('role="alertdialog" aria-label="转换为 Sub-issue"');
    expect(devShell).toContain('aria-label="Sub-issue 标题"');
    expect(devShell).toContain("expectedUpdatedAt: detail.issue.updated_at");
    expect(devShell).toContain("data-localapp-issue-reference={issueNumber ?? undefined}");
  });

  it("DevShell 普通 Issue 与评论编辑携带版本令牌并保留冲突草稿", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("expectedUpdatedAt: editingIssueVersion ?? detail.issue.updated_at ?? detail.issue.created_at");
    expect(devShell).toContain("onUpdateComment(comment.id, body, editingCommentVersion ?? comment.updated_at, draftId, attachmentIds, removedCommentAttachmentIds)");
    expect(devShell).toContain("editingIssueVersion !== (detail.issue.updated_at ?? detail.issue.created_at)");
    expect(devShell).toContain("editingCommentVersion !== comment.updated_at");
    expect(devShell).toContain("当前草稿已保留");
    expect(devShell).toContain("The workspace alert keeps the API error visible without losing draft text.\n      throw error;");
  });

  it("DevShell 使用 AST 渲染同应用 Issue 引用并支持内部导航", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const references = readTemplateFile("runtime/issue-reference.ts");
    expect(references).toContain("remarkDevIssueReferences");
    expect(references).toContain('["link", "linkReference", "code", "inlineCode", "html"]');
    expect(devShell).toContain("remarkPlugins={[remarkGfm, remarkDevIssueReferences]}");
    expect(devShell).toContain("readDevIssueReference(href)");
    expect(devShell).toContain("onOpenIssueReference(issueNumber)");
    expect(devShell).toContain("getIssueReferenceHref={createDevIssueNumberHref}");
    expect(devShell).toContain("/api/issues/by-number/${issueId}");
    expect(devShell).toContain("loadIssueDetailByNumber(issueNumber)");
    expect(devShell).toContain('const DEV_ISSUE_NUMBER_DEEP_LINK_PARAM = "localappIssueNumber"');
    expect(devShell).toContain("selectedIssueNumber={selectedIssueNumber}");
    expect(devShell).toContain('onIssueNavigate(nextDetail.issue.id, "replace")');
    expect(devShell).toContain("const detailLookupByNumberRef = useRef(false)");
    expect(devShell).toContain("loadIssueDetail(view.issue.id, detailLookupByNumberRef.current)");
    const referenceNavigation = devShell.slice(devShell.indexOf("const openIssueByNumber = useCallback"), devShell.indexOf("const refreshIssueDetailSilently"));
    expect(referenceNavigation).toContain("onIssueNumberNavigate(issueNumber)");
    expect(referenceNavigation).toContain("loadIssueDetailByNumber(issueNumber)");
    expect(referenceNavigation.indexOf("onIssueNumberNavigate(issueNumber)")).toBeLessThan(referenceNavigation.indexOf("loadIssueDetailByNumber(issueNumber)"));
  });

  it("DevShell 支持已完成与不计划处理两种关闭原因", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('state_reason?: "completed" | "not_planned" | null');
    expect(devShell).toContain('aria-label="关闭原因"');
    expect(devShell).toContain('value="completed">已完成</option>');
    expect(devShell).toContain("h-11 sm:h-8");
    expect(devShell).toContain('value="not_planned">不计划处理</option>');
    expect(devShell).toContain("/>}关闭 Issue</button>");
    expect(devShell).toContain('role="group" aria-label={detail.issue.status === "open" ? "关闭 Issue" : "重新打开 Issue"}');
    expect(devShell).toContain("aria-busy={submitting || undefined}");
    expect(devShell).toContain('submitting && <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />');
    expect(devShell).toContain("focus-within:ring-2 focus-within:ring-localapp-dev-focus");
    expect(devShell).toContain('stateReason: nextStatus === "closed" ? stateReason : null');
    expect(devShell).toContain('detail.issue.state_reason === "not_planned" ? <CircleSlash2');
    expect(devShell).toContain('"已关闭 · 不计划处理" : "已关闭 · 已完成"');
    expect(devShell).not.toContain('关闭原因：{detail.issue.state_reason');
    expect(devShell).toContain("statusActionFocusPendingRef");
    expect(devShell).toContain("statusActionRef.current?.focus()");
    expect(devShell).toContain("await toggleIssueStatus(detail.issue, stateReason)");
    expect(devShell).toContain('["关闭 Issue", "重新打开 Issue"].includes(button.textContent?.trim() ?? "")');
  });

  it("DevShell composer 将 busy 反馈绑定到实际提交动作", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('useState<"submit" | "close" | "reopen" | null>(null)');
    expect(devShell).toContain('setSubmittingAction(statusAction ?? "submit")');
    expect(devShell).toContain('aria-busy={submittingAction === "submit" || undefined}');
    expect(devShell).toContain('aria-busy={submittingAction === "close" || undefined}');
    expect(devShell).toContain('aria-busy={submittingAction === "reopen" || undefined}');
    expect(devShell).not.toContain('{submitting ? "提交中..." : submitLabel}');
  });

  it("DevShell Labels 与 Assignees 使用可搜索且可恢复焦点的元数据选择器", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("function DevIssueMetadataPicker(");
    expect(devShell).toContain('role="dialog" aria-label={`选择${localizedLabel}`}');
    expect(devShell).toContain('role="searchbox" aria-label={`搜索${localizedLabel}`}');
    expect(devShell).toContain("没有匹配项");
    expect(devShell).toContain('event.key === "Escape"');
    expect(devShell).toContain('document.addEventListener("mousedown", closeOnOutside)');
    expect(devShell).toContain("triggerRef.current?.focus()");
    expect(devShell).toContain('<DevIssueMetadataPicker label="Labels"');
    expect(devShell).toContain('<DevIssueMetadataPicker label="Assignees"');
    expect(devShell).not.toContain("setLabelsOpen");
    expect(devShell).not.toContain("setAssigneesOpen");
  });

  it("DevShell 详情元数据使用一致的中文可见标题", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    for (const label of ["创建者", "标签", "负责人", "通知", "对话", "参与者"]) {
      expect(devShell).toContain(`>${label}</h4>`);
    }
    expect(devShell).toContain("<span>Issue 详情</span>");
  });

  it("DevShell 元数据选择器内联显示失败并独立拥有错误", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("const [toggleError, setToggleError] = useState<string | null>(null)");
    expect(devShell).toContain('role="alert" className="mx-2 mt-2 rounded border border-localapp-dev-danger');
    expect(devShell).toContain('error instanceof Error ? error.message : `${localizedLabel}更新失败`');
    expect(devShell).toContain("onToggle={(labelId, selected) => onToggleLabel(labelId, selected)}");
    expect(devShell).toContain("onToggle={(userId, selected) => onToggleAssignee(userId, selected)}");
    expect(devShell).not.toContain("runMetadataAction(onToggleLabel(labelId, selected))");
    expect(devShell).not.toContain("runMetadataAction(onToggleAssignee(userId, selected))");
  });

  it("DevShell 仅向本地 owner 提供当前页批量状态操作并保留失败项", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(devShell).toContain('canBulkManage = Boolean(user && (user.id === pageOwnerId || user.role === "owner"))');
    expect(devShell).toContain('aria-label="选择当前页全部 Issue"');
    expect(devShell).toContain('role="status" aria-live="polite" aria-atomic="true" aria-label="Issue 选择状态"');
    expect(devShell).toContain('selectedIssueCount > 0 ? `已选择 ${selectedIssueCount} 条 Issue` : "未选择 Issue"');
    expect(devShell).toContain('aria-label={`选择 Issue #${issue.issue_number}`}');
    expect(workspace.match(/inline-flex h-11 w-11 shrink-0 cursor-pointer[^\"]*focus-within:ring-2/g)).toHaveLength(2);
    expect(devShell).toContain("inline-flex h-11 w-11 shrink-0 cursor-pointer");
    expect(devShell).toContain("sm:h-6 sm:w-6");
    expect(devShell).toContain('role="toolbar" aria-label="批量 Issue 操作"');
    expect(devShell).toContain("selectAllIssuesRef.current?.focus()");
    expect(devShell).toContain("Promise.allSettled");
    expect(devShell).toContain("setSelectedIssueIds(new Set(failedIds))");
    expect(devShell).toContain("条失败，可重试失败项");
    expect(devShell).toContain("正在更新 ${selectedIssueCount} 条 Issue");
    expect(devShell).toContain("条已选 Issue 已不在当前列表，选择已更新");
    expect(devShell).toContain("selectionReconciliationFocusRef.current = bulkToolbarFocusedRef.current ||");
    expect(devShell).toContain("bulkToolbarFocusedRef.current");
    expect(devShell).toContain("onFocusCapture={() => { bulkToolbarFocusedRef.current = true; }}");
    expect(devShell).toContain("if (toolbar.isConnected && !toolbar.contains(document.activeElement))");
  });

  it("DevShell mirrors milestone management, filtering, creation, and detail assignment", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain('type DevIssuesView =');
    expect(devShell).toContain('| { kind: "milestones" }');
    expect(devShell).toContain('aria-label="管理 Issue 里程碑"');
    expect(devShell).toContain('aria-label="按里程碑筛选"');
    expect(devShell).toContain('aria-label="设置里程碑"');
    expect(devShell).toContain('aria-label="里程碑"');
    expect(devShell).toContain('requestDevIssue<DevIssueMilestoneDefinition[]>(`/api/issues/milestones?${params.toString()}`');
    expect(devShell).toContain('event.stopPropagation(); setConfirmingDelete(null);');
    expect(devShell).toContain('/api/issues/milestones');
    expect(devShell).toContain('updateIssueCollaboration("milestone", { milestoneId })');
    expect(devShell).toContain('user.id === pageOwnerId || user.role === "owner"');
  });

  it("移动 DevShell nav 隐藏次要文案并为左右操作提供收缩边界", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("overflow-x-auto");
    expect(devShell).toContain("localapp-platform-nav-right flex shrink-0");
    expect(devShell).toContain("data-localapp-presence-count");
    expect(devShell).toContain('className="hidden sm:inline"');
    expect(devShell).toContain("data-localapp-user-label");
    expect(devShell).toContain("hidden md:inline");
    expect(devShell).toContain('className="flex shrink-0 items-center gap-1"');
  });

  it("DevShell Issue 焦点陷阱排除 CSS 隐藏区域", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("function isDevIssueFocusTargetVisible");
    expect(devShell).toContain('style.display === "none" || style.visibility === "hidden"');
    expect(devShell).toContain("isDevIssueFocusTargetVisible(element, dialog)");
  });

  it("DevShell Issue 列表请求拥有覆盖 JSON body 的截止时间", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");

    expect(devShell).toContain("const DEV_ISSUE_LIST_REQUEST_TIMEOUT_MS = 8_000");
    expect(devShell).toContain("controller.abort(new DOMException(\"Issue list request timed out\", \"TimeoutError\"))");
    expect(devShell).toContain("window.clearTimeout(requestTimeout)");
    expect(devShell).toContain('requestError.name === "TimeoutError" ? "Issue 服务暂不可用"');
  });

  it("DevShell Issue 详情读取与静默同步共享截止时间", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(devShell).toContain("async function requestDevIssue<T>");
    expect(devShell).toContain("const DEV_ISSUE_REQUEST_TIMEOUT_MS = 8_000");
    expect(workspace).toContain("requestDevIssue<DevIssueDetail>(`${endpoint}?${query.toString()}`, { credentials: \"include\" })");
    expect(workspace).toContain("requestDevIssue<DevIssueDetail>(`/api/issues/${issueId}?${params.toString()}`, { credentials: \"include\" })");
  });

  it("DevShell Issue 写操作、附件与历史读取共享截止时间", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    const composer = devShell.slice(devShell.indexOf("function DevIssueComposer"), devShell.indexOf("function DevIssueMetadataPicker"));
    const revisions = devShell.slice(devShell.indexOf("function DevIssueRevisionDialog"), devShell.indexOf("function DevIssueDetailPanel"));

    expect(workspace).not.toContain("await readDevIssueResponse<");
    expect(workspace).toContain("requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/comments`");
    expect(workspace).toContain("requestDevIssue<DevIssueDetail>(`/api/issues/${detail.issue.id}/reactions`");
    expect(composer).toContain('requestDevIssue<DevIssueAttachment>("/api/issues/attachments"');
    expect(revisions).toContain("requestDevIssue<DevIssueRevision[]>(`${target}?${query.toString()}`");
  });

  it("DevShell 标签与负责人目录共享请求截止时间和卸载中止", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(workspace).toContain("requestDevIssue<DevIssueLabelDefinition[]>(`/api/issues/labels?${params.toString()}`");
    expect(workspace).toContain('requestDevIssue<{ users?: DevUserBasic[]; source?: string }>("/api/dev/users"');
    expect(devShell).toContain("const DEV_ISSUE_CATALOG_RETRY_DELAY_MS = 300");
    expect(devShell).toContain("function waitForDevIssueCatalogRetry(");
    expect(devShell).toContain("async function requestDevIssueCatalogWithRetry");
    expect(workspace).toContain("requestDevIssueCatalogWithRetry((signal) => requestDevIssue<DevIssueLabelDefinition[]>");
    expect(workspace).toContain("requestDevIssueCatalogWithRetry((signal) => requestDevIssue<DevIssueMilestoneDefinition[]>");
    expect(workspace).toContain("requestDevIssueCatalogWithRetry((signal) => requestDevIssue<{ users?: DevUserBasic[];");
    expect(workspace).toContain('controller.abort(new DOMException("Superseded", "AbortError"))');
  });

  it("DevShell 不依赖 Tailwind 默认 palette class", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const forbiddenPatterns = [
      "bg-zinc-",
      "text-zinc-",
      "border-zinc-",
      "bg-indigo-",
      "text-indigo-",
      "border-indigo-",
      "bg-emerald-",
      "text-emerald-",
      "from-indigo-",
      "via-fuchsia-",
      "to-orange-",
    ];

    for (const pattern of forbiddenPatterns) {
      expect(devShell, `DevShell must not use ${pattern}`).not.toContain(pattern);
    }
  });

  it("runtime preset 声明 DevShell 专属样式 token", () => {
    const preset = readTemplateFile(path.join("runtime", "styles", "preset.css"));
    const requiredTokens = [
      "--localapp-dev",
      "--localapp-dev-foreground",
      "--localapp-dev-muted",
      "--localapp-dev-muted-foreground",
      "--localapp-dev-border",
      "--localapp-dev-focus",
      "--localapp-dev-accent",
      "--localapp-dev-accent-foreground",
      "--localapp-dev-stripe-from",
      "--localapp-dev-stripe-via",
      "--localapp-dev-stripe-to",
      "--color-localapp-dev",
      "--color-localapp-dev-muted",
      "--color-localapp-dev-border",
      "--color-localapp-dev-focus",
    ];

    for (const token of requiredTokens) {
      expect(preset, `runtime preset must define ${token}`).toContain(token);
    }
  });

  it("runtime preset 将 DevShell 源码加入 Tailwind 扫描范围", () => {
    const preset = readTemplateFile(path.join("runtime", "styles", "preset.css"));

    expect(preset).toContain('@source "../dev-shell.tsx";');
  });

  it("preset theme 映射支持生成 DevShell token utility", () => {
    const preset = readTemplateFile(path.join("runtime", "styles", "preset.css"));

    expect(preset).toContain("--color-localapp-dev-muted: var(--localapp-dev-muted)");
    expect(preset).toContain("--color-localapp-dev-muted-foreground: var(--localapp-dev-muted-foreground)");
    expect(preset).toContain("--color-localapp-dev-border: var(--localapp-dev-border)");
    expect(preset).toContain("--color-localapp-dev-focus: var(--localapp-dev-focus)");
    expect(preset).toContain("--color-localapp-dev-stripe-from: var(--localapp-dev-stripe-from)");
    expect(preset).toContain("--color-localapp-dev-stripe-via: var(--localapp-dev-stripe-via)");
    expect(preset).toContain("--color-localapp-dev-stripe-to: var(--localapp-dev-stripe-to)");
  });

  it("DevShell success token 与白字达到 AA 对比度", () => {
    const preset = readTemplateFile(path.join("runtime", "styles", "preset.css"));
    expect(preset).toContain("--localapp-dev-success: oklch(0.54 0.13 165)");
  });

  it("DevShell 提供与 Hosted 同构的 Issue dependencies 工作区和阻塞标识", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const detailPanel = devShell.slice(devShell.indexOf("function DevIssueDetailPanel"), devShell.indexOf("function DevToolkitSidebar"));
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));

    expect(devShell).toContain("function DevIssueDependencies(");
    expect(devShell).toContain("dependencySummary?: { blockedBy: number; blocking: number; unresolvedBlockers: number; isBlocked: boolean }");
    expect(devShell).toContain('data-localapp-issue-dependencies');
    expect(devShell).toContain("被以下 Issue 阻塞");
    expect(devShell).toContain("正在阻塞");
    expect(workspace).toContain("/dependencies/blocked-by/");
    expect(workspace).toContain("direction === \"blockedBy\"");
    expect(detailPanel.indexOf("<DevIssueSubIssues")).toBeLessThan(detailPanel.indexOf("<DevIssueDependencies"));
    const dependenciesIndex = detailPanel.indexOf("<DevIssueDependencies");
    expect(dependenciesIndex).toBeLessThan(detailPanel.indexOf("<DevIssueTimeline", dependenciesIndex));
    expect(devShell).toContain('aria-label="已阻塞：存在未解决依赖"');
    expect(devShell).toContain("Boolean(issue.is_blocked)");
    const preset = readTemplateFile(path.join("runtime", "styles", "preset.css"));
    expect(preset).toContain("[data-localapp-sub-issues] > header > div:last-child");
    expect(preset).toContain("flex-basis: 100%");
  });

  it("DevShell 创建页提供竞态安全且非阻塞的潜在重复 Issue 建议", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    expect(devShell).toContain("function DevIssuePotentialDuplicates(");
    expect(workspace).toContain("/api/issues/potential-duplicates?");
    expect(workspace).toContain("Array.from(createBody).length < 100");
    expect(workspace).toContain("window.setTimeout(() =>");
    expect(workspace).toContain("controller.abort()");
    expect(workspace).toContain("onBodyChange={setCreateBody}");
    expect(devShell).toContain("const navigateToIssueNumber = useCallback((issueNumber: number)");
    expect(workspace).toContain("onIssueNumberNavigate(issueNumber)");
    expect(workspace).toContain("重复项建议暂不可用");
    expect(workspace).toContain("<DevIssuePotentialDuplicates");
    expect(workspace).toContain("submitDisabled={!createTitle.trim() || createTitleTooLong}");
  });

  it("DevShell 完全离线提供应用 Issue 模板选择与草稿优先", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    expect(workspace).toContain("/api/issues/config?");
    expect(devShell).toContain("function DevIssueTemplateChooser(");
    expect(workspace).toContain('setView({ kind: "templates" })');
    expect(workspace).toContain("hasPersistedDevIssueCreateContent");
    expect(workspace).toContain("模板中的标签已不可用");
    expect(devShell).toContain("打开空白 Issue");
    expect(workspace).toContain("initialBody={createInitialBody}");
    expect(workspace).toContain("onCreateSubIssue={() => showCreateIssue(detail.issue.id)}");
  });

  it("DevShell 完全离线提供当前用户私有保存视图", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    const workspace = devShell.slice(devShell.indexOf("function DevIssuesWorkspace"), devShell.indexOf("function DevIssueMarkdown"));
    expect(devShell).toContain("type DevIssueSavedView");
    expect(workspace).toContain("/api/issues/views?");
    expect(workspace).toContain("/api/issues/views/${viewId}/copy");
    expect(workspace).toContain("保存的视图");
    expect(workspace).toContain("保存当前 Issue 视图");
    expect(workspace).toContain("有未保存更改");
    expect(workspace).toContain("删除保存视图");
    expect(workspace).toContain('<optgroup label="保存的视图">');
    expect(workspace).not.toContain("savedView.user_id");
  });

  it("DevShell 评论 Composer 完全离线提供个人保存回复", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("/api/issues/saved-replies");
    expect(devShell).toContain('aria-label="保存回复"');
    expect(devShell).toContain('aria-label="搜索保存回复"');
    expect(devShell).toContain('aria-keyshortcuts="Control+."');
    expect(devShell).toContain('reply.body.indexOf("%cursor%")');
    expect(devShell).toContain('savedReplies = textareaLabel === "添加评论"');
    expect(devShell).toContain("确认删除");
  });

  it("DevShell 同构展示并撤销 Duplicate Issue 关系", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("function DevIssueDuplicates(");
    expect(devShell).toContain("Canonical Issue #");
    expect(devShell).toContain("撤销重复标记");
    expect(devShell).toContain("marked_as_duplicate");
    expect(devShell).toContain("unmarked_as_duplicate");
    expect(devShell).toContain("/duplicate/${canonicalIssueId}");
    expect(devShell).toContain("is_duplicate?: number");
    expect(devShell).toContain(">重复</span>");
    expect(devShell).toContain("setUnmarking(true)");
    expect(devShell).toContain('succeeded ? document.querySelector<HTMLElement>("[data-localapp-issue-title]") : undoRef.current');
  });

  it("DevShell 同构展示并导航 Issue cross-reference", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("function DevIssueCrossReference(");
    expect(devShell).toContain("cross_reference");
    expect(devShell).toContain("中提到了此 Issue");
    expect(devShell).toContain("createDevIssueCrossReferenceHref");
    expect(devShell).toContain("pendingReferenceCommentIdRef");
    expect(devShell).toContain('item.kind === "event" ? [item.event.actor_id] : [item.crossReference.actor_id]');
    expect(devShell).toContain("pendingIssueChangedIdsRef.current.add(changed.issueId ?? null)");
  });

  it("DevShell 完全离线提供单条置顶评论", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("pinned_at?: string | null");
    expect(devShell).toContain("pinned_by?: string | null");
    expect(devShell).toContain("/comments/${commentId}/pin");
    expect(devShell).toContain('method: pinned ? "PUT" : "DELETE"');
    expect(devShell).toContain("canManageCommentPins");
    expect(devShell).toContain("data-localapp-issue-comment-pinned");
    expect(devShell).toContain("filteredTimeline.unshift(pinnedComment)");
    expect(devShell).toContain('label: comment.pinned_at ? "取消置顶评论" : "置顶评论"');
    expect(devShell).toContain("disabled: pinningCommentId !== null");
    expect(devShell).toContain("setPinningCommentId(comment.id)");
    expect(devShell).toContain("{comment.pinned_at && <div");
    expect(devShell).not.toContain("{(comment.pinned_at || (canManageCommentPins && !comment.deleted_at)) && <div");
    expect(devShell).toContain("comment_pinned");
    expect(devShell).toContain("comment_unpinned");
  });

  it("DevShell 完全离线提供评论最小化与临时展开", () => {
    const devShell = readTemplateFile("runtime/dev-shell.tsx");
    expect(devShell).toContain("DevIssueCommentMinimizedReason");
    expect(devShell).toContain("DEV_ISSUE_COMMENT_MINIMIZED_REASON_LABELS");
    expect(devShell).toContain("/comments/${commentId}/minimize");
    expect(devShell).toContain("data-localapp-issue-comment-minimized");
    expect(devShell).toContain("expandedMinimizedComments");
    expect(devShell).toContain('role="alertdialog" aria-label="最小化评论"');
    expect(devShell).toContain("comment_minimized");
    expect(devShell).toContain("comment_unminimized");
  });

  it("DevShell 关键控件的 computed style 不回退到透明背景或默认文本色", () => {
    const css = cssForRuntimeTokens();
    expect(css).toContain("--localapp-dev-muted:");
    expect(css).toContain("--localapp-dev-accent:");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const devButton = document.createElement("button");
    devButton.className = "bg-localapp-dev-muted text-localapp-dev-muted-foreground border-localapp-dev-border ring-localapp-dev-focus";
    document.body.appendChild(devButton);

    const userState = document.createElement("span");
    userState.className = "text-localapp-dev-muted-foreground";
    document.body.appendChild(userState);

    const button = document.createElement("button");
    button.className = "bg-localapp-dev-accent text-localapp-dev-accent-foreground";
    document.body.appendChild(button);

    expect(getComputedStyle(devButton).backgroundColor).not.toBe("");
    expect(getComputedStyle(devButton).backgroundColor).not.toBe(TRANSPARENT);
    expect(getComputedStyle(devButton).color).not.toBe("");
    expect(getComputedStyle(devButton).color).not.toBe("rgb(0, 0, 0)");
    expect(getComputedStyle(devButton).outlineColor).not.toBe("");
    expect(getComputedStyle(devButton).outlineColor).not.toBe("rgb(0, 0, 0)");
    expect(getComputedStyle(userState).color).not.toBe("");
    expect(getComputedStyle(userState).color).not.toBe("rgb(0, 0, 0)");
    expect(getComputedStyle(button).backgroundColor).not.toBe("");
    expect(getComputedStyle(button).backgroundColor).not.toBe(TRANSPARENT);
    expect(getComputedStyle(button).color).not.toBe("");
    expect(getComputedStyle(button).color).not.toBe("rgb(0, 0, 0)");
  });
});
