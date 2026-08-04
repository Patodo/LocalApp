## Context

当前认证页面由 `serve.ts` 中的三个字符串模板函数渲染：

- `buildLoginPage()` — 暗色背景 (`#0f0f23`)、居中表单、内联 CSS + JS
- `buildRegisterPage()` — 同上风格
- `buildForceChangePasswordPage()` — 同上风格

这些页面无法复用 `shared.css` 的 token，无法享受现代前端工具链（热重载、类型检查、组件复用）。

本变更创建统一的 Next.js 应用，先用认证页面验证整个工具链和部署流程，为后续 Phase 3-4 的全面迁移奠定基础。

本变更是 [LocalApp 总体方案](../../../docs/plan.md) Phase 2 的实施内容。Phase 1 (`phase-1-sdk-packages`) 已完成 SDK 独立包的抽离。

## Goals / Non-Goals

**Goals:**
- 创建可运行的 Next.js 应用骨架，构建产物为静态导出 (`next export`)
- 三个认证页面的功能和现有版本完全一致（API 端点、表单字段、错误处理）
- 暗色模式基础设施可用（主题切换、CSS 变量）
- Fastify 可托管静态导出产物

**Non-Goals:**
- 不迁移 admin SPA 页面（留待 Phase 3）
- 不迁移 profile SPA 页面（留待 Phase 3）
- 不改造平台 Shell（留待 Phase 4）
- 不实现设计系统的完整刷新（留待 Phase 5）
- 不修改任何后端 API 端点

## Decisions

### Decision 1: 构建策略

**选择：** Next.js 静态导出 (`output: "export"`)，由 Fastify 托管

**理由：**
- 不需要 Node.js 服务器运行前端（Fastify 已经是服务器）
- 静态文件部署简单，和现有 admin/profile SPA 模式一致
- 所有页面都是客户端可交互的（表单提交、状态管理），不需要 SSR

**替代方案考虑：** 独立运行 Next.js 服务器 (`next start`)。缺点是增加运维复杂度（多一个进程），且所有页面都是客户端交互式，SSR 无实际收益。

### Decision 2: 在 Fastify 中托管 Next.js 导出

**选择：** Next.js 构建到 `packages/web/out/`，Fastify 通过 `@fastify/static` 提供文件服务，对未匹配的路径 fallback 到 `index.html`

**理由：** 和当前 admin/profile SPA 的托管模式一致（`static/admin/`、`static/profile/`）。单端口、单服务运维。

### Decision 3: 认证状态处理

**选择：** 认证 cookie (`token`) 由 Fastify 设置，Next.js 页面通过读取 cookie 判断登录状态。HTTP-only，前端不直接操作。

**理由：** 和当前 serve.ts 的认证逻辑一致。cookie 在 Fastify 端验证，前端只需要知道是否存在。

### Decision 4: 路由过渡策略

**选择：** Fastify 路由中，`/login`、`/register`、`/force-change-password` 指向 Next.js 静态文件。`/admin/*` 和 `/profile` 暂时保留旧的 SPA 路由。

**理由：** 渐进迁移。新页面就绪后切换路由，旧页面不受影响。

### Decision 5: 组件库选择

**选择：** shadcn/ui (基于 Radix) + Tailwind CSS v4

**理由：** shadcn/ui 源码归你所有，可深度定制。Radix 原语保证可访问性。这是 Phase 5 全面设计升级的基础。

## Risks / Trade-offs

- **构建步骤增加** → 部署前需要 `npm run build` (Next.js) + 服务重启。当前 admin/profile 已有同样需求
- **静态导出限制** → 不能使用 ISR、Server Components 的数据获取、Middleware。所有数据获取在客户端进行（和当前模式一致）
- **cookie 读取** → 静态页面无法在服务端读取 cookie。认证状态检查在客户端通过 `useEffect` + `/api/me` 完成
- **新旧页面并行** → 需要确保新旧页面共享相同的认证 cookie 和 API 端点。已验证兼容
