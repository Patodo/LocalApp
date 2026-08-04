## Context

当前 admin 和 profile 是两个独立的 Vite SPA，各自有：

- 独立的 `package.json`、`vite.config.ts`、`tsconfig.json`
- 独立的 `index.html` 入口
- 独立的 API 层（`api/admin.ts`、`api/me.ts` 等）
- 手写的 CSS class (`shared.css`) + 部分 Tailwind
- 各自的布局组件（`Layout.tsx` 侧边栏、`TabLayout.tsx` 标签栏）

迁移到统一的 Next.js 应用后，这些将合并到 `packages/web/` 中，共享：

- 构建配置、依赖管理
- AppShell 布局组件
- 设计 token、Tailwind 配置
- shadcn/ui 组件库

本变更是 [LocalApp 总体方案](../../../docs/plan.md) Phase 3 的实施内容。Phase 2 (`phase-2-nextjs-auth`) 已完成 Next.js 应用骨架和认证页面。

## Goals / Non-Goals

**Goals:**
- 所有 admin 页面迁移到 Next.js，功能完全一致
- 所有 profile 页面迁移到 Next.js，功能完全一致
- 共享的 AppShell 布局组件（侧边栏、顶栏、响应式）
- URL 兼容（`/admin/*`、`/profile`）
- 所有现有 API 调用保持不变

**Non-Goals:**
- 不修改任何 API 端点
- 不做设计系统刷新（留待 Phase 5）
- 不改变信息架构
- 不添加新功能
- 不修改服务器代码（仅路由层面切换到 Next.js 静态文件）

## Decisions

### Decision 1: 布局策略

**选择：** 使用嵌套 layout.tsx — `(dashboard)/layout.tsx` 提供认证保护 + AppShell 骨架，admin 和 profile 各自使用独立的 sub-layout

```
(dashboard)/
  layout.tsx          # 认证 Guard + AppShell (侧边栏 + 内容区)
  admin/
    layout.tsx        # Admin 页面专用的导航状态
    page.tsx          # 重定向到 /admin/dashboard
    dashboard/page.tsx
    analytics/page.tsx
    users/page.tsx
    users/[id]/page.tsx
    pages/page.tsx
    groups/page.tsx
    groups/[id]/page.tsx
    settings/page.tsx
  profile/
    layout.tsx        # Profile 的 Tab 导航
    page.tsx          # 重定向到 /profile/info
    info/page.tsx     # 个人资料
    apps/page.tsx
    keys/page.tsx
    groups/page.tsx
```

**理由：** AppRouter 的嵌套布局是最适合的场景。认证保护在顶层 layout 完成，子路由自动继承。Admin 和 Profile 各自的导航状态在 sub-layout 中处理。

### Decision 2: Sidebar 导航设计

**选择：** 在 AppShell 中实现可折叠侧边栏，图标 + 文字标签。折叠后只显示图标。当前路由高亮。

**理由：** 统一 admin 和 profile 的导航体验。侧边栏在暗色模式下效果更好。

### Decision 3: Recharts 图表处理

**选择：** Analytics 页面使用 recharts，标记为 `"use client"` Client Component。不迁移时保持相同的图表配置。

**理由：** recharts 依赖浏览器 API（SVG、resize），无法在 Server Component 中使用。

### Decision 4: API 调用层

**选择：** 保留当前 `fetch()` + `useState`/`useEffect` 模式，不做数据获取层的框架化（不引入 React Query/SWR）。

**理由：** 减少迁移范围。数据获取层的优化是 Phase 5 的可选项。

## Risks / Trade-offs

- **页面数量多** → 6 个 admin + 4 个 profile = 10 个页面。逐页迁移，每页独立切换路由
- **Recharts 在 Server Component 中的处理** → Analytics 页面作为 Client Component 岛。已验证 recharts 可正常在 Next.js 静态导出中使用
- **路由变更** → 当前 admin SPA 使用 React Router 的客户端路由（如 `/admin/users`），Next.js 使用文件路由。URL 保持兼容，无需变更
- **旧 SPA 和 Next.js 页面并行** → 通过 Fastify 路由控制：切换前旧 SPA 处理请求，迁移完成后切换到 Next.js 静态文件
