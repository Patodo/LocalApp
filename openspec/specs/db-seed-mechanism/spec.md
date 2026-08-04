# db-seed-mechanism Specification

## Purpose
TBD - created by archiving change local-mini-server-and-sql-migrations. Update Purpose after archive.
## Requirements
### Requirement: db/seeds/dev.sql 文件位置与作用

应用项目 SHALL 在 `db/seeds/dev.sql` 路径维护 dev seed 文件(可选)。该文件 SHALL 仅由 `localapp db reset` 在 dev.db 创建后、所有 migration 应用后执行。

seed 文件 SHALL NOT 影响 prod:
- upload bundle 不包含该文件
- prod server 永远不执行该 seed

#### Scenario: 项目包含 seed 文件
- **WHEN** 应用项目根目录存在 `db/seeds/dev.sql`
- **AND** 执行 `localapp db reset`
- **THEN** reset 流程在所有 migration 应用完后,执行该 seed 文件
- **AND** 打印 "Applied seed: <N> SQL statements"

#### Scenario: 项目无 seed 文件
- **WHEN** 应用项目不存在 `db/seeds/dev.sql`
- **AND** 执行 `localapp db reset`
- **THEN** CLI 跳过 seed 步骤
- **AND** 打印 "No seed file found at db/seeds/dev.sql"

#### Scenario: seed 文件不在 upload bundle 中
- **WHEN** 用户执行 `localapp upload`,项目包含 `db/seeds/dev.sql`
- **THEN** CLI 打包 bundle 时显式跳过 `db/seeds/` 目录
- **AND** server 端永远不会收到该文件

#### Scenario: seed 失败时 reset 回滚
- **WHEN** `localapp db reset` 时,seed 文件 SQL 错误
- **THEN** seed 在事务中回滚,dev.db 不被修改
- **AND** CLI 打印错误,退出码 1
- **AND** 提示 "Seed failed. dev.db rolled back to migration-applied state."

### Requirement: localapp db reset 不自动应用 seed 给 prod-snapshot

`localapp db validate` 拉 prod-snapshot 后,SHALL NOT 应用 dev seed 到 prod-snapshot(prod 不应该有测试数据)。validate 只验证 migrations,不验证 seed。

#### Scenario: validate 不应用 seed
- **WHEN** 用户执行 `localapp db validate`,本地有 `db/seeds/dev.sql`
- **THEN** CLI 拉取 prod-snapshot.db,应用 migrations
- **AND** 不应用 seed
- **AND** 验证 migration 成功即通过

