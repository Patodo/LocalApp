## Why

当前 LocalApp 没有管理面概念——没有管理员角色、没有跨用户的 API、也没有用户管理能力。所有管理操作只能通过 CLI 以单个用户视角进行，无法查看其他用户的页面、无法统计系统资源使用情况、无法禁用或删除用户。随着用户增长，需要一个管理员视角来掌控整个平台。

## What Changes

- 在 `users` 表新增 `role` 字段（`'admin'` | `'user'`），bootstrap 用户自动标记为 admin
- 新增 `adminAuth` 中间件，校验当前用户 `role === 'admin'`，应用于 `/api/admin/*` 路由组
- 新增 7 个管理 API：用户列表/详情/删除、全局页面列表/详情/删除、系统概览统计
- CLI 新增 `localapp admin` 子命令组：`admin users`、`admin pages`、`admin stats`

## Capabilities

### New Capabilities

- `admin-role`: 管理员角色模型——users 表 role 字段、adminAuth 中间件、角色判断逻辑
- `admin-api`: 管理专用 API 端点——跨用户的用户管理、页面管理、系统统计

### Modified Capabilities

- `user-auth`: 用户注册/登录流程需感知 role 字段，JWT payload 新增 role，`/api/me` 返回 role

## Impact

- `packages/server/src/lib/meta-sqlite.ts` — users 表新增 role 列，新增 listUsers、deleteUser 等查询函数
- `packages/server/src/types/models.ts` — User 类型新增 role 字段
- `packages/server/src/plugins/auth.ts` — 新增 adminAuth 中间件导出
- `packages/server/src/plugins/session.ts` — JWT payload 新增 role
- `packages/server/src/routes/` — 新增 admin.ts 路由文件
- `packages/server/src/index.ts` — 注册 admin 路由组
- `packages/cli/src/` — 新增 admin 命令模块
- 无前端改动，无 SDK 改动
