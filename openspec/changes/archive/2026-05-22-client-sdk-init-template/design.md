## Context

LocalApp 的后端能力（CRUD API、用户认证、双层访问控制）已完整实现，但前端开发者（实际是 AI 助手）在 `localapp init` 后缺少 SDK 和文档来调用这些能力。当前 init 流程通过 `git clone` 模板仓库生成项目，但模板仓库尚未创建。

平台架构约束：
- 用户应用运行在 iframe sandbox（`allow-scripts allow-forms allow-same-origin`）内
- iframe 与平台同域，浏览器自动携带 session cookie
- CRUD API 路径：`/serve/{userId}/{name}/api/{resource}[/:id][/count]`
- 身份查询路径：`/api/me`（平台级别）
- 用户框架锁定为 Vite + React

## Goals / Non-Goals

**Goals:**
- 提供零运行时依赖的 React SDK，封装 CRUD 和身份查询
- 提供开箱即用的 Vite + React 项目模板
- 提供面向 AI 助手的 CLAUDE.md 文档，让 AI 能正确使用平台能力
- SDK 源码以 TypeScript 形式直接放入模板，Vite 编译时打包

**Non-Goals:**
- 不做 npm 发布（内网项目，不需要公网分发）
- 不做 SSR / Next.js（用户应用是纯客户端 SPA）
- 不做实时订阅（WebSocket / SSE）
- 不做离线缓存或 Service Worker
- 不修改 CLI init 命令的 git clone 机制

## Decisions

### D1: SDK 以 TS 源码形式嵌入模板，不做独立构建

**选择**：`packages/client/src/` 中的 TS 源码直接复制到 `init-repo/src/lib/localapp/`，Vite 负责编译打包。

**替代方案**：先 build `@localapp/client` 为 JS，再复制产物到模板。

**理由**：
- 少一层构建步骤，维护更简单
- Vite 原生支持 TS，无额外成本
- AI 助手可以直接阅读 SDK 源码理解实现细节
- 零依赖，不需要 sourcemap 调试

### D2: SDK 使用自定义 Hook 模式，不引入 SWR/TanStack Query

**选择**：手写 `useState` + `useEffect` Hook，内部使用 `fetch`。

**替代方案**：依赖 SWR 或 TanStack Query 提供缓存和重验证。

**理由**：
- 目标用户是 AI 助手，Hook 越简单越容易正确使用
- 零依赖原则，不增加 bundle size
- 平台 CRUD 场景简单，不需要复杂的缓存策略
- `refresh()` 手动触发刷新已满足需求

### D3: basePath 自动检测

**选择**：从 `window.location.pathname` 解析 `/serve/{userId}/{name}/` 作为 API 前缀。

**理由**：
- 用户无需配置任何 URL
- iframe 内的 pathname 格式固定为 `/serve/{userId}/{name}/...`
- `/api/me` 路径固定在平台根级别，不需要 basePath

### D4: Hook API 设计

```
useMe()                  → { me: User | null, loading: boolean }
useList(resource, opts?) → { rows: T[], pagination, loading, refresh }
useGet(resource, id)     → { row: T | null, loading }
useCreate(resource)      → { create: (data) => Promise<T> }
useUpdate(resource)      → { update: (id, data) => Promise<T> }
useDelete(resource)      → { remove: (id) => Promise<void> }
useCount(resource, opts?) → { count: number, loading }
```

**理由**：
- 每个操作一个 Hook，AI 助手按需 import
- 查询类 Hook 自动请求，变更类 Hook 返回命令函数
- `useList` 支持 `offset`、`limit`、`sort`、`order`、`filters` 参数
- 泛型支持 `useList<Post>('posts')` 获得类型推断

### D5: init-repo 目录结构与同步机制

```
init-repo/
  package.json              ← react, react-dom, vite, @vitejs/plugin-react
  vite.config.ts
  index.html
  CLAUDE.md                 ← AI 助手指南
  src/
    main.tsx                ← 入口
    App.tsx                 ← 示例页面（使用 SDK 做简单 CRUD）
    lib/
      localapp/
        client.ts           ← 从 packages/client/src/client.ts 同步
        react.ts            ← 从 packages/client/src/react.ts 同步
        index.ts            ← 统一导出
        types.ts            ← 从 @localapp/shared 提取必要类型
```

**同步机制**：`pnpm sync:sdk` 脚本将 `packages/client/src/` 复制到 `init-repo/src/lib/localapp/`。用户手动将 init-repo 内容推送到远程模板仓库。

### D6: CLAUDE.md 内容策略

CLAU.md 是模板中给 AI 助手看的文档，包含：
- 平台能力概述（CRUD、身份、访问控制）
- SDK Hook 用法和参数说明
- CLI 命令参考（create schema、upload 等）
- 示例代码片段
- 常见开发模式（列表+创建、带筛选的查询等）

## Risks / Trade-offs

**[SDK 源码复制 vs npm link]** → 选择复制。如果 `packages/client/` 更新了但忘了同步，模板会过期。通过 CI 或 pre-commit hook 提醒可缓解。但作为内网项目，手动同步成本可接受。

**[Hook 简单性 vs 功能完备]** → 选择简单。没有乐观更新、没有缓存失效、没有并发控制。对于内网低流量应用足够。未来如果需要可以引入 TanStack Query 但当前不需要。

**[CLAUDE.md 维护成本]** → AI 助手依赖这份文档。如果平台 API 变了但文档没更新，AI 会生成错误代码。需要在变更流程中检查 CLAUDE.md 是否需要同步更新。
