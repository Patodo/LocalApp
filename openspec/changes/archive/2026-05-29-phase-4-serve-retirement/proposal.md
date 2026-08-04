## Why

`serve.ts` 中的 `buildPlatformShell()` 函数是约 200 行的 TypeScript 字符串模板，手写 HTML + inline CSS + inline JS。它渲染了所有用户应用的 iframe 外壳（导航栏、Issue 按钮、收藏功能、头像菜单等）。在 [LocalApp 总体方案](../../../docs/plan.md) Phase 2-3 已将所有平台页面迁移到 Next.js 后，Phase 4 需要将这个最后的服务器模板也迁移到 React 组件，使 `serve.ts` 退化为纯 API + 静态文件服务。

## What Changes

- 将 `buildPlatformShell()` 迁移为 Next.js 页面 `app/serve/[userId]/[name]/page.tsx`
- 平台 Shell React 组件：`PlatformShell`（iframe 包装器 + 导航栏 + 状态管理）
- 导航栏组件：`Navbar`（应用名、Issue 按钮、收藏按钮、头像、登录/登出）
- Issue 模态框组件：`IssuesModal`（Issue 列表、创建表单、筛选、状态切换）
- 所有认证状态由 Next.js 客户端管理（`useMe`、cookie 共享）
- `serve.ts` 移除 `buildPlatformShell()`、`buildLoginPage()`、`buildRegisterPage()`、`buildForceChangePasswordPage()`（Phase 2 已完成认证页面迁移）
- `serve.ts` 只保留核心路由：静态文件服务 (`/serve/:userId/:name/*`)、CRUD API、SPA fallback
- 此变更为 **BREAKING**：平台 Shell 渲染从服务端模板变为客户端 React 组件

## Capabilities

### New Capabilities

- `platform-shell`: 基于 React 的平台 Shell 组件，替代 serve.ts 服务器模板

### Modified Capabilities

无。

## Impact

- 新增: `packages/web/app/serve/[userId]/[name]/page.tsx`
- 新增: `packages/web/components/shell/platform-shell.tsx`
- 新增: `packages/web/components/shell/navbar.tsx`
- 新增: `packages/web/components/shell/issues-modal.tsx`
- 修改: `packages/server/src/routes/serve.ts`（大幅精简，移除所有 HTML 模板函数）
- 删除: `serve.ts` 中的 `buildPlatformShell()`、`buildLoginPage()`、`buildRegisterPage()`、`buildForceChangePasswordPage()`
- 不影响: CRUD API、文件上传、静态文件服务
