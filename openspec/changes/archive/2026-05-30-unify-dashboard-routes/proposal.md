## Why

`/my/apps`、`/my/info` 等 dashboard 页面返回 JSON 404，因为 serve.ts 的通配路由 `/:userId/:name` 把 "my" 当作 userId 拦截了这些路径。Admin 页面有独立的 `admin-serve.ts` 注册在 serve.ts 之前所以不受影响，但 `/my/*` 路径没有对应的处理器。此外，admin 本质上就是带额外权限的用户，没有必要维护两套独立的路由体系。

## What Changes

- **BREAKING**: `/admin/*` 路径废弃，所有 admin 页面迁移到 `/my/*` 下（如 `/admin/dashboard` → `/my/dashboard`）
- `/my/*` 通配路由注册在 `/:userId/:name` 之前，统一处理所有 dashboard 页面
- Admin 页面通过角色检查控制访问，非 admin 用户访问 admin 页面返回 403 或 redirect
- 原有 `/admin/groups` 重命名为 `/my/orgs`，避免与 `/my/groups`（用户自己的群组）冲突
- 404 响应从 JSON 改为 HTML 页面渲染
- Sidebar 导航 href 统一更新
- 清理 `admin-serve.ts`，合并到新的 dashboard 路由处理器

## Capabilities

### New Capabilities
- `dashboard-routing`: 统一的 `/my/*` 路由系统，处理所有 dashboard 页面的静态 HTML 服务，包含登录检查和角色检查

### Modified Capabilities
- `admin-serve`: 路由路径从 `/admin/*` 迁移到 `/my/*`，合并到统一路由处理器
- `admin-panel`: admin 页面的 URL 路径变更（`/admin/*` → `/my/*`）
- `user-dashboard-ui`: sidebar 导航链接从 `/admin/*` 更新为 `/my/*`
- `homepage-redirect`: 404 响应从 JSON 改为 HTML 渲染

## Impact

- **Server**: `routes/admin-serve.ts` 废弃/重写，`routes/serve.ts` 新增 `/my/*` 路由
- **Web**: `app/(dashboard)/admin/*` 页面文件迁移到 `app/(dashboard)/my/*` 下
- **Web**: `components/app-shell.tsx` sidebar 链接更新
- **Server**: `index.ts` 路由注册调整
- **Tests**: 所有引用 `/admin/*` 的测试更新路径
