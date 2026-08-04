## Why

Phase 1（admin-foundation）提供了管理员 API，但操作只能通过 CLI 进行。对于日常管理场景（查看用户列表、浏览应用、快速操作），浏览器里的可视化面板比命令行直观得多。需要一个管理面板前端，让管理员在浏览器中完成所有管理操作。

## What Changes

- 创建独立的 React SPA 管理面板应用（`packages/admin/`）
- 面板包含 4 个页面：Dashboard 概览、用户管理、应用管理、系统配置
- 服务端新增 `/admin` 路由，直接服务管理面板 HTML/JS（不走用户页面体系）
- 管理面板通过 `/api/admin/*` 调用 Phase 1 的管理 API
- 访问 `/admin` 时服务端校验 JWT cookie 中的 admin 角色，非 admin 重定向到登录页

## Capabilities

### New Capabilities

- `admin-panel`: 管理面板前端应用——路由结构、布局组件、API 调用层、页面组件
- `admin-serve`: 服务端管理面板路由——`/admin` 入口、静态资源服务、admin 角色校验

### Modified Capabilities

- `page-serving`: 新增 `/admin` 路由优先级处理（`/admin` 不应匹配 `/:userId/:name` 模式）

## Impact

- `packages/admin/` — 全新 package，Vite + React + React Router SPA
- `packages/server/src/routes/` — 新增 admin-serve 路由
- `packages/server/src/index.ts` — 注册 admin-serve 路由
- `package.json` (root) — workspace 新增 packages/admin
- 依赖 admin-foundation 变更的 API
