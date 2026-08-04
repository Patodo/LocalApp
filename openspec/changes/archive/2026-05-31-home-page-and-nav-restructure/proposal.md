## Why

平台缺少一个真正的首页。当前 `/` 仅做重定向，用户登录后直接跳到 `/profile`，没有一个概览所有相关内容的入口。同时，导航系统存在两个问题：(1) 侧边栏和 serve 页 navbar 都没有 Home 入口，用户无法快速回到主页；(2) `/profile/*` 路径语义不直观，应该用 `/my/*` 表达"我的"空间。

此外，收藏和访问历史的前端 UI 已部分实现（serve 页 navbar 的收藏按钮、platform-shell 的收藏状态管理），但后端 API 和数据库完全缺失，导致这些功能静默失败。

## What Changes

- **新建 HOME 主页** — `/` 从重定向改为真实页面，展示三个模块：我的应用（卡片网格）、收藏应用（列表）、最近访问（列表），每个模块只显示前 N 条，带"查看全部"链接
- **路由重组 `/profile/*` → `/my/*`** — 硬切换，不保留旧路由。所有内部链接和侧边栏导航同步更新
- **侧边栏加入 Home 入口** — Home 图标固定在侧边栏顶部，始终可见；下方按条件显示 `/my/*` 或 `/admin/*` 区域
- **serve 页 navbar 加入 Home 按钮** — House 图标固定在左上角（App Name 左侧），链接到 `/`
- **新建 favorites 后端** — 创建 `favorites` 数据表 + 4 个 API 路由（添加/删除/检查/计数）
- **page_views 表加 user_id 列** — 使 page_views 支持按用户查询最近访问，新增 `/api/me/recent` 端点
- **补全 `/api/me/pages` 系列端点** — 前端 profile/apps 页面调用的 session auth 端点目前不存在

## Capabilities

### New Capabilities
- `home-page`: 首页三模块布局（我的应用、收藏应用、最近访问），每模块前 N 条 + 查看全部
- `favorites-api`: 收藏功能的数据库表和 CRUD API（添加、删除、检查、计数、列表）
- `user-visit-history`: 基于 page_views 的 per-user 访问历史查询（加 user_id 列 + `/api/me/recent` 端点）

### Modified Capabilities
- `homepage-redirect`: `/` 从纯重定向改为渲染真实首页，未登录用户仍重定向到 `/login`
- `user-dashboard-ui`: 路由从 `/profile/*` 迁移到 `/my/*`，侧边栏加入 Home 入口和区域分隔
- `platform-shell`: navbar 左侧加入 Home 按钮（House 图标），链接到 `/`

## Impact

- **packages/web**: 页面目录重组（`/profile/*` → `/my/*`），新建首页组件，侧边栏和 navbar 组件更新
- **packages/server**: 新增 favorites 路由和数据库操作，page_views 表结构变更，新增 `/api/me/recent` 和 `/api/me/pages` 系列端点
- **packages/server/src/lib/meta-sqlite.ts**: 新增 favorites 表、page_views 加 user_id 列
- **无破坏性 API 变更**: 所有新端点为新增，不影响现有 API
