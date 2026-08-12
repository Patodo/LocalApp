# LocalApp - 总体方案

> **历史文档（已废弃）**：本文记录早期上传/CRUD 平台方案，不再描述当前产品。现行架构与实施状态以 [单一 npm 包设计](./superpowers/specs/2026-08-12-single-package-daemon-notifications-design.md) 和 [单一 npm 包实施计划](./superpowers/plans/2026-08-12-single-package-daemon-notifications.md) 为准；不得从本文恢复 `localapp upload`、独立 MiniServer 或 Local Runtime。

## 项目概述

一个轻量级前端页面托管平台。用户通过 CLI 上传前端页面，服务器返回可访问链接，页面可直接使用内置的 CRUD API 进行数据操作。

核心场景：用户上传前端项目后获得一个可访问的链接，页面可直接使用内置的 CRUD API 进行数据操作。

---

## 当前架构

```
┌─ 用户机器 ──────────────────────────────────┐
│                                              │
│  localapp CLI (Rust 二进制)                  │
│    ├── localapp init --name <name>           │
│    ├── localapp login                        │
│    ├── localapp upload                       │
│    └── localapp pages/schemas/admin          │
│                                              │
└──────────────┬───────────────────────────────┘
               │ HTTP
               ▼
┌─ 服务器 ────────────────────────────────────┐
│                                              │
│  HTTP Server (Fastify, 端口 3000)            │
│                                              │
│  认证:    POST /api/auth/cli-register|login  │
│  页面:    POST/GET/PUT/DELETE /api/pages     │
│  上传:    POST /api/upload                   │
│  Schema:  POST/PUT/DELETE/GET /api/schemas   │
│  Issue:   GET/POST/PATCH /api/issues         │
│  页面访问: GET /{uid}/{name}                 │
│  CRUD:    /serve/{uid}/{name}/api/{resource} │
│  管理后台: /admin                            │
│  用户控制台: /profile                        │
│                                              │
│  存储:                                       │
│    data/{uid}/{name}/                        │
│      versions/v1...v10/                      │
│      app.db                                  │
│      meta.json                               │
│                                              │
└──────────────────────────────────────────────┘
```

### 当前问题

| 维度 | 问题 |
|------|------|
| **前端渲染** | 3 种方式并存：serve.ts 字符串模板、admin SPA (Vite)、profile SPA (Vite)。设计 token 无法共享，组件无法复用 |
| **样式** | 635 行手写 CSS (`shared.css`)，无暗色模式，无响应式 |
| **组件** | 无组件库，每个页面手写 HTML + class |
| **SDK** | 代码嵌入 `init-repo/`，每次 `localapp upload` 时复制到用户项目，无版本管理 |
| **服务器** | `serve.ts` 混合 HTML 渲染 + CRUD API，职责不清 |
| **开发体验** | 无本地 dev server，用户必须上传后才能看到效果 |

---

## 目标架构

```
┌─ 用户机器 ──────────────────────────────────────┐
│                                                  │
│  localapp CLI (Rust 二进制)                      │
│    ├── localapp init --name <name>               │
│    ├── localapp dev                              │  ← 新增
│    ├── localapp login / whoami / logout          │  ← 增强
│    ├── localapp upload                           │
│    ├── localapp generate schema/page             │  ← 新增
│    └── localapp pages/schemas/admin              │
│                                                  │
│  用户项目 (npm create @localapp/template)         │
│    ├── @localapp/sdk (npm 包)                    │  ← 正式包
│    ├── @localapp/sdk-react (npm 包)              │  ← 正式包
│    └── @localapp/sdk-agent (npm 包, 可选)        │  ← 正式包
│                                                  │
└──────────────┬───────────────────────────────────┘
               │ HTTP
               ▼
┌─ 服务器 ────────────────────────────────────────┐
│                                                  │
│  HTTP Server (Fastify, 端口 3000)                │
│                                                  │
│  纯 JSON API:                                    │
│    认证:    /api/auth/*                          │
│    页面:    /api/pages/*                         │
│    上传:    /api/upload                          │
│    Schema:  /api/schemas/*                       │
│    Issue:   /api/issues/*                        │
│    CRUD:    /serve/:uid/:name/api/*              │
│    静态:    /serve/:uid/:name/*                  │
│    管理:    /api/admin/*                         │
│    CLI:     /api/cli/*                           │
│                                                  │
│  前端 (Next.js 静态导出，Fastify 托管):           │
│    /                  → 首页/重定向               │
│    /login             → 登录                      │
│    /force-change-password → 强制改密              │
│    /admin/*           → 管理后台                  │
│    /profile/*         → 用户控制台                │
│    /:userId/:name     → 平台 Shell               │
│                                                  │
└──────────────────────────────────────────────────┘

┌─ 前端应用 (packages/web/) ──────────────────────┐
│                                                  │
│  Next.js App Router                              │
│    ├── app/(auth)/  → 登录/注册/改密             │
│    ├── app/(dashboard)/admin/  → 管理后台        │
│    ├── app/(dashboard)/profile/  → 用户控制台    │
│    └── app/serve/[userId]/[name]/  → 平台 Shell  │
│                                                  │
│  设计系统: Tailwind CSS v4 + shadcn/ui            │
│  图标: lucide-react                              │
│  字体: Geist (Sans + Mono)                       │
│  主题: 暗色优先 + 亮色切换                        │
│                                                  │
└──────────────────────────────────────────────────┘
```

---

## 技术栈对比

| 组件 | 当前 | 目标 |
|------|------|------|
| 后端 | Fastify + TypeScript | Fastify + TypeScript (纯 API) |
| 前端 | 3 种渲染方式 | Next.js (统一) |
| 样式 | 手写 CSS (shared.css) | Tailwind CSS v4 + shadcn/ui |
| 暗色模式 | 无 | 暗色优先 + 切换 |
| 响应式 | 桌面固定布局 | 完整响应式 |
| 图标 | 无图标库 | lucide-react |
| CLI | Rust, 功能完整 | Rust, 加 dev/generate 命令 |
| SDK | 嵌入 init-repo, 每次复制 | 3 个独立 npm 包 |
| 模板 | 编译时嵌入 CLI 二进制 | npm 包 `@localapp/template` |
| 包管理 | pnpm workspace | pnpm workspace (不变) |
| 数据库 | sql.js | sql.js (不变) |

---

## 实施路径（6 个阶段）

### Phase 1: SDK npm 包

**目标：** 将 SDK 从 `init-repo/src/lib/localapp/` 抽离为独立 npm 包，发布到 npm 或私有 registry。

**内容：**
- `@localapp/sdk` — 纯 JS 客户端，零框架依赖
- `@localapp/sdk-react` — React hooks (`useList`, `useCreate` 等)
- `@localapp/sdk-agent` — Agent SDK (可选安装)

**风险：** 低。纯新增，不影响现有功能。现有 `init-repo/` 中的 SDK 代码可以并存到过渡期结束。

**参见：** `openspec/changes/phase-1-sdk-packages/`

---

### Phase 2: Next.js 应用骨架 + 认证页面

**目标：** 创建 `packages/web/` Next.js 应用，先实现认证相关页面（登录、注册、强制改密），其他路由暂由旧 SPA 处理。

**内容：**
- Next.js App Router 骨架
- Tailwind CSS v4 + shadcn/ui 配置
- 暗色主题基础设施
- 登录/注册/强制改密页面
- Fastify 配置托管 Next.js 静态导出

**风险：** 中。认证页面和现有 serve.ts 版本并行运行，通过 Fastify 路由控制新旧切换。

**参见：** `openspec/changes/phase-2-nextjs-auth/`

---

### Phase 3: Admin + Profile 迁移

**目标：** 将 admin SPA 和 profile SPA 从 Vite 迁移到 Next.js，统一到 `packages/web/` 中。

**内容：**
- Admin 所有页面迁移（Dashboard、Analytics、Users、Pages、Groups、Settings）
- Profile 所有页面迁移（Profile、Apps、Keys、Groups）
- 共享布局组件（AppShell、Sidebar）
- 旧 SPA 代码归档

**风险：** 中。逐页迁移，新旧并存。每迁移一个页面即可切换路由。

**参见：** `openspec/changes/phase-3-admin-profile-migration/`

---

### Phase 4: serve.ts HTML 模板退役

**目标：** 将平台 Shell (iframe 包装器 + Issue 模态框 + 导航栏) 从 serve.ts 的字符串模板重写为 Next.js React 组件。serve.ts 只保留 CRUD API 和静态文件服务。

**内容：**
- `PlatformShell` React 组件
- `IssuesModal` React 组件
- `Navbar` React 组件
- 所有认证状态由 Next.js 管理（cookie 共享）
- serve.ts 移除非 API 路由

**风险：** 高。平台 Shell 是所有应用的外壳，涉及认证状态共享、iframe 通信。

**参见：** `openspec/changes/phase-4-serve-retirement/`

---

### Phase 5: 设计系统升级

**目标：** 完成视觉全面刷新：暗色模式默认、响应式、动画、统一设计语言。

**内容：**
- shadcn/ui 组件主题定制（颜色、圆角、阴影）
- 暗色模式完善（所有页面、所有组件）
- 响应式布局完善（侧边栏折叠、表格横向滚动、移动端适配）
- 交互状态完善（骨架屏、Toast、过渡动画）
- 布局多样化（不再只有表格，引入卡片、时间线、图表等）
- `shared.css` 归档

**风险：** 中。纯视觉改造，不改变信息架构。可在 Phase 2-4 过程中渐进完成。

**参见：** `openspec/changes/phase-5-design-system/`

---

### Phase 6: CLI 开发体验

**目标：** 新增 `localapp dev` 本地开发命令和 `localapp generate` 脚手架命令。

**内容：**
- `localapp dev` — 启动本地 Vite dev server，代理 API 到远程
- `localapp generate schema` — 生成 schema 定义文件
- `localapp generate page` — 生成页面脚手架
- `localapp whoami` — 显示当前登录用户
- `localapp logout` — 清除凭证
- `localapp init` — 改用 npm 模板（`@localapp/template`）

**风险：** 低。纯新增命令，不影响现有。

**参见：** `openspec/changes/phase-6-cli-dev-experience/`

---

## 设计决策记录

### 为什么选择 Next.js 而不是继续用 Vite？

1. **统一渲染** — 当前 3 种渲染方式（HTML 模板、admin SPA、profile SPA）可合并为一个应用
2. **Server Components** — 减少客户端 JS 体积
3. **文件路由** — App Router 的文件系统路由和平台页面结构天然对应
4. **静态导出** — `next export` 产物直接由 Fastify 托管，不需要 Node 运行时
5. **生态** — shadcn/ui、next/font、Metadata API 等开箱即用

### 为什么选择 Tailwind + shadcn/ui 而不是手写 CSS？

1. **暗色模式** — Tailwind `dark:` 变体是最简洁的实现方式
2. **响应式** — 响应式断点内置于工具类
3. **shadcn/ui** — 源码归你所有，基于 Radix 的可访问性，可深度定制
4. **开发者熟悉** — Tailwind 是开发者工具的标配
5. **维护成本** — 不需要维护 635 行手写 CSS

### 为什么选择 Geist 字体？

1. **辨识度** — Vercel 出品，比 Inter 更有性格
2. **质量** — 包含 Sans 和 Mono，覆盖所有场景
3. **许可** — SIL Open Font License，可自由使用
4. **Linear 风格** — Geist 是 Linear/developer-tool 美学的默认选择

### 为什么选择 Lucide 图标？

1. **已在 CLAUDE.md 中指定** — 项目已有的决策
2. **React 支持** — `lucide-react` 开箱即用
3. **图标质量** — 一致的 stroke-width，统一的视觉风格

### 为什么 SDK 要拆分为独立 npm 包？

1. **版本管理** — 用户知道用的是哪个版本的 SDK
2. **独立更新** — SDK 可以独立发版，不需要更新 CLI
3. **标准实践** — 开发者期望 `npm install @localapp/sdk` 而不是文件复制
4. **解耦** — SDK-core 可用于非 React 项目，SDK-agent 按需安装

---

## 资源限制

| 项目 | 限制 |
|------|------|
| 单页面上传大小 | 50MB |
| 版本保留数量 | 10 个 |
| 单用户总存储 | 500MB |
| CRUD 单表最大行数 | 10000 行 |
