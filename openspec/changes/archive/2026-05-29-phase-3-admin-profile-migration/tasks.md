## 1. AppShell 布局组件

- [x] 1.1 创建 `(dashboard)/layout.tsx` — 认证 Guard + AppShell 骨架（可折叠侧边栏 + 顶栏 + 内容区）
- [x] 1.2 创建 `components/app-shell.tsx` — 侧边栏组件（导航链接、折叠状态、头像、登出按钮）
- [x] 1.3 配置侧边栏导航项：Admin nav 和 Profile nav 根据路径段自动切换 — **commit: "feat(web): implement AppShell layout with collapsible sidebar"**

## 2. Admin 页面迁移 (分组逐个迁移)

### 2.1 Dashboard
- [x] 2.1.1 迁移 Dashboard 页面 (`admin/dashboard/page.tsx`) — 统计卡片 + 最近部署列表
- [x] 2.1.2 替换 CSS class 为 Tailwind + shadcn/ui 组件
- [x] 2.1.3 验证统计 API 调用和数据显示 — **commit: "feat(web): migrate admin dashboard to Next.js"**

### 2.2 Analytics
- [x] 2.2.1 迁移 Analytics 页面 (`admin/analytics/page.tsx`) — 标记为 `"use client"`
- [x] 2.2.2 迁移趋势和数据展示，替换布局为 Tailwind
- [x] 2.2.3 迁移 Top 页面排行表
- [x] 2.2.4 验证 Analytics API 调用 — **commit: "feat(web): migrate admin analytics to Next.js"**

### 2.3 Users
- [x] 2.3.1 迁移 Users 页面 (`admin/users/page.tsx`) — 用户表格、分页
- [x] 2.3.2 迁移删除和重置密码操作
- [x] 2.3.3 验证用户管理 API 调用 — **commit: "feat(web): migrate admin users to Next.js"**

### 2.4 Pages
- [x] 2.4.1 迁移 Pages 页面 (`admin/pages/page.tsx`) — 全局应用列表、按用户筛选
- [x] 2.4.2 迁移删除操作
- [x] 2.4.3 验证 Pages API 调用 — **commit: "feat(web): migrate admin pages to Next.js"**

### 2.5 Groups
- [x] 2.5.1 迁移 Groups 页面 (`admin/groups/page.tsx`) — 双栏布局（分组列表 + 详情/编辑/成员管理）
- [x] 2.5.2 迁移分组 CRUD 和成员管理操作
- [x] 2.5.3 验证 Groups API 调用 — **commit: "feat(web): migrate admin groups to Next.js"**

### 2.6 Settings
- [x] 2.6.1 迁移 Settings 页面 (`admin/settings/page.tsx`) — 只读配置展示
- [x] 2.6.2 验证 Settings API 调用 — **commit: "feat(web): migrate admin settings to Next.js"**

## 3. Profile 页面迁移

### 3.1 个人资料
- [x] 3.1.1 迁移 Profile 页面 (`profile/info/page.tsx`) — 表单编辑、头像上传、密码修改
- [x] 3.1.2 替换表单为 Tailwind + shadcn/ui 组件 — **commit: "feat(web): migrate profile info to Next.js"**

### 3.2 应用列表
- [x] 3.2.1 迁移 Apps 页面 (`profile/apps/page.tsx`) — 应用卡片列表、版本历史
- [x] 3.2.2 验证应用 API 调用 — **commit: "feat(web): migrate profile apps to Next.js"**

### 3.3 API Keys
- [x] 3.3.1 迁移 Keys 页面 (`profile/keys/page.tsx`) — Key 列表、创建、复制
- [x] 3.3.2 验证 Keys API 调用 — **commit: "feat(web): migrate profile keys to Next.js"**

### 3.4 分组
- [x] 3.4.1 迁移 Groups 页面 (`profile/groups/page.tsx`) — 分组 CRUD、成员管理
- [x] 3.4.2 验证分组 API 调用 — **commit: "feat(web): migrate profile groups to Next.js"**

## 4. 路由切换和归档

- [x] 4.1 修改 `admin-serve.ts`，将 `/admin/*` 和 `/profile` 路由指向 Next.js 静态文件
- [x] 4.2 在旧的 admin/profile packages 中添加 `DEPRECATED.md` 说明
- [x] 4.3 完整的端到端验证 — 访问所有页面、执行关键操作 — **commit: "refactor: switch admin and profile to Next.js, deprecate old SPAs"**
