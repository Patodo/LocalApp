# db-seed-mechanism Specification

## Purpose

定义开发 seed 的执行顺序、回滚语义与存储边界，确保示例数据只作用于项目内离线 schema 工作库，绝不隐式写入本地或远端 canonical Server 的已安装应用数据库。

## Requirements

### Requirement: dev seed 只初始化离线 schema 工作库

应用 MAY 在 `db/seeds/dev.sql` 维护开发示例数据。该文件 SHALL 只由 `localapp db reset` 在 `tmp/localapp-schema/schema.db` 完成全部 migrations 后执行。它 SHALL NOT 修改 `localapp dev` 启动的 Server 数据、任何已安装应用数据库或远端 Server。

#### Scenario: 项目包含 seed 文件

- **WHEN** 项目存在 `db/seeds/dev.sql` 且用户执行 `localapp db reset`
- **THEN** CLI SHALL 重建 `tmp/localapp-schema/schema.db`
- **AND** SHALL 在 migrations 完成后以事务执行 seed
- **AND** SHALL 输出已执行的 SQL statement 数量

#### Scenario: 项目无 seed 文件

- **WHEN** 项目不存在 `db/seeds/dev.sql` 且用户执行 `localapp db reset`
- **THEN** CLI SHALL 完成 schema 工作库重建
- **AND** SHALL 明确输出未找到 seed 文件

### Requirement: seed 不进入可移植应用包

`.localapp` 包 SHALL 只携带可部署 migrations 和 backend contract，不得包含 `db/seeds/`。统一 Server 的应用安装、版本更新、对等同步和数据同步 SHALL NOT 自动执行开发 seed。

#### Scenario: 构建包含 seed 的项目

- **WHEN** 用户对含 `db/seeds/dev.sql` 的项目执行 `localapp build --package`
- **THEN** 生成包的文件清单 SHALL NOT 包含该 seed
- **AND** 目标 Server 安装后 SHALL NOT 出现 seed 测试数据

### Requirement: seed 失败只回滚 schema 工作库

seed SHALL 在单独事务中执行。失败时 CLI SHALL 恢复到 migrations 已成功应用的 schema 工作库状态，并返回非零退出码；不得影响任何 Server 实例。

#### Scenario: seed SQL 无效

- **WHEN** `localapp db reset` 执行 seed 时遇到 SQL 错误
- **THEN** seed 事务 SHALL 回滚
- **AND** `tmp/localapp-schema/schema.db` SHALL 保留 migration-applied 状态
- **AND** Server 数据 SHALL 保持不变
