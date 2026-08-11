# sql-migrations Specification

## Purpose

定义应用 migration 文件格式、离线 schema 工作库行为，以及统一 Server 安装时的 migration 契约。

## Requirements

### Requirement: migration 文件格式与命名

应用项目的 `migrations/` SHALL 包含以三位数字递增命名的 SQLite SQL 文件，例如 `001_init.sql`、`002_add_priority.sql`。同一数字不得重复。migration SHALL 为纯 SQL；引擎负责事务边界，文件不得包含 `ATTACH DATABASE`、`DETACH DATABASE` 或破坏事务模式的 pragma。

#### Scenario: 合法 migration 链

- **WHEN** 项目包含 `001_init.sql` 和 `002_add_priority.sql`
- **THEN** CLI 与 Server SHALL 按数字前缀顺序应用
- **AND** 每个 migration SHALL 在独立事务中提交或回滚

#### Scenario: migration 包含不安全语句

- **WHEN** migration 包含 `ATTACH DATABASE` 或 `DETACH DATABASE`
- **THEN** `localapp check` 和包安装 SHALL 拒绝该 migration
- **AND** SHALL NOT 修改目标数据库

### Requirement: migration 应用记录

离线 schema 工作库与每个 Server 应用数据库 SHALL 使用 `_localapp_applied_migrations` 记录文件名、SHA-256 checksum 和应用时间。已记录且 checksum 相同的 migration SHALL 跳过；已记录文件 checksum 变化 SHALL 视为错误。

#### Scenario: migration 首次应用

- **WHEN** 引擎成功应用 `002_add_priority.sql`
- **THEN** SHALL 写入该文件名、checksum 和应用时间

#### Scenario: 已应用 migration 被修改

- **WHEN** 已记录的 migration 文件 checksum 与当前内容不同
- **THEN** CLI 检查和 Server 安装 SHALL 拒绝继续
- **AND** SHALL 提示新增 migration 而不是篡改历史文件

### Requirement: db 命令维护离线 schema 工作库

`localapp db migrate`、`status`、`reset`、`types` 和默认 `shell` SHALL 只操作项目 `tmp/localapp-schema/schema.db`。该数据库 SHALL 用于 migration 编译、seed、类型生成和人工 schema 检查，不得作为任何应用运行时数据库。

#### Scenario: 应用未执行 migrations

- **WHEN** 用户执行 `localapp db migrate`
- **THEN** CLI SHALL 创建或打开 `tmp/localapp-schema/schema.db`
- **AND** SHALL 按顺序应用所有 pending migrations

#### Scenario: 查看 migration 状态

- **WHEN** 用户执行 `localapp db status`
- **THEN** CLI SHALL 从 schema 工作库列出已应用和 pending migration
- **AND** SHALL NOT 查询开发 Server 的业务数据库

#### Scenario: 重建 schema 工作库

- **WHEN** 用户执行 `localapp db reset`
- **THEN** CLI SHALL 只删除并重建 `tmp/localapp-schema/schema.db`
- **AND** SHALL 应用全部 migrations 和可选 `db/seeds/dev.sql`
- **AND** SHALL NOT修改 `tmp/localapp-dev/server/` 或其它 Server 数据

#### Scenario: 打开 SQLite shell

- **WHEN** 用户执行 `localapp db shell`
- **THEN** CLI SHALL 启动 `sqlite3 tmp/localapp-schema/schema.db`
- **AND** schema 工作库不存在时 SHALL 返回明确提示

### Requirement: Server 从应用包应用 migrations

`.localapp` 包 SHALL 包含 migrations，但不包含 schema 工作库或 dev seed。统一 Server SHALL 在安装 staging 阶段把 pending migrations 应用于该 Server 自己的目标应用数据库，并在成功检查后激活版本。失败 SHALL 由应用安装器恢复数据库和旧版本。

#### Scenario: 安装带新 migration 的应用版本

- **WHEN** 用户执行 `localapp app install --target production`
- **AND** 包内包含目标尚未执行的 migration
- **THEN** 目标 Server SHALL 在自己的应用数据库中事务执行 migration
- **AND** 成功后才原子激活新版本

#### Scenario: 开发 Server 安装 migration

- **WHEN** `localapp dev` 安装开发应用包
- **THEN** 项目 Server SHALL 使用同一安装器应用 migration
- **AND** 离线 schema 工作库的记录和数据 SHALL NOT 被复制到 Server
