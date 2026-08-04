## Why

当前 `localapp dev` 模式存在两个根本问题:

1. **数据完全依赖远程 server**:本地 dev 时,所有 `/api/*` 请求转发到生产 server,与生产数据完全共享同一个 SQLite。用户测试期间产生的新数据会污染生产,生产数据也无法在 dev 时清空重置。
2. **schema 演进无版本管理**:`localapp schemas create` 是声明式 schema,无 migration 历史、无 checksum、无回滚机制。schema 变更通过 ALTER TABLE 单步执行,生产数据库与开发数据库容易漂移,且无验证机制。

本次变更通过 **CLI 启动本地 mini-server** 隔离 dev/prod 数据,引入 **用户手写 SQL migration 系统** 保证 schema 演进可审计、可验证、可回滚。同时禁止 AI 直接访问数据库,只通过应用注册的工具间接操作,强化安全边界。

## What Changes

- **本地 mini-server**:`localapp dev` 启动一个内嵌的轻量级数据 server(Node.js + sql.js),维护独立的 `.localapp/dev.db`,所有应用层数据 CRUD 在本地完成。LLM 请求仍走生产 server;平台公共数据请求走 mini-server,由 mini-server 转发生产 server 并缓存。
- **vite-plugin 分流**:`/api/llm/*` 转发到生产 server,其他 `/api/*`(包含 `/api/platform/*`)转发到本地 mini-server。mini-server 对平台数据提供 5 分钟 TTL 缓存。
- **server-core 共享层**:把 `packages/server` 的 schema/CRUD/migration 核心逻辑抽到新 package `packages/server-core`,生产 server 和 mini-server 共用同一套实现。
- **用户手写 SQL migration**:废除 `localapp schemas create/update/delete` 命令,改为应用项目 `migrations/` 目录下用户手写 SQL 文件(数字递增命名)。CLI 提供 `localapp db migrate / status / reset / validate / types / shell` 子命令。
- **upload 原子化**:`localapp upload` 改为包含 `dist + migrations + manifest` 的原子发布。server 端先把 dist 写入 staging,再在 DB 事务内执行 migration,commit 成功后原子切换 current 指针;失败则回滚 DB 且 dist 不切换。保留前两版本 app.db 备份。
- **强制 validate**:`upload` 前必须 `localapp db validate` 通过(在线拉 prod app.db 快照,本地应用 migration 验证)。validate 失败拒绝 upload,保证生产稳定。
- **平台公共数据 API**:server 暴露 `/api/platform/users`、`/api/platform/groups`、`/api/platform/roles` 等只读端点,提供平台级共享数据。应用通过 SDK `usePlatformData` hook 访问。
- **平台版本 semver 声明**:`manifest.json` 新增 `platformVersion: "^1.0"`,server 检查兼容性,主版本不匹配拒绝 upload。平台升级时统一迁移所有 app.db。
- **AI 工具边界收紧**:DevShell 移除 `queryData` 和 `listSchemas` 系统工具(禁止 AI 直接查 db)。保留 `getCurrentUser`(身份查询,不算 db 操作)。AI 只能通过应用 `useRegisterTools` 注册的工具间接操作数据。
- **manifest.json 瘦身**:移除 `schemas` 数组(字段定义转移到 SQL),保留 `business`(transitions/recordAccess 等业务规则)、新增 `platformVersion`。
- **TypeScript 类型反向生成**:`localapp db types -o src/types.ts` 从 dev.db 的 `PRAGMA table_info` 反向生成 TypeScript interface。平台数据类型由 SDK 内置(跟 server-core 同步)。
- **seed 机制**:`db/seeds/dev.sql` 仅 dev.db reset 时应用,生产不执行。
- **从 manifest.schemas 自动迁移**:CLI 提供 `localapp migrate-from-manifest` 一次性把现有项目的 manifest.schemas 转换为初始 SQL migration 文件。

## Capabilities

### New Capabilities

- `local-mini-server`: CLI 启动的本地数据 server,隔离 dev/prod 数据
- `sql-migrations`: 用户手写 SQL 的 migration 系统,数字递增命名,forward-only
- `upload-atomic-deploy`: upload 包含 dist + migrations 的原子发布,事务保证一致性
- `db-validate-flow`: upload 前强制 validate,拉 prod 快照本地验证
- `platform-data-api`: server 端只读平台公共数据 API,SDK usePlatformData hook
- `platform-version-compat`: manifest 声明 platformVersion,server 检查兼容性
- `db-types-codegen`: 从 dev.db 反向生成 TypeScript 类型
- `db-seed-mechanism`: dev.sql 仅 dev.db reset 时应用

### Modified Capabilities

- `schema-management`: **BREAKING** 废除 `localapp schemas create/update/delete` 命令,改为 SQL migration;移除 manifest.schemas 字段定义
- `crud-api`: dev 模式下走本地 mini-server;生产保持现状;新增平台只读端点
- `content-upload`: **BREAKING** upload 改为原子操作(dist + migrations 一起);新增 backup 保留策略
- `sdk-agent`: **BREAKING** 移除 `queryData` 和 `listSchemas` 系统工具
- `sdk-react`: 新增 `usePlatformData` hook;类型生成从 manifest.schemas 改为 dev.db PRAGMA
- `init-template`: 项目结构变化(`migrations/` + `db/seeds/` 目录);main.tsx 不变(已纯净)
- `cli-dev-server`: dev 命令额外启动 mini-server;dev-config.json 新增 miniServerPort 字段

## Impact

**新增 packages**:
- `packages/server-core/` — 共享核心逻辑(schema、CRUD、migration、permissions)

**修改 packages**:
- `packages/server/` — 瘦身,引用 server-core;新增 platform-data 路由;upload 流程重构为原子
- `packages/cli/` — 新增 `db` 子命令族;dev 命令 spawn mini-server;废除 schemas 命令族
- `packages/sdk-react/` — 新增 `usePlatformData`;类型来源调整
- `packages/sdk-agent/` — 移除 `queryData`/`listSchemas` 系统工具
- `init-repo/` — 项目模板加 `migrations/` 和 `db/seeds/`;runtime 新增 `mini-server.mjs`

**用户项目迁移影响**:
- **BREAKING**:所有使用 `localapp schemas create` 的项目需要运行 `localapp migrate-from-manifest` 一次性转换
- **BREAKING**:manifest.json 的 `schemas` 字段不再被读取,应用层 SDK 行为不变(类型来源切换)
- DevShell 顶部 "tools" 按钮数字会少 2(移除 queryData/listSchemas)

**测试影响**:
- 现有 e2e 测试中关于 `schemas create` 的步骤需要改为 SQL migration
- 新增大量测试:mini-server 单测、migration 引擎单测、validate 流程 e2e、upload 原子性 e2e、平台数据 API e2e

**非破坏性兼容**:
- 现有 manifest.business(业务规则)继续工作
- 现有 SDK hooks(useList/useCreate 等)行为不变,数据源切换由 vite-plugin 处理
- 现有 dist 部署机制不变,只是 upload 流程重构

**实施分阶段**:本变更 scope 较大(4-6 周工作量),按 Phase 1-10 分阶段实施,每个 Phase 独立可验证、可合入 main。详见 tasks.md。
