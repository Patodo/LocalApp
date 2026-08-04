## Context

`serve.ts` 的 `buildPlatformShell()` 是当前平台最复杂的服务器模板。它渲染：

- 顶部导航栏：应用名、Issue 按钮 (CircleDot 图标)、收藏按钮（星标 + 数量）、头像/登录按钮
- 全屏 iframe：加载用户应用
- Issue 模态框：列表视图、创建表单、筛选 (status/label)、状态切换
- 内联 CSS：导航栏样式、模态框样式、响应式基础
- 内联 JS：`openIssues()`、`closeIssues()`、`submitIssue()`、`toggleIssueStatus()`、`toggleFavorite()`、`timeAgo()` 等

迁移到 React 组件后，所有这些变为可维护的 TypeScript + Tailwind + shadcn/ui 组件。

本变更是 [LocalApp 总体方案](../../../docs/plan.md) Phase 4 的实施内容。Phase 1-3 已完成 SDK 包、Next.js 应用、认证页面和 Admin/Profile 迁移。

## Goals / Non-Goals

**Goals:**
- React 实现的平台 Shell 功能和现有 HTML 模板完全一致
- 导航栏：应用名、Issue 按钮、收藏按钮、头像/登录
- Issue 模态框：列表、创建、筛选、状态切换
- iframe 正确加载用户应用
- 所有交互通过现有 API 完成

**Non-Goals:**
- 不修改 Issue API（Phase 5 可能优化 UI 但不是本阶段）
- 不修改收藏功能 API
- 不修改 iframe 通信机制
- 不改变平台 Shell 的 URL（仍然是 `/:userId/:name`）

## Decisions

### Decision 1: 页面渲染策略

**选择：** Next.js 页面使用 Client Component 渲染。页面通过 `useEffect` + `/api/me` 获取当前用户信息。应用信息（pageName、userId）从 URL params 获取。

**理由：** 平台 Shell 是高度交互的（模态框、收藏切换、Issue 管理），必须为 Client Component。由于使用静态导出，无法在 Server Component 中访问 cookie 获取用户信息。

### Decision 2: 组件拆分

**选择：** 拆分为三个组件：

- `PlatformShell` — 顶层组件，管理全局状态（用户信息、收藏状态、iframe 加载状态），组合 Navbar + IssuesModal + iframe
- `Navbar` — 左侧（应用名 + Issue 按钮）+ 右侧（收藏按钮 + 头像/登录）
- `IssuesModal` — backdop + 面板 + 列表视图/表单视图切换 + 筛选 + 提交 + 状态切换

**理由：** 每个组件职责单一，可独立测试。和当前 serve.ts 的单体函数形成对比。

### Decision 3: iframe 通信

**选择：** 保持和现有相同的 iframe 通信机制。`window.postMessage` 用于父窗口和 iframe 之间的认证状态同步。

**理由：** 不改动 iframe 通信协议，确保已有应用不需要任何修改。

### Decision 4: 从 serve.ts 迁移到 Next.js 页面

**选择：** `/:userId/:name` 路由指向 Next.js 的 `serve/[userId]/[name]/page.tsx`。原 `serve.ts` 移除 HTML 模板但保留 API 路由。

**理由：** API 路由（`/serve/:userId/:name/api/*`、静态文件）必须留在 Fastify，因为需要访问文件系统和 SQLite。

## Risks / Trade-offs

- **iframe 认证状态同步** → 当前 serve.ts 在服务端渲染时就注入了用户信息（`visitorName`、`visitorAvatarUrl`），迁移到客户端渲染后需要在页面加载后通过 `/api/me` 获取。首屏可能有短暂的"未登录"闪烁
- **Issue 模态框的复杂 JS** → serve.ts 的 Issue JS 约 200 行。迁移时需要仔细保留所有交互逻辑
- **壳配置 (shell config)** → 当 `meta.shell.navbar === false` 时需要跳过壳直接重定向到 `/serve/...`。此逻辑可在 Next.js 页面加载时通过 API 判断并执行重定向
