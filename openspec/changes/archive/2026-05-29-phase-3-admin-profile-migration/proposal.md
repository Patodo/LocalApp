## Why

当前 admin SPA (`packages/admin/`) 和 profile SPA (`packages/profile/`) 是独立的 Vite + React 应用，各自有独立的构建配置、入口文件、API 层。在 [LocalApp 总体方案](../../../docs/plan.md) Phase 2 创建了统一的 Next.js 应用骨架和认证页面后，Phase 3 需要将两个 SPA 的功能全部迁移到 `packages/web/` 中，实现统一的前端架构。迁移完成后可归档旧的 SPA 代码。

## What Changes

- 将 admin SPA 所有页面迁移到 `packages/web/app/(dashboard)/admin/`
- 将 profile SPA 所有页面迁移到 `packages/web/app/(dashboard)/profile/`
- 创建共享的 AppShell 布局组件（侧边栏 + 顶栏 + 内容区），替代 admin 的 `Layout.tsx` 和 profile 的 `TabLayout.tsx`
- 创建共享的布局 (dashboard)/layout.tsx（认证保护 + AppShell）
- Admin 页面：Dashboard、Analytics、Users、Pages、Groups、Settings
- Profile 页面：Profile、Apps、Keys、Groups
- 将手写的 CSS class 替换为 Tailwind 工具类 + shadcn/ui 组件
- 保留所有现有 API 端点和交互逻辑
- 归档旧的 admin 和 profile package（不移除，保留作为参考）
- 确保 URL 路由向前兼容（`/admin/*`、`/profile`）
- Recharts 保留用于 Analytics 图表，嵌入作为 Client Component

## Capabilities

### New Capabilities

- `admin-dashboard`: 管理后台仪表盘，系统概览统计卡片、最近部署列表
- `admin-analytics`: 运营大盘，请求量/页面浏览/错误率趋势图、Top 页面排行
- `admin-users`: 用户管理，分页列表、删除、重置密码
- `admin-pages`: 应用管理，全局页面列表、按用户筛选、删除
- `admin-groups`: 系统分组管理，分组 CRUD、成员管理
- `admin-settings`: 系统配置展示（只读）
- `profile-settings`: 个人资料编辑、头像上传、密码修改
- `profile-apps`: 我的应用列表、版本历史、删除
- `profile-keys`: API Key 管理、创建、复制
- `profile-groups`: 个人分组管理

### Modified Capabilities

无。从旧的独立 SPA 迁移到统一 Next.js 应用，功能行为不变。

## Impact

- 新增: `packages/web/app/(dashboard)/admin/` (6 个页面)
- 新增: `packages/web/app/(dashboard)/profile/` (4 个页面)
- 新增: `packages/web/components/app-shell.tsx` (共享布局)
- 修改: `packages/server/src/routes/admin-serve.ts`（重定向旧的 SPA 路由到 Next.js 页面）
- 归档: `packages/admin/`、`packages/profile/`（不移除，加 DEPRECATED 标记）
- 不影响: API 端点、数据库、CLI、SDK
