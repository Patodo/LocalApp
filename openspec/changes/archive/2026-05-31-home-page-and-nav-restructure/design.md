## Context

当前平台 `/` 路径只是一个重定向（登录→`/profile`，未登录→`/login`），没有实际内容页面。侧边栏（`app-shell.tsx`）按 `pathname.startsWith("/admin")` 切换 admin/profile 导航，缺少 Home 入口。serve 页 navbar（`navbar.tsx`）只有应用相关操作和用户操作，也没有 Home 按钮。

后端方面：
- `meta.sqlite` 的 `page_views` 表只记录 `(page_path, visitor_id)`，无 `user_id`，无法按用户查询访问历史
- 收藏功能前端 UI 已实现（`platform-shell.tsx` + `navbar.tsx`），但后端无 `favorites` 表和 API 路由
- 前端 `profile/apps` 页面调用 `/api/me/pages` 系列端点，但服务端不存在这些路由

前端为 Next.js static export (`output: "export"`)，所有页面必须是客户端渲染。

## Goals / Non-Goals

**Goals:**
- 提供一个有实际内容的首页，让用户一眼看到自己的应用、收藏和最近访问
- 统一 `/my/*` 路由空间，替代 `/profile/*`
- 补全收藏和访问历史的后端 API，使前端已有 UI 能正常工作
- 侧边栏和 navbar 都有 Home 入口

**Non-Goals:**
- 不做"查看全部"的独立列表页（本次只做首页的前 N 条展示，"查看全部"链接指向 `/my/apps` 等已有页面）
- 不做收藏的分享或协作功能
- 不做访问历史的分页、筛选、清除等高级功能
- 不改动 admin 区域的任何路由或布局
- 不做 SEO 或 SSR 优化（保持纯 CSR）

## Decisions

### 1. page_views 加 user_id 列 vs 新建 user_visits 表

**选择**: ALTER TABLE `page_views` 加 `user_id TEXT` 列

**理由**: 最小改动。page_views 已有按 `created_at` 和 `page_path` 的索引，加一列后新增 `user_id` 索引即可支持 per-user 查询。老数据 `user_id` 为 NULL 自然不关联用户。新建表会导致数据重叠和写入双份。

**备选**: 新建 `user_visits` 表只记录已登录用户。更干净但需要双写，且无法复用已有索引和清理逻辑。

### 2. 侧边栏结构：Home 固定顶部 + 条件区域

**选择**: Home 图标始终固定在侧边栏顶部（第一个条目），下方根据用户角色和当前路径显示 `/my/*` 或 `/admin/*` 区域。admin 用户同时看到两个区域（用分隔线隔开）。

**理由**: Home 是最常用的导航操作，应该始终可达。分区显示让 admin 用户不需要切换上下文就能访问管理功能。

**备选**: Home 只在 profile 侧边栏显示，admin 侧没有。这会导致 admin 页面无法回到首页。

### 3. HOME 页面三模块的数据获取

**选择**: 三个独立的 `fetch` 并行请求，分别调用：
- `GET /api/me/pages?limit=8` — 我的应用
- `GET /api/me/favorites?limit=5` — 收藏应用
- `GET /api/me/recent?limit=5` — 最近访问

**理由**: 并行加载最快。三个数据源独立，一个失败不影响其他模块显示。每个模块独立 loading 状态。

**备选**: 单一 `/api/me/home` 聚合端点。减少请求数但增加后端复杂度，且一个查询慢会拖慢全部。

### 4. 路由硬切换 vs 保留重定向

**选择**: 直接重命名文件夹 `/profile/*` → `/my/*`，所有内部链接同步更新，不做旧路由重定向。

**理由**: 系统无外部用户，无旧链接兼容需求。保留重定向只会增加维护负担。

### 5. Navbar Home 按钮位置

**选择**: 放在 App Name 左侧（最左上角），使用 House 图标。

**理由**: 固定在视觉锚点（左上角），无论应用名称长短都不受影响。用户习惯左上角作为"回到起点"的操作。

## Risks / Trade-offs

- **[page_views 数据量]** → 随时间增长查询变慢。缓解：已有 30 天清理逻辑（`cleanOldLogs`），按 `user_id + created_at` 索引后前 5 条查询极快。
- **[favorites 前端已硬编码 API 路径]** → 后端实现时必须匹配前端已有调用路径（`/api/favorites/count`、`/api/favorites/check`、`POST /api/favorites`、`DELETE /api/favorites/:pagePath`）。
- **[Next.js static export 限制]** → 所有新页面必须是客户端组件，不能使用 server components 或 middleware。认证检查通过 `fetch("/api/me")` 实现。
