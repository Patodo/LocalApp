# db-types-codegen Specification

## Purpose
TBD - created by archiving change local-mini-server-and-sql-migrations. Update Purpose after archive.
## Requirements
### Requirement: localapp db types 命令

`localapp db types -o <file>` SHALL 从 `.localapp/dev.db` 的 schema 反向生成 TypeScript interface 文件。

实现方式:对每个 user table(排除 `_localapp_*` 内部表),执行 `PRAGMA table_info(<table>)`,根据 SQLite 类型映射 TypeScript 类型,生成 interface。

SQLite → TypeScript 类型映射:
- INTEGER → `number`
- TEXT → `string`
- REAL → `number`
- NUMERIC → `number`
- BLOB → `Uint8Array`
- BOOLEAN → `boolean`(SQLite 存为 INTEGER 0/1,但 PRAGMA 报告 INTEGER;约定字段名以 `is_` 或 `_at` 结尾时按 BOOLEAN/timestamp 处理)
- timestamp(TEXT ISO 8601) → `string`(字段名以 `_at` 结尾)

interface 命名 SHALL 用 PascalCase 表名(如 `tasks` → `interface tasks`),字段名保持 snake_case。

#### Scenario: 生成 interface 文件
- **WHEN** 用户执行 `localapp db types -o src/types.ts`
- **THEN** CLI 打开 `.localapp/dev.db`
- **AND** 对每个 user table 执行 PRAGMA table_info
- **AND** 生成 TypeScript interface,例如:
  ```typescript
  export interface tasks {
    id: number;
    title: string;
    status: string;
    created_by?: string;
    created_at?: string;
    updated_at?: string;
  }
  ```
- **AND** 写入 `src/types.ts`
- **AND** 打印 "Generated <N> interfaces to src/types.ts"

#### Scenario: 排除内部表
- **WHEN** dev.db 包含 `_localapp_applied_migrations` 等内部表
- **THEN** 生成的 types.ts 不包含这些表的 interface
- **AND** 只包含用户业务表

#### Scenario: 字段名以 _at 结尾映射为 timestamp
- **WHEN** 表 tasks 有 `created_at` 字段(SQLite 类型 TEXT)
- **THEN** 生成的 interface 中 `created_at?: string;`
- **AND** 注释 `/** ISO 8601 timestamp */`

#### Scenario: BLOB 字段映射
- **WHEN** 表 attachments 有 `data` 字段(SQLite 类型 BLOB)
- **THEN** 生成的 interface 中 `data: Uint8Array;`

#### Scenario: 没有用户表时打印提示
- **WHEN** dev.db 只包含 `_localapp_*` 内部表(应用尚未 CREATE TABLE)
- **AND** 执行 `localapp db types -o src/types.ts`
- **THEN** CLI 打印 "No user tables found in dev.db. Run localapp db migrate first."
- **AND** 仍创建 src/types.ts,内容为空 export 注释

### Requirement: 平台数据类型由 SDK 内置(不走 db types)

`localapp db types` SHALL NOT 生成平台表(users、groups、roles)的 interface,因为平台表 schema 由 server 维护,跟 dev.db 无关。平台表类型由 `@localapp/sdk-react` 内置(`PlatformUser`、`PlatformGroup` 等)。

#### Scenario: db types 不包含平台表
- **WHEN** dev.db 包含平台表(users 等,通过 server 同步,虽然实际不存在于 dev.db)
- **AND** 执行 `localapp db types -o src/types.ts`
- **THEN** 生成的文件不包含 `interface users` 或 `interface groups`
- **AND** 文件顶部注释提示 "For platform data types (users, groups, roles), import from @localapp/sdk-react"

