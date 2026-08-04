## Why

平台当前在 `/serve/{user}/{app}/api/*` 上同时暴露：① 隐式 REST CRUD（每声明一个 resource 自动出现 list/get/create/update/delete/count）、② transitions REST 端点、③ named SQL 端点。SDK `client.ts` 内置 fallback——named SQL 返回 404 时自动改打 REST。下游真实应用的反馈证明这种"双协议"是脆弱的：作者以为在用 named SQL，实际走的是 REST；404 噪音掩盖了未声明的口子； named SQL 的严格 param 校验与 REST 的 schema 校验规则不同，导致同一操作的两条路径行为不一致。

平台尚未上线、当前仅作者本人使用、`init-repo` 模板还在演进、未来应用开发将迁移到 web 工作台由平台 agent 编写——这是把应用数据通道**收缩为 named SQL 唯一**的最后一次干净窗口。错过这次，存量应用和外部用户出现后再做同样改造的成本会高一个数量级。

## What Changes

- **BREAKING**: 移除 `/serve/{user}/{app}/api/<resource>` 和 `/serve/{user}/{app}/api/<resource>/:id` 隐式 REST CRUD 端点（list / create / get / update / delete / count 全部）
- **BREAKING**: 移除 `/serve/{user}/{app}/api/<resource>/:id/transitions` 与 `/serve/{user}/{app}/api/<resource>/:id/transitions/:name` 端点。`business.transitions` 保留为前端元数据，**不再有服务端执行入口**；状态流转改由应用自行声明对应的 named mutation（如 `$work_items.approve`），由 SDK 根据 `business.transitions` 在前端本地计算"当前可执行动作"
- **BREAKING**: 移除 `/serve/{user}/{app}/api/db/exec` 原始 SQL 端点（client.ts 中已 `@deprecated`）
- **BREAKING**: 移除 `/serve/{user}/{app}/api/upload` 旧版上传端点（app-api-contract 中标记为 `legacy-upload`）；文件上传统一走 `/api/content/upload`
- SDK（`sdk-core` / `sdk-react`）的 `list` / `get` / `create` / `update` / `delete` / `count` helper 保留作为 named SQL 的语法糖，但**移除 REST fallback**；对应 named SQL 未声明时直接抛 `LocalAppError`，不再隐式改打 REST
- SDK 新增 `availableTransitions(resource, record)` 纯函数：读取 schema 中的 `business.transitions` 元数据结合 record 当前状态本地计算可执行 transitions 列表，取代原 `listTransitions` 端点
- 保留的应用层端点：`/time`、`/me`、`/users`、`/groups[/:id]`、`/platform/*`、`/_schemas`、`/content/upload`、`/content/:key`——这些是平台基础设施，不属于资源 CRUD
- `init-repo` 的 work_items 示例补齐完整 named SQL（list / get / create / update / delete / count 6 条），作为新模版的标准形态
- mini-server（`init-repo/runtime/mini-server.mjs`）同步删除 REST CRUD 与 transitions 路由，与生产 server 行为对齐

## Capabilities

### New Capabilities

无新 capability。本次变更是对现有应用层数据通道的收缩与简化。

### Modified Capabilities

- `crud-api`: 移除全部 REST CRUD HTTP 端点；该 capability 收缩为"SQLite 存储 + schema 推断"的内部基础设施（仅供 named SQL 执行器使用），不再对前端直接暴露
- `business-state-transitions`: 移除查询/执行 transitions 的 HTTP 端点；`business.transitions` 仍可在 schema 中声明，但语义变更为"前端可用 transition 计算的元数据"，服务端不再据此执行任何写入
- `named-sql-api`: 不修改 spec 内容，但地位由"可选的数据通道"变为"应用层**唯一**的读写数据通道"
- `raw-sql-endpoint`: 整个 capability 移除
- `client-sdk`: list/get/create/update/delete/count helper 移除 REST fallback 分支；新增 `availableTransitions` 本地纯函数；`exec` 方法移除（原 raw SQL 入口）
- `local-mini-server`: 移除 REST CRUD 与 transitions 路由实现，保持与生产 server API 表面一致
- `init-template`: work_items 示例补齐 6 条 named SQL；模板内任何文档/skill 引用不再依赖 REST fallback

## Impact

- **Server** (`packages/server/src/`):
  - `routes/serve.ts`: `handleCrudRequest` 收缩，仅保留 named-query/named-mutation/schemas/content/time/me/users/groups/platform 分支；删除 crud-list/crud-create/crud-get/crud-update/crud-delete/crud-count/transition-list/transition-execute/db-exec 处理逻辑
  - `lib/app-api-contract.ts`: `matchAppApiRoute` 删除 crud-* / transition-* / db-exec / legacy-upload 路由匹配
  - `lib/app-db.ts`: 仅被 REST CRUD 使用的 `selectAll` / `selectById` / `insertRow` / `updateRow` / `deleteRow` / `countRows` 若确认无其它调用方则清理
- **Server-core** (`packages/server-core/src/`):
  - 与 server 同步的 contract/route 校验逻辑更新
- **SDK** (`packages/sdk-core/src/`, `packages/sdk-react/src/`):
  - `client.ts`: 删除 `shouldFallbackCount` / `shouldFallbackNamed` 工具函数；list/get/create/update/delete/count 的 catch 分支只保留 rethrow；新增 `availableTransitions` 纯函数；删除 `exec` 方法
  - `hooks/use-transitions.ts`: 改为基于 `availableTransitions` + record 本地计算
  - `hooks/use-exec.ts`: 移除（原 raw SQL 入口）
- **CLI** (`packages/cli/src/commands/`):
  - `db.rs` / `upload.rs` 的契约校验同步：不再校验"REST 自动暴露的字段集合"，只校验 named SQL 声明的 param 与 schema 字段引用
- **mini-server** (`init-repo/runtime/mini-server.mjs`):
  - 删除 REST CRUD 与 transitions 路由实现
- **init-repo 模板** (`init-repo/backend/resources/work_items/`):
  - `queries.json`: 补齐 `$work_items.list` / `$work_items.get` / `$work_items.count`
  - `mutations.json`: 补齐 `$work_items.create` / `$work_items.update` / `$work_items.delete`（以及业务必要的 `$work_items.approve` 等 transition 替代）
- **测试**:
  - `packages/server/tests/integration/` 中 CRUD REST 端点测试删除或改写为 named SQL 行为测试
  - `packages/sdk-core` 的 fallback 行为测试删除
  - `init-repo/tests/mini-server.test.ts` 中 REST 路由测试同步
- **下游影响**: 唯一在用应用（`init-repo` 自带的 work_items 示例 + 作者本地真实应用）需要相应迁移到完整 named SQL 声明
