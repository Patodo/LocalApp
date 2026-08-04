## Why

当前 CRUD API 只能做简单的单表增删改查，前端无法执行 JOIN、聚合、子查询、索引操作等。每次 CRUD 请求都走 load/save/close 完整文件 I/O 周期，性能不佳。需要通过 manifest.json 让项目自主选择是否暴露 raw SQL 端点，并结合用户系统做细粒度权限控制。

## What Changes

- 扩展本地 manifest.json 增加 `db` 配置（DB 模式、sqlAccess、defaultAccess），CLI 上传时同步到服务端 meta.json
- 新增 `POST /api/db/exec` raw SQL 执行端点，受 meta.json 的 db.mode 和 db.sqlAccess 管控
- crud-db.ts 从每次请求 load/save/close 改为长连接地图模式，写操作后存盘，空闲超时释放
- meta.json 的 db.defaultAccess 作为 schema 级 RouteAccess 的 fallback
- client SDK 新增 raw SQL 执行方法
- CLI Manifest struct 新增 db 字段，init 命令生成默认配置
- 无 db 配置的已有项目默认 `mode: "crud"`，不暴露 raw SQL 端点

## Capabilities

### New Capabilities

- `raw-sql-endpoint`: 提供 POST /api/db/exec 端点，允许前端执行任意 SQL（DDL + DML），受 meta.json 的 db.mode 和 db.sqlAccess 管控
- `manifest-config`: 扩展 manifest.json 增加 db 配置，通过 CLI upload 同步到服务端 meta.json，定义项目级 DB 模式（crud/sql）、sqlAccess 级别、defaultAccess 默认权限

### Modified Capabilities

- `access-control`: 新增 meta.db.defaultAccess 作为 RouteAccess 的 fallback；新增 raw SQL 端点的 sqlAccess 权限检查
- `client-sdk`: 新增 raw SQL 执行方法 `exec(sql)`，供前端直接调用 raw SQL 端点

## Impact

- `packages/shared/src/models.ts` — 新增 ManifestDb、DbMode 等类型
- `packages/server/src/lib/crud-db.ts` — 连接池改造，去 load/save/close
- `packages/server/src/lib/access-control.ts` — 新增 meta.db fallback 逻辑
- `packages/server/src/routes/serve.ts` — 新增 raw SQL 端点，api/db/exec 路由特殊分支
- `packages/server/src/routes/upload.ts` — 解析 dbConfig form field，存入 meta.json
- `packages/server/src/plugins/storage.ts` — PageMeta 新增 db 字段，新增 readDbConfig 辅助函数
- `packages/server/src/index.ts` — 服务关闭 hook，遍历关闭所有连接
- `packages/client/src/client.ts` — 新增 exec 方法
- `packages/client/src/react.ts` — 新增 useExec hook
- `packages/cli/src/project.rs` — Manifest struct 新增 db 字段
- `packages/cli/src/commands/upload.rs` — 上传时发送 dbConfig
- `packages/cli/src/commands/init.rs` — init 生成默认 db 配置
