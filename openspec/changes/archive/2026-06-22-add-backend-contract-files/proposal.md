## Why

当前应用级 SQLite 能力存在两个方向的风险：一方面 raw SQL 由前端提交会让应用使用者越过应用原定权限，另一方面平台隐藏维护应用 CRUD 语义、开发者再维护业务查询，容易形成双轨漂移。需要把“应用后端契约”显式放进 init-repo 项目，让应用开发者维护 schema、权限和 SQL API，同时由平台提供安全执行器、校验和运行时端点。

`$schema` 也应成为这些 JSON 配置文件的一等约定。JSON Schema 是描述和校验 JSON 结构的标准化生态，`$schema` 关键字用于声明 schema 方言或 schema 标识；在配置文件中放置类似 `https://opencode.ai/config.json` 的 `$schema` URL 是常见实践，可以为编辑器提供校验、补全和文档提示。

## What Changes

- 新增应用后端契约目录：manifest 只声明 backend root 或 include patterns，不直接承载 schema / SQL 内容。
- 将应用级 schema、policy、named SQL query / mutation 统一纳入 backend 目录的版本、校验、上传和同步生命周期。
- 新增 named SQL API：开发者注册 SQL 文件，前端运行时只能调用已注册的 query / mutation 名称并传入受 schema 校验的参数。
- 新增 JSON Schema 发布与引用机制：backend 相关 JSON 文件均提供 `$schema`，平台发布稳定 schema URL，并在 init-repo 中默认写入。
- 调整应用级 SQLite CRUD 的长期模型：预置 list/get/count/create/update/delete 等应用接口作为 init-repo 可见 backend 契约提供，平台执行器读取这些契约运行；平台级数据查询仍走平台维护的只读接口。
- 收敛 CLI schema 相关子命令：不再提供创建/注册平台 schema 的独立命令入口；脚手架生成能力改为生成 backend resource 契约文件。
- 限制 raw SQL 的定位：保留为 dev / owner-admin / 兼容能力，普通应用使用者不应通过前端提交任意 SQL。
- mini-server 与生产 server 共享 backend 契约解析、校验和执行逻辑，避免本地开发与生产漂移。
- SDK 增加面向 named SQL 的调用方式，并让现有资源 API 逐步映射到项目内应用契约，保留兼容 fallback。

## Capabilities

### New Capabilities

- `backend-contract-files`: 定义应用项目内 backend root、schema / policy / SQL 配置文件布局、`$schema` 引用、打包和校验契约。
- `named-sql-api`: 定义注册式 query / mutation API、参数校验、系统变量注入、权限检查、安全执行和 SDK 调用契约。

### Modified Capabilities

- `manifest-config`: manifest 需要支持声明 backend root / include patterns，而不是内联应用后端契约内容。
- `schema-management`: schema 来源需要迁移为 backend 契约文件，并与 SQL API 在同一生命周期中校验。
- `crud-api`: 应用级预置 CRUD / count 接口需要逐步由 init-repo 中的应用 backend 契约驱动，避免平台隐藏维护另一套应用接口。
- `raw-sql-endpoint`: raw SQL 端点需要降级为 dev / owner-admin / 兼容能力，不能作为普通前端运行时任意 SQL 通道。
- `client-sdk`: SDK 需要新增 named query / mutation 调用，并规划既有资源 API 到应用契约的兼容映射。
- `local-mini-server`: mini-server 需要读取同一 backend 契约，并复用生产一致的校验和执行规则。
- `init-template`: init-repo 需要内置 backend 目录、默认应用级 SQLite 接口配置和对应 `$schema`。
- `cli-tool`: schema 子命令需要收敛为 backend 契约文件脚手架或迁移提示，避免继续生成旧 `schemas/*.json` 工作流。

## Impact

- 影响 `init-repo/` 模板目录结构、manifest 示例、技能文档、validate/upload/sync 流程。
- 影响 `packages/server-core`：需要新增 backend 契约解析、JSON Schema 校验、named SQL 执行、SQL kind 判断、参数绑定和系统变量注入。
- 影响 `packages/server` 与 `init-repo/runtime/mini-server.mjs`：需要新增 named SQL 端点并复用 server-core。
- 影响 `packages/sdk-core`、`packages/sdk-react`：需要暴露 `query()` / `mutate()`，并逐步将资源 API 映射到注册契约。
- 影响 `packages/cli`：`localapp validate` / `upload` / `sync` 需要收集、校验和打包 backend 契约文件。
- 影响 `packages/cli` 的 `generate schema` 或历史 `schemas` 命令族：需要移除旧注册入口并改为 backend resource scaffold。
- 需要新增或调整 OpenSpec、单元测试、集成测试、模板测试和文档，覆盖生产 server 与 mini-server 行为一致性。
