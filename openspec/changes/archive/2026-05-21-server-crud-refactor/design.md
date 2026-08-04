## Context

server-crud 已合入 main，CRUD API 使用 `/api/{userId}/{pageId}/{resource}` 格式。页面通过 iframe 加载，内容从 `/serve/{userId}/{pageId}/` 路径提供。前端页面需要拼装 userId 和 pageId 才能调用 CRUD 接口，体验不佳。

当前状态：CRUD 路由注册在 Fastify 公开作用域，serve 路由处理静态文件和 SPA fallback。

## Goals / Non-Goals

**Goals:**

- CRUD 路由从 `/api/{userId}/{pageId}/{resource}` 迁移到 `/serve/{userId}/{pageId}/api/{resource}`
- 前端使用相对路径 `./api/{resource}` 调用 CRUD
- 移除旧的 `/api/{userId}/{pageId}/{resource}` 路由

**Non-Goals:**

- 不改变 CRUD 功能本身（分页、过滤、排序、计数逻辑不变）
- 不改变 schema-management 路由（仍需鉴权）
- 不实现 cookie 或 session 机制

## Decisions

### 1. CRUD 路由集成到 serve 路由中

将 CRUD 路由处理逻辑合并到 `serve.ts` 中。当路径匹配 `/serve/{userId}/{pageId}/api/{resource}` 时，走 CRUD 逻辑；其他路径走静态文件服务。

```
/serve/{userId}/{pageId}/
  ├── index.html          → 静态文件
  ├── assets/main.js      → 静态文件
  ├── api/todos           → CRUD list/create
  ├── api/todos/1         → CRUD get/update/delete
  └── api/todos/count     → CRUD count
```

理由：
- 路径前缀统一在 `/serve/{userId}/{pageId}/` 下
- 路径参数（userId、pageId）从 URL 中提取，无需额外机制
- Fastify 路由匹配优先级：精确路由 > 通配路由

### 2. 移除独立的 crud.ts 路由文件

CRUD 路由逻辑不再作为独立路由注册，而是由 serve.ts 内部根据路径前缀 `api/` 分发。`crud-db.ts` 库不变。

理由：
- CRUD 和静态文件共享同一个 URL 前缀，需要在一个路由处理器中协调
- 减少路由注册的复杂度

### 3. SPA fallback 需排除 api/ 路径

SPA fallback 逻辑（无扩展名路径返回 index.html）需要排除 `api/` 开头的子路径，避免 CRUD 请求被错误地当作 SPA 路由处理。

### 4. schema-management 响应中返回完整 URL

`POST /api/schemas` 响应中增加 `endpoints` 字段，包含基于 serve 路径的完整 CRUD URL。

## Risks / Trade-offs

- **[Breaking change]** 移除旧路由意味着已有的前端调用方必须更新 URL。可接受，因为这是新项目尚无外部用户。
- **[路由冲突]** `/serve/{userId}/{pageId}/api/...` 可能与静态文件路径冲突。风险极低，`api/` 不是常见的前端资源目录名。
