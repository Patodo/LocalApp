## ADDED Requirements

### Requirement: migration 文件格式与命名

应用项目的 `migrations/` 目录 SHALL 包含数字递增命名的 SQL 文件:`001_<description>.sql`、`002_<description>.sql`,扩展名 `.sql`。文件名前缀数字 SHALL 从 001 开始递增;同一数字不允许重复。推荐连续递增,但允许为后续人工整理保留跳号。

migration 文件内容 SHALL 为纯 SQL(SQLite 方言),不包含 frontmatter、注释指令、模板语法。SQL 注释(`-- ...`)允许,但不强制要求元数据字段。

每个 migration 文件 SHALL 在事务中执行(`BEGIN; ... COMMIT;`),由 migration 引擎自动包裹。migration 内 SHALL NOT 包含 `ATTACH DATABASE`、`DETACH DATABASE`、`PRAGMA journal_mode = WAL` 等破坏事务的 SQL。

#### Scenario: migration 文件命名规则
- **WHEN** 查看 `migrations/` 目录
- **THEN** 文件名形如 `001_init.sql`、`002_add_priority.sql`,数字递增
- **AND** 每个文件以 `.sql` 为扩展名

#### Scenario: migration 文件内容为纯 SQL
- **WHEN** 打开任一 migration 文件
- **THEN** 内容是 SQLite 方言 SQL(如 CREATE TABLE、ALTER TABLE、INSERT)
- **AND** 文件不包含 frontmatter、模板语法或 YAML 元数据

#### Scenario: migration 禁止破坏事务的 SQL
- **WHEN** migration 文件包含 `ATTACH DATABASE` 或 `DETACH DATABASE`
- **THEN** `localapp db validate` 拒绝该 migration,输出错误 "Migration <filename> contains ATTACH/DETACH which breaks transaction"
- **AND** upload 流程被阻断

#### Scenario: migration 顺序按文件名数字递增
- **WHEN** 应用多个 migration 文件
- **THEN** 按文件名前缀数字升序应用(001 先于 002,002 先于 003)
- **AND** 同一数字不允许多个文件(冲突时报错)

### Requirement: migration 应用记录

每个 dev.db / app.db SHALL 包含 `_localapp_applied_migrations` 表,记录已应用的 migration:

```sql
CREATE TABLE _localapp_applied_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

checksum 字段 SHALL 为 migration 文件内容的 SHA256 hash,防止文件被篡改。

#### Scenario: 应用 migration 后记录写入
- **WHEN** migration 引擎应用 `002_add_priority.sql`(内容 hash 为 abc123...)
- **THEN** `_localapp_applied_migrations` 表新增一行 `{ filename: "002_add_priority.sql", checksum: "abc123...", applied_at: "<timestamp>" }`

#### Scenario: 已应用的 migration 不再重复应用
- **WHEN** `localapp db migrate` 检测到 `002_add_priority.sql` 已在 `_localapp_applied_migrations` 中
- **THEN** 跳过该 migration,不重复执行

#### Scenario: 已应用 migration 文件被修改时拒绝
- **WHEN** 用户修改了已应用的 `001_init.sql`(checksum 变化)
- **AND** 执行 `localapp db migrate` 或 `localapp db validate`
- **THEN** CLI 拒绝继续,输出错误 "Migration 001_init.sql was modified after being applied"
- **AND** 提示用户恢复文件或手动处理

### Requirement: localapp db migrate 命令

`localapp db migrate` SHALL 应用 `migrations/` 目录下所有未应用的 migration 文件到 `.localapp/dev.db`,按文件名数字顺序执行。每个 migration 在独立事务中应用,失败则该 migration 回滚并停止后续应用。

#### Scenario: 应用未应用的 migrations
- **WHEN** 用户执行 `localapp db migrate`,dev.db 有 3 个未应用的 migration(004、005、006)
- **THEN** CLI 按顺序应用 004、005、006
- **AND** 每个应用成功后打印 "Applied 004_xxx.sql"
- **AND** 完成后打印 "3 migrations applied"

#### Scenario: 没有未应用的 migration
- **WHEN** 用户执行 `localapp db migrate`,所有 migration 已应用
- **THEN** CLI 打印 "No pending migrations"
- **AND** 不修改 dev.db

#### Scenario: migration 应用失败时停止
- **WHEN** 应用 005 时 SQL 语法错误
- **THEN** 005 在事务中回滚,dev.db 不变
- **AND** CLI 打印错误信息含失败 SQL 行号
- **AND** 后续 006 不再应用

### Requirement: localapp db status 命令

`localapp db status` SHALL 输出当前 migration 状态:已应用的 migration 列表(按时间)+ 未应用的 migration 列表(按文件名顺序)。

#### Scenario: 显示 migration 状态
- **WHEN** 用户执行 `localapp db status`
- **THEN** 输出两个区块
- **AND** "Applied migrations" 区块列出已应用文件名 + checksum + 应用时间
- **AND** "Pending migrations" 区块列出未应用文件名

### Requirement: localapp db reset 命令

`localapp db reset` SHALL 删除 `.localapp/dev.db`,从头创建,应用所有 migrations,然后应用 `db/seeds/dev.sql`(如果存在)。该命令 SHALL 提示用户确认(默认否),输入项目名才能继续。

#### Scenario: reset 后重建 dev.db
- **WHEN** 用户执行 `localapp db reset`,输入项目名确认
- **THEN** CLI 删除 `.localapp/dev.db`(如存在)
- **AND** 创建空 dev.db
- **AND** 按顺序应用 `migrations/` 目录所有 migration
- **AND** 如果存在 `db/seeds/dev.sql`,执行该 seed 文件
- **AND** 打印 "Reset complete. <N> migrations applied, seed applied."

#### Scenario: reset 时没有 seed 文件
- **WHEN** 用户执行 `localapp db reset`,项目无 `db/seeds/dev.sql`
- **THEN** CLI 跳过 seed 步骤
- **AND** 打印 "Reset complete. <N> migrations applied. No seed file."

#### Scenario: reset 用户确认失败
- **WHEN** 用户执行 `localapp db reset`,但输入的项目名与 manifest.json 不匹配
- **THEN** CLI 拒绝执行,退出码 1
- **AND** 不修改任何文件

### Requirement: localapp db shell 命令

`localapp db shell` SHALL 启动 sqlite3 CLI,连接 `.localapp/dev.db`,供用户手动调试。

#### Scenario: 进入 sqlite shell
- **WHEN** 用户执行 `localapp db shell`
- **THEN** CLI 启动 `sqlite3 .localapp/dev.db`(若系统已安装 sqlite3)
- **AND** 用户可在 shell 内执行任意 SQL

#### Scenario: sqlite3 未安装
- **WHEN** 用户执行 `localapp db shell`,但系统未安装 sqlite3 命令
- **THEN** CLI 打印错误 "sqlite3 command not found. Install it or use localapp db types to inspect schema."
- **AND** 退出码 1

### Requirement: db/seeds/dev.sql 仅 dev 模式应用

`db/seeds/dev.sql` 文件 SHALL 仅在 `localapp db reset` 时应用到 dev.db。upload 流程 SHALL NOT 上传该文件到生产 server,生产 server SHALL NOT 执行该 seed 文件。

#### Scenario: seed 文件不被上传
- **WHEN** 用户执行 `localapp upload`,项目包含 `db/seeds/dev.sql`
- **THEN** 上传 bundle 不包含该 seed 文件
- **AND** 生产 server 永远不执行 dev seed

#### Scenario: seed 文件包含测试数据
- **WHEN** 用户在 `db/seeds/dev.sql` 写入 `INSERT INTO tasks (title) VALUES ('测试任务1'), ('测试任务2');`
- **AND** 执行 `localapp db reset`
- **THEN** dev.db 的 tasks 表包含这两条测试记录
- **AND** 生产 app.db 不受影响
