## Context

当前 dashboard 页面由两个独立的路由文件处理：
- `admin-serve.ts` — 处理 `/admin/*`，注册在 `serve.ts` 之前，不受通配路由影响
- `serve.ts` — 处理 `/:userId/:name` 通配路由，会拦截 `/my/apps`、`/my/info` 等路径

问题：`/my/*` 路径没有独立处理器，被通配路由当作 `{userId: "my", name: "apps"}` 处理，导致 JSON 404。

## Goals / Non-Goals

**Goals:**
- 统一所有 dashboard 页面到 `/my/*` 路径下
- 解决 `/my/apps`、`/my/info` 等页面 404 问题
- Admin 页面与普通用户页面共存于 `/my/*`，通过角色检查控制访问
- 404 响应渲染 HTML 而非 JSON

**Non-Goals:**
- 不改变 Next.js 的布局结构（仍使用 `(dashboard)` layout）
- 不改变页面组件的内部逻辑
- 不处理 `/profile/*` 旧路径的向后兼容（已在上一轮变更中硬切到 `/my/*`）

## Decisions

### 1. 路由方案：新建 `my-serve.ts` 统一处理 `/my/*`

**选择**: 新建 `my-serve.ts`，注册在 `serve.ts` 之前，使用 `/my` 和 `/my/*` 通配路由。

**替代方案**:
- 在 `admin-serve.ts` 中扩展 — 增加耦合，语义不清
- 在 `serve.ts` 中添加显式路由 — `serve.ts` 已经很长，职责混杂

**理由**: 独立文件职责清晰，与 `admin-serve.ts` 平行关系，方便后续维护。

### 2. Admin 页面 URL 映射

| 旧路径 | 新路径 | 备注 |
|--------|--------|------|
| `/admin` | `/my/dashboard` | Admin 概览 |
| `/admin/dashboard` | `/my/dashboard` | 同上 |
| `/admin/analytics` | `/my/analytics` | 运营大盘 |
| `/admin/users` | `/my/users` | 用户管理 |
| `/admin/pages` | `/my/pages` | 应用管理 |
| `/admin/groups` | `/my/orgs` | 避免与 `/my/groups` 冲突 |
| `/admin/settings` | `/my/settings` | 系统配置 |

### 3. 角色检查策略

- 普通 `/my/*` 页面（info, apps, keys, groups）：仅检查登录状态
- Admin `/my/*` 页面（dashboard, analytics, users, pages, orgs, settings）：检查 admin 角色
- 非 admin 访问 admin 页面：redirect 到 `/`

### 4. Next.js 文件迁移

将 `app/(dashboard)/admin/*` 下的页面文件移动到 `app/(dashboard)/my/*` 对应路径。`admin/page.tsx`（redirect 到 `/admin/dashboard`）改为 `my/dashboard/page.tsx` 或删除（因为路由已统一）。

### 5. 404 HTML 渲染

在 `serve.ts` 的 `/:userId/:name` 路由中，当 `readPageMeta` 返回 null 时，返回一个简单的 HTML 404 页面而非 JSON。HTML 内容与登录页面风格一致（浅色主题）。

## Risks / Trade-offs

- **URL 变更影响** → `/admin/*` 路径彻底废弃，书签/链接会失效。这是有意的硬切，与上次 `/profile/*` → `/my/*` 策略一致。
- **`/my/groups` 命名冲突** → Admin 的 groups 管理（全局群组）与用户的 groups（我的群组）功能不同，用 `/my/orgs` 区分。
- **`admin-serve.ts` 废弃** → 删除该文件，所有逻辑合并到 `my-serve.ts`。
