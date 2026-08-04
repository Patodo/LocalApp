## Context

admin-foundation 提供了管理 API（`/api/admin/*`），但只能通过 CLI 访问。需要一个浏览器端的管理面板来可视化展示用户、页面和系统状态。

当前系统通过 `buildPlatformShell()` 在 `serve.ts` 中内联生成 HTML（登录、注册、Shell 框架）。管理面板不应走用户页面体系（Shell + iframe），而是系统级路由。

## Goals / Non-Goals

**Goals:**
- 创建独立的 React SPA 管理面板应用
- 服务端提供 `/admin` 路由，直接服务面板静态资源
- 面板包含 Dashboard 概览、用户管理、应用管理、系统配置 4 个页面
- 访问 `/admin` 时校验 admin 角色，非 admin 重定向登录页
- 使用 JWT cookie 认证（浏览器环境），复用现有 session 体系

**Non-Goals:**
- 不做运营分析图表（admin-analytics 变更）
- 不做移动端适配，只支持桌面浏览器
- 不做 SSR，纯 CSR（SPA）
- 不引入重型 UI 框架（如 Ant Design），保持轻量

## Decisions

### D1: 管理面板作为独立 package

在 `packages/admin/` 创建独立的 Vite + React 应用，与 `init-repo/` 模板平级。构建产物由服务端直接托管，不通过页面上传系统。

**Why:** 管理面板是系统级组件，不应走用户页面部署流程（需要 admin 权限才能部署，鸡生蛋问题）。独立 package 使构建和开发互不干扰。

### D2: `/admin` 作为服务端路由，优先于 `/:userId/:name`

在 Fastify 路由注册时，`/admin` 路由注册在 serve 路由之前。`/admin` 匹配时直接返回管理面板 HTML；`/admin/assets/*` 返回构建产物静态文件。未匹配时才进入 `/:userId/:name` 的 Shell 逻辑。

**Why:** Fastify 按注册顺序匹配，先注册的优先。`/admin` 是固定路径，不应被动态参数路由捕获。

### D3: 面板构建产物内嵌到服务端

管理面板构建后，将 `dist/` 内容复制到 `packages/server/static/admin/`（或通过构建脚本处理）。服务端启动时加载这些文件。

**Why:** 避免运行时依赖外部 CDN 或独立文件服务器。单进程部署，所有资源来自同一个 Fastify 实例。

### D4: 认证流程

访问 `/admin` → 服务端检查 JWT cookie → admin 角色则返回面板 HTML → 面板内 JS 调用 `/api/admin/*` 时自动携带 cookie。未登录或非 admin → 302 到 `/login?redirect=/admin`。

**Why:** 复用现有 JWT cookie + session 体系，不需要新的认证机制。

### D5: 技术选型

- React 18 + React Router 6（路由）
- Tailwind CSS（样式，与 init-repo 一致）
- Fetch API 调用 admin 接口（不需要 SDK，直接调 JSON API）
- Vite 构建

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
|------|------|------|
| 构建产物需与服务端同步 | 部署时需先构建面板 | 加 npm script 统一构建 |
| Tailwind 引入构建依赖 | 服务端 devDependencies 增大 | 仅构建时依赖，运行时无影响 |
| CSR 首屏白屏 | 非 admin 用户看到短暂空白 | 服务端预检角色，非 admin 直接重定向 |
