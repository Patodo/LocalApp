## Why

当前平台前端页面由三种不同方式渲染：`serve.ts` 的字符串模板（登录/注册/强制改密页面）、admin SPA (Vite + React)、profile SPA (Vite + React)。这导致设计 token 无法共享、组件无法复用、构建配置重复。作为 [LocalApp 总体方案](../../../docs/plan.md) Phase 2，需要创建统一的 Next.js 前端应用骨架，首先替换认证相关页面，为后续的全面迁移奠定基础。

## What Changes

- 新增 `packages/web/` — 基于 Next.js App Router 的统一前端应用
- 配置 Tailwind CSS v4 + shadcn/ui 组件库
- 配置 Geist 字体（Sans + Mono）
- 实现暗色模式基础设施（`next-themes` + Tailwind `dark:` 变体）
- 实现登录页面 (`/login`) — 替代 `serve.ts` 的 `buildLoginPage()`
- 实现注册页面 (`/register`) — 替代 `serve.ts` 的 `buildRegisterPage()`
- 实现强制改密页面 (`/force-change-password`) — 替代 `serve.ts` 的 `buildForceChangePasswordPage()`
- 实现首页重定向逻辑 (`/` → 已登录到 `/profile`，未登录到 `/login`)
- 配置 Fastify 托管 Next.js 静态导出产物
- 暂不迁移 admin / profile SPA 页面（保留旧路由）
- 暂不改造平台 Shell（保留 `serve.ts` 的 `buildPlatformShell()`）

## Capabilities

### New Capabilities

- `web-app`: 统一的 Next.js 前端应用，包含构建配置、设计系统基础设施、认证页面

### Modified Capabilities

无。这是全新能力，不修改已有 spec。

## Impact

- 新增: `packages/web/` 整体目录
- 修改: `packages/server/src/index.ts`（添加 Next.js 静态文件托管路由）
- 修改: `packages/server/src/routes/serve.ts`（移除认证页面路由，重定向到 Next.js 页面）
- 新增依赖: `next`、`react`、`react-dom`、`tailwindcss`、`@radix-ui/*`（通过 shadcn/ui）、`lucide-react`、`next-themes`
- 不影响: CLI、SDK、admin SPA、profile SPA（暂时并行运行）
