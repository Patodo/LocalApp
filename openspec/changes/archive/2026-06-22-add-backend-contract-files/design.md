## Context

当前 LocalApp 同时存在三类应用数据能力：

- 平台维护的应用 CRUD / count / transition 路由，前端通过资源 API 使用。
- raw SQL 路由 `/api/db/exec`，前端可以提交任意 SQL，服务端主要依赖 `sqlAccess` 放行。
- schema / business / migration 等配置散落在 manifest、上传元数据、模板和平台实现之间。

这导致两个问题。第一，raw SQL 一旦暴露给普通应用使用者，使用者可以修改前端请求并绕过应用 UI 层约束。第二，平台隐藏维护应用级 SQLite 接口，应用开发者再维护业务查询，会让应用后端契约出现双轨来源。

本设计把应用级 SQLite 的事实来源移入项目内 backend 目录：schema、policy、预置资源接口和自定义 SQL API 都由 init-repo 提供并由应用开发者维护；平台只维护平台数据接口、安全执行器、校验器和运行时端点。

## Goals / Non-Goals

**Goals:**

- manifest 只声明 backend root 或 include patterns，不内联 schema / SQL 内容。
- init-repo 默认包含应用级 backend 契约，覆盖 schema、资源 CRUD / count 接口、自定义 query / mutation 示例。
- 每个 JSON 配置文件都带 `$schema`，平台发布稳定 JSON Schema URL，并在本地 validate 中使用同一 schema。
- 前端运行时不能提交任意 SQL，只能调用注册过的 named query / mutation。
- 生产 server 和 mini-server 共用 server-core 中的 backend 契约解析、参数校验、安全执行和权限判断。
- 保留现有 SDK 资源 API 的兼容路径，并逐步让其优先映射到项目内应用 backend 契约。
- raw SQL 端点降级为 dev / owner-admin / 兼容能力，不作为普通应用使用者的运行时通道。
- CLI schema 子命令不再作为创建/注册应用 schema 的独立入口；生成能力改为 backend resource 契约脚手架。

**Non-Goals:**

- 不在本变更中实现完整 SQL AST 级权限推导。
- 不把平台级元数据接口下放给应用 backend 目录维护。
- 不要求一次性删除现有 CRUD 路由或 `client.exec()`。
- 不把所有 schema、query、mutation 合并到单个巨大 JSON 文件。
- 不引入外部数据库或服务端自定义代码运行时。

## Decisions

### 1. backend root 是应用后端契约的唯一入口

manifest 新增轻量声明：

```json
{
  "backend": {
    "root": "backend"
  }
}
```

高级场景可支持 include patterns：

```json
{
  "backend": {
    "include": [
      "backend/resources/**/schema.json",
      "backend/resources/**/queries.json",
      "backend/resources/**/mutations.json",
      "backend/queries/**/*.json"
    ]
  }
}
```

默认推荐 root，不推荐开发者手写复杂 include。CLI、mini-server、production server 都从同一入口解析 backend 契约。

备选方案是把所有契约写入 manifest。该方案会让 manifest 变成大型业务配置文件，也不利于编辑器提示和按资源组织，因此不采用。

### 2. backend 文件按资源聚合，跨资源查询单独放置

推荐目录：

```txt
backend/
  resources/
    work_items/
      schema.json
      queries.json
      mutations.json
    comments/
      schema.json
      queries.json
      mutations.json
  queries/
    dashboard.json
  schemas/
    backend.schema.json
    resource-schema.schema.json
    queries.schema.json
    mutations.schema.json
```

`resources/*/schema.json` 定义表、字段、约束、业务规则和基础 policy。`queries.json` / `mutations.json` 定义该资源的应用接口。跨资源报表、dashboard 和聚合查询放在 `backend/queries/`。

备选方案是 `schemas/`、`sql/`、`policies/` 按类型分目录。它适合平台实现者，但对应用开发者不如按资源聚合直观，因此作为兼容读取形态而非默认模板。

### 3. JSON Schema 是配置契约的一等产物

所有 backend JSON 文件都应包含 `$schema`：

```json
{
  "$schema": "https://localapp.dev/schemas/backend/resource-schema.schema.json",
  "name": "work_items",
  "fields": {}
}
```

平台需要同时提供：

- 远程稳定 URL：供编辑器、文档和第三方工具使用。
- 本地拷贝：随 init-repo 和 CLI 打包，离线 validate 可用。
- schema 版本：URL 中或 schema `$id` 中包含兼容版本策略。

采用 JSON Schema draft 2020-12。`$schema` 在 schema 文件中声明方言；在配置文件中引用平台 schema URL，用于编辑器关联、补全和校验。

### 4. Named SQL API 只执行注册 SQL

新增运行时端点：

```txt
POST /serve/:owner/:app/api/queries/:name
POST /serve/:owner/:app/api/mutations/:name
```

请求只包含参数：

```json
{ "params": { "status": "open" } }
```

服务端执行流程：

```txt
加载 backend 契约
  -> 查找 query / mutation 名称
  -> 校验 endpoint access
  -> 校验 params schema，拒绝未声明参数
  -> 注入系统变量 currentUserId / ownerId / now
  -> 校验 SQL kind 与安全规则
  -> 执行已注册 SQL
  -> 返回 rows 或 mutation result
```

SQL 文本只能来自 backend 契约文件，不能来自前端请求。

### 5. 应用级预置 CRUD 接口也由 init-repo backend 契约提供

init-repo 提供默认资源接口配置，例如：

```txt
backend/resources/_templates/
  schema.json
  queries.json
  mutations.json
```

或内置系统命名：

```txt
$resource.list
$resource.get
$resource.count
$resource.create
$resource.update
$resource.delete
```

SDK 现有方法逐步映射：

```txt
client.list("work_items")   -> /api/queries/$resource.list
client.count("work_items")  -> /api/queries/$resource.count
client.create("work_items") -> /api/mutations/$resource.create
```

早期阶段如果 backend 契约缺失，可 fallback 到现有 CRUD 路由；后续版本可把旧 CRUD 路由降为兼容层。这样应用级接口的事实来源最终回到项目内文件。

### 6. 平台级 SQLite 查询仍由平台接口维护

平台用户、群组、收藏、通知、访问日志、主页、平台时间等数据不进入应用 backend 目录。应用只能通过平台维护的只读或受控端点访问，例如 `/api/me`、`/api/dev/users`、`/api/server-time`。

这保持清晰边界：

```txt
平台数据接口：平台维护，应用只调用
应用数据接口：应用维护，平台安全执行
```

### 7. server-core 承担共享执行器

新增 server-core 模块：

```txt
backend-contract/
  discoverBackendFiles()
  parseBackendContract()
  validateBackendContract()
  resolveNamedSql()
  validateNamedSqlParams()
  injectSystemParams()
  assertNamedSqlSafety()
  executeNamedSql()
```

production server 和 mini-server 不各自实现 SQL / schema 逻辑，只调用 server-core。这样避免本地开发与生产漂移。

### 8. raw SQL 保留但降级

`/api/db/exec` 和 `client.exec()` 保留为兼容能力，但新文档和模板不再推荐。默认策略：

- dev-shell 可用，用于诊断。
- owner-admin 可用，用于管理和兼容。
- 普通应用使用者不可用，除非显式打开危险兼容开关。

长期可将 `client.exec()` 标记 deprecated，引导迁移到 `client.query()` / `client.mutate()`。

### 9. CLI schema 子命令收敛为 backend resource scaffold

现有 `localapp generate schema <name>` 会生成 `schemas/<name>.json`，并提示继续使用 `localapp schemas create ...`。在 backend 契约成为 schema 事实来源后，这条路径会制造第二套 schema 入口，必须收敛。

新行为应满足：

```txt
localapp generate resource work_items
  -> backend/resources/work_items/schema.json
  -> backend/resources/work_items/queries.json
  -> backend/resources/work_items/mutations.json
```

如果保留 `localapp generate schema <name>` 作为兼容 alias，它 MUST 生成 backend resource schema 文件，并输出迁移提示；不得再生成 `schemas/<name>.json`，不得提示 `localapp schemas create`。

历史 `localapp schemas create/update/delete` 若仍存在，应变为明确弃用并退出，提示开发者编辑 backend 文件并运行 `localapp validate` / `localapp upload`。不再允许通过 CLI 直接把 schema 写入平台状态。

## Risks / Trade-offs

- [Risk] SQL 文件成为新的复杂配置面 → 通过 JSON Schema、模板示例、validate 诊断和清晰错误信息降低学习成本。
- [Risk] 从平台 CRUD 切换到 backend 契约会引入兼容风险 → 分阶段迁移，先新增 named SQL，再让 SDK 资源 API 优先走契约并 fallback。
- [Risk] 简单 SQL kind 校验无法覆盖所有 SQLite 边界 → 第一阶段采用严格保守规则，mutation 禁止 DDL、多语句、ATTACH/DETACH、PRAGMA 等危险语句；未来再引入 AST 解析。
- [Risk] `$schema` URL 需要长期稳定维护 → 使用版本化 schema URL，并在 CLI/init-repo 内置离线 schema。
- [Risk] 应用开发者修改预置 CRUD 契约可能破坏 SDK 假设 → 系统 named endpoint 需要强 schema 校验和兼容测试，validate 必须在上传前阻断不兼容修改。
- [Risk] backend 契约与 migration 仍可能不同步 → validate 需要检查 schema、migration、SQL 引用表/字段的一致性。

## Migration Plan

1. 新增 backend 契约解析和 JSON Schema，但不改变现有 runtime 行为。
2. init-repo 加入 backend 目录、默认 schema 和 named SQL 示例。
3. 新增 named SQL 端点和 SDK `query()` / `mutate()`。
4. mini-server 与 production server 使用同一 server-core 执行器。
5. SDK 资源 API 优先使用项目注册的系统 named endpoint，缺失时 fallback 到旧 CRUD。
6. 收敛 CLI schema 子命令，先提供 backend resource scaffold 和旧命令弃用提示。
7. `client.exec()` 和 `/api/db/exec` 标记为 dev / owner-admin / deprecated。
8. 在后续变更中评估旧 CRUD 路由是否收敛为兼容层。

回滚策略：named SQL 与 backend 契约在第一阶段是增量能力；如果生产发现问题，可关闭 named SQL 路由或让 SDK 资源 API fallback 到旧 CRUD，不影响已发布应用的现有 CRUD 行为。

## Open Questions

- `$schema` 远程 URL 使用 `https://localapp.dev/schemas/...` 还是随 server 实例提供 `/schemas/...`？
- 系统 named endpoint 采用 `$resource.list` 这类模板名，还是生成 `work_items.list` 这类具体名？
- 第一阶段是否允许开发者覆盖系统 CRUD endpoint，还是只允许新增自定义 endpoint？
- 是否需要在 validate 中引入 SQLite SQL parser，还是先用保守字符串/语句级规则？
