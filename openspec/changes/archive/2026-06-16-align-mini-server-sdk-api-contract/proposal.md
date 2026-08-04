## Why

下游应用已经开始自然使用 `@localapp/sdk` 和 `@localapp/sdk-react` 暴露的完整 API，但本地 `localapp dev` 的 mini-server 只实现了其中一部分，导致 `client.count()`、`useUsers()`、`useUpload()` 等公开能力在开发环境中失败。这个不一致会把应用开发者推向 `list(limit: 1)`、手写 fallback、绕开 SDK 等临时写法，破坏“开发环境与生产环境隔离但契约一致”的目标。

## What Changes

- 补齐 mini-server 对 SDK 公开 API 的支持，使开发态 `/api/*` 行为与生产 serve 和 SDK 文档一致。
- 将 `GET /api/{resource}/count` 作为正式 CRUD 契约在 mini-server 中实现，支持与列表查询一致的过滤和 recordAccess。
- 统一开发态 `/api/me`、`/api/users`、`/api/groups`、`/api/groups/{id}` 的响应形态，返回 `{ success, data }` 包装并支持 Dev Toolkit 切换身份。
- 补齐开发态 `/api/content/upload` 和 `/api/content/{key}`，与 SDK `upload()` 和生产 serve 的内容 API 对齐；保留旧 `/api/upload` 作为兼容别名。
- 补齐开发态 `/api/db/exec`，使 `useExec()` 在 CRUD 模式和 SQL 模式下可用于本地复杂查询，同时保持危险 SQL 防护与访问控制边界。
- 明确 `/api/platform/{resource}` 在 dev 下的策略：优先代理真实平台只读数据；代理不可用时提供稳定 mock 响应，避免落入 CRUD fallback。
- 优化 server-core 边界：把当前散落在生产 `serve.ts` 和 mini-server 中的应用 API 路由契约、响应包装、query 解析和保留路径优先级抽到共享的传输无关层，由生产 Fastify adapter 和本地 Node http adapter 复用。
- 为 SDK 增加防御性兼容：当 `/count` 端点不可用时可选择降级到 `list(limit: 1)` 读取 pagination total，但该降级仅作为旧运行时兼容，不替代服务端实现。
- 建立契约测试矩阵，覆盖 SDK、mini-server、生产 serve 与 init-repo skill 文档之间的一致性，防止后续再次漂移。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `local-mini-server`: mini-server 必须实现 SDK 公开应用 API 的开发态等价契约。
- `crud-api`: CRUD API 的 `/count`、过滤、分页 total 与 recordAccess 语义在生产和开发环境中保持一致。
- `client-sdk`: `createClient()` 公开方法与服务端端点契约必须一致，并为旧运行时提供安全降级。
- `sdk-react`: React Hook 必须依赖稳定 SDK 契约，并在 dev context 变化后正确刷新。
- `content-upload`: 内容上传和读取端点在开发态与生产态路径一致。
- `raw-sql-endpoint`: `useExec()` 对应的 `/api/db/exec` 在开发态补齐，并保持安全边界。
- `platform-data-api`: 开发态平台数据 API 必须有明确代理或 mock 行为，不得落入应用 CRUD。
- `user-auth`: 开发态 `/api/me` 响应形态必须与生产和 SDK 期待一致。

## Impact

- 影响 `init-repo/runtime/mini-server.mjs` 的应用 API 路由、dev context、内容存储、raw SQL、平台数据代理逻辑。
- 影响 `packages/server-core` 的职责边界：从只共享数据库/权限/transition 零件，提升为共享应用 API 契约处理层。
- 影响 `packages/server/src/routes/serve.ts`：生产 serve 需要通过共享应用 API 层处理 CRUD/count/content/raw SQL 等应用端点，避免与 mini-server 再次分叉。
- 影响 `packages/sdk-core` 和 `packages/sdk-react` 的 `count()` / `useCount()` 兼容策略与测试。
- 影响生产端契约测试，重点确认 `packages/server/src/routes/serve.ts` 已有能力与 mini-server 行为一致。
- 影响 init-repo skills 文档，需把推荐写法从临时兼容写法收敛回 SDK 正式 API。
- 不引入破坏性变更；旧的 `/api/upload` 在 mini-server 中保留兼容，但 SDK 推荐路径为 `/api/content/upload`。
