## Context

当前 `@localapp/sdk` 和 `@localapp/sdk-react` 已经向应用开发者公开了完整的应用 API：身份、平台数据、CRUD、count、transition、内容上传、raw SQL 和服务器时间。生产 serve 已经实现了其中大部分能力，例如 `/serve/{user}/{page}/api/{resource}/count`、`/api/content/upload`、`/api/db/exec` 等。

问题集中在本地 `localapp dev` 的 mini-server：它承担了开发态应用 API 的隔离职责，但实现面比 SDK 契约窄，且部分保留路径会落进通用 CRUD fallback。结果是开发者按 SDK 文档调用 `client.count()`、`useUsers()`、`useUpload()` 时，本地环境出现 400/404 或响应形态不一致。`sample-app` 用 `list(limit: 1)` 判断资源是否为空就是这个漂移导致的临时兼容写法。

更深的设计问题是：当前 `server-core` 只共享了底层零件，而没有共享 HTTP API 契约。生产 `serve.ts` 和 mini-server 分别手写：

- 路由优先级和保留路径识别；
- `{ success, data, error, pagination }` 响应包装；
- query 参数剥离和过滤映射；
- `/count`、`/db/exec`、`/content/*` 等特殊端点；
- visitor、ownerId、dev context 到业务上下文的转换。

其中 `packages/server/src/lib/app-db.ts` 和 `transitions.ts` 已经是 `@localapp/server-core` 的 re-export shim，但 `serve.ts` 仍从本地 shim 引入；`record-access.ts` 仍存在本地实现；HTTP 层则完全没有共享。因此“mini-server 引用了平台包”只能保证部分数据库和权限函数一致，不能保证应用 API 面一致。

本变更要把 mini-server 从“能跑 CRUD 的本地后端”提升为“SDK 应用 API 的开发态等价运行时”。

## Goals / Non-Goals

**Goals:**

- mini-server 覆盖 SDK 公开应用 API 的 P0/P1/P2 契约。
- 修复 P0：`/api/{resource}/count`、`/api/me` 标准响应、路由优先级和回归测试。
- 补齐 P1：`/api/content/upload`、`/api/content/{key}`、`/api/db/exec`、`/api/users`、`/api/groups`、`/api/platform/*` 的开发态行为。
- 处理 P2：SDK `count()` 对旧运行时提供可控降级，skills 文档收敛到正式 SDK API。
- 建立契约测试矩阵，让 SDK、mini-server、生产 serve 和文档不再各说各话。
- 收敛 server-core 边界，让生产 serve 和 mini-server 复用同一套应用 API 契约处理逻辑。

**Non-Goals:**

- 不为业务应用新增专用后端聚合 API，例如 `workload` 专属报表接口。
- 不重写 SDK 架构，不改变 `createClient()` 的 basePath 探测模型。
- 不把 mini-server 做成完整生产 server；LLM、登录注册、用户资料修改等平台能力仍由生产 server 或 mock/代理策略处理。
- 不移除旧 `/api/upload`，仅将其降级为兼容别名。

## Decisions

### 1. 以 mini-server 补齐为主，而不是撤回 SDK API

`useCount`、`useUpload`、`useExec` 已经出现在 SDK、skills 和生产能力中。撤回这些 API 会造成下游应用和文档倒退，也无法解决 dev/prod 不一致的根因。

选择：mini-server 补齐 SDK 已公开能力。SDK 只增加旧运行时兼容保护。

备选：从 SDK 移除 `count()` 或要求应用继续 `list(limit: 1)`。该方案会把框架问题转嫁给每个应用，且与现有 `localapp-data` skill 冲突。

### 2. 路由按保留端点优先，再进入 CRUD

生产 serve 和 mini-server 的应用 API 路由都需要先识别保留路径，再进入 CRUD：

```txt
/health
/api/time
/api/dev/*
/api/me
/api/users
/api/groups[/id]
/api/platform/*
/api/content/upload
/api/content/{key}
/api/upload        兼容别名
/api/db/exec
/api/{resource}/count
/api/{resource}/{id}/transitions
/api/{resource}/{id}
/api/{resource}
```

这样可以避免 `/api/users` 被当作 `users` 数据表，`/api/content/upload` 被当作 `content/{id}`，`/api/work_items/count` 被当作 `id=count`。

### 2.1 引入共享应用 API 契约层

新增或扩展 `@localapp/server-core`，提供传输无关的应用 API 处理层。目标不是把 Fastify 或 Node http 对象塞进 core，而是让 core 接收一个标准化请求并返回标准化响应：

```ts
type AppApiRequest = {
  method: string;
  path: string;       // 去掉 /api 前缀后的应用 API path
  query: Record<string, string>;
  body?: unknown;
  visitor: VisitorContext;
  ownerId: string;
};

type AppApiResponse = {
  status: number;
  body: { success: boolean; data?: unknown; error?: string; pagination?: Pagination };
  headers?: Record<string, string>;
};
```

生产 `serve.ts` 和 mini-server 各自只负责 adapter：

```txt
Fastify req/reply        Node http req/res
      |                         |
      v                         v
 normalize AppApiRequest  normalize AppApiRequest
      |                         |
      +----------+--------------+
                 v
       server-core app API handler
                 |
      +----------+--------------+
      v                         v
 Fastify reply           sendJson / stream file
```

共享层至少覆盖 CRUD、count、transition、raw SQL、time 的路由解析与响应包装。内容上传和读取涉及 multipart/stream，可先共享路径识别、结果形态和安全路径工具，multipart 解析仍留在 adapter。平台数据和 dev context 属于运行时差异较大的端点，通过 adapter 注入 provider，不进入 CRUD fallback。

备选：继续让 mini-server 手写补齐所有端点。该方案能短期修 bug，但下一次 SDK 或生产 serve 新增端点时仍会漂移，所以不作为最终设计。

### 3. `count` 复用 server-core 的过滤逻辑

生产 serve 已经使用 `countRows()`，server-core 也已有 `selectAll()` 的 total 计算。mini-server 应直接从 `@localapp/server-core` 引入 `countRows`，并在计数前应用与列表相同的 `buildRecordReadFilter()`。

`offset`、`limit`、`sort`、`order` 对 count 无意义，应显式剔除，剩余 query 作为业务过滤。

### 4. `/api/me` 统一成 `{ success, data }`

SDK `request()` 统一解析 `{ success, data }`，生产 `/api/me` 也是这个形态。mini-server 当前返回裸对象会导致 `client.me()` 得到 `undefined`。本变更将 mini-server 改为标准包裹；未登录 dev context 返回 `{ success: true, data: null }`，使 `useMe()` 不把未登录当作错误。

DevShell 直接 fetch `/api/me` 的地方需要兼容标准响应，避免工具条自身读错当前用户。

### 5. 平台数据在 dev 下优先代理，失败时稳定降级

`/api/platform/*` 本来是平台只读数据能力，mini-server 已有代理和缓存雏形。继续保留“优先代理生产 server + TTL 缓存”的设计。

对 `/api/users`、`/api/groups`、`/api/groups/{id}` 有两类需求：

- SDK 用户/分组 Hook 需要可用。
- Dev Toolkit 切换用户后，开发者需要看到可预测身份。

实现上应提供本地 mock 基线：包含当前 dev context user、常用 `alice`、`bob`、`dev-user`。当生产代理可用且不影响开发隔离时，可使用真实平台数据；代理失败不得进入 CRUD fallback。

### 6. 内容上传使用 SDK 正式路径，旧路径保留兼容

SDK `upload()` 请求 `{basePath}/content/upload`，生产 serve 也是 `/serve/{user}/{page}/api/content/upload`。mini-server 应实现 `/api/content/upload`，返回 `{ key, url }`，并实现 `GET /api/content/{key}`。

旧 `/api/upload` 只作为别名保留，返回同构 `UploadResult`，避免旧应用直接坏掉。

### 7. raw SQL 端点复用生产安全边界

mini-server 的 `/api/db/exec` 需要复用 server-core raw SQL 执行逻辑，遵守 `manifest.db.sqlAccess`。CRUD 模式下允许 `useExec()` 做复杂查询，但危险 SQL 和越权 SQL 必须被拒绝。

对于 `sample-app` 这类多表应用，短期仍可全量拉取前端计算；但 `useExec()` 可作为后续 JOIN/聚合的正式工具，而不是让应用手写非 SDK fetch。

### 8. SDK count 降级只处理旧运行时未支持

SDK 的 `count()` 可以对 404 或明确“端点未支持”做降级：调用 `list(resource, { limit: 1, filters })` 并返回 `pagination.total`。

但 401、403、400、500 不降级。权限错误、参数错误和服务端错误必须暴露给开发者，不能用 list 绕过。

## Risks / Trade-offs

- [风险] mini-server 变得更像生产 server，维护面扩大。  
  缓解：保留边界，mini-server 只实现应用运行所需 SDK 契约；登录注册、真实用户资料修改等平台写操作不纳入。通过共享应用 API 契约层减少手写重复。

- [风险] 把 HTTP 契约放进 server-core 会让 core 过早绑定传输层。  
  缓解：core 只处理标准化请求和响应，不依赖 Fastify、Node http、multipart 对象；stream/multipart 由 adapter 处理。

- [风险] 平台用户/分组 mock 与真实生产数据不一致。  
  缓解：Dev Toolkit 明确这是开发上下文；需要真实平台数据时仍可通过 `/api/platform/*` 代理获取。

- [风险] SDK count 降级掩盖新运行时缺陷。  
  缓解：契约测试必须直接验证 mini-server `/count`；降级测试只针对旧运行时兼容。

- [风险] raw SQL 在 dev 下过于宽松会形成错误安全预期。  
  缓解：dev 与 prod 都遵守 `sqlAccess`，并在 skills 中继续强调 raw SQL 不套用 recordAccess。

- [风险] 响应形态从裸 `/api/me` 改为 `{ success, data }` 可能影响旧 dev 代码。  
  缓解：SDK 期待的是标准形态；DevShell 内部同步更新。必要时可短期在少量内部调用处做兼容解析。

## Migration Plan

1. 先补 mini-server 契约测试，证明 `/count`、`/api/me`、`/api/users`、`/api/content/upload`、`/api/db/exec` 当前失败或不一致。
2. 先在 `server-core` 中建立共享应用 API 契约层，覆盖 P0 路径；生产 serve 和 mini-server 接入该层。
3. 按路由优先级补齐 P1 端点，能共享的逻辑进入 core，运行时差异通过 adapter/provider 注入。
4. 更新 SDK count 兼容测试和实现，确保权限错误不降级。
5. 更新 init-repo skills 文档，推荐使用 `client.count()` / `useCount()`，不推荐 `list(limit: 1)` 作为框架写法。
6. 在 `sample-app` 真实目录用 debug CLI sync 后验证：`localapp dev`、`useTime`、`useCount`、seed 判断和应用创建资源均可用。

回滚策略：若 P1/P2 任一项出现风险，可保留 P0 的 `/count` 与 `/api/me` 标准响应先落地；P1/P2 任务可按测试分组暂停，不影响 P0 修复。

## Open Questions

- `/api/users`、`/api/groups` 在 dev 下是否默认代理真实平台，还是默认 mock、显式配置后再代理？建议默认 mock，`/api/platform/*` 默认代理。
- `useExec()` 在 dev 下的默认 `sqlAccess` 是否应沿用生产默认值？建议沿用，避免开发态与生产态安全边界不一致。
- SDK `count()` 降级是否需要 console warning？建议仅在开发环境 warning，避免生产控制台噪音。
