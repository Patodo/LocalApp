# upload-atomic-deploy Specification

## Purpose
TBD - created by archiving change local-mini-server-and-sql-migrations. Update Purpose after archive.
## Requirements
### Requirement: upload 包含 dist + migrations + manifest 的原子发布

`localapp upload` SHALL 把 `dist/` 目录、`migrations/` 目录所有 SQL 文件、`manifest.json` 打包为一个 bundle 上传到生产 server。server 端在事务中应用 migrations,然后部署 dist,事务提交才反馈 "Upload complete"。

整个流程 SHALL 满足用户可见原子性:dist 部署与 db migration 同时成功或同时失败,不存在客户端读到新 dist 但 app.db 仍是旧 schema 的中间状态。由于 SQLite 事务不能覆盖文件系统写入,server SHALL 使用 staging 目录 + current 指针原子切换来隔离 dist 写入;失败时 staging 不可见。

#### Scenario: upload 标准流程
- **WHEN** 用户执行 `localapp upload`
- **THEN** CLI 先运行 `npm run build` 生成 dist/
- **AND** CLI 运行 `localapp db validate`(强制),失败则中断 upload
- **AND** CLI 打包 dist + migrations + manifest 为 multipart bundle
- **AND** CLI 上传 bundle 到 server `/api/upload` 端点
- **AND** server 端在事务中应用 pending migrations → 部署 dist → 提交
- **AND** server 返回 `{ success: true, version: <N+1> }`
- **AND** CLI 打印 "Upload complete. Version v<N+1> deployed."

#### Scenario: upload 失败时全回滚
- **WHEN** upload 过程中任一步骤失败(migration SQL 错误、磁盘满、网络中断后 server 内部失败)
- **THEN** server 端事务 ROLLBACK
- **AND** app.db 内容不变(migration 没应用)
- **AND** dist 新版本未部署(current 指针未切换,staging 目录不可见或已清理)
- **AND** server 返回错误信息
- **AND** CLI 打印 "Upload failed: <reason>. Both database and dist rolled back."

#### Scenario: upload 时无 pending migration
- **WHEN** upload bundle 不包含新的 migration 文件(或所有 migration 已应用)
- **THEN** server 跳过 migration 步骤
- **AND** 直接部署 dist(仍然在事务内,但 migration 步骤空操作)
- **AND** 反馈 "Upload complete"

### Requirement: upload 备份 app.db 保留前两版本

server 端 SHALL 在应用 migrations 之前,把当前 `app.db` 备份到 `app.db.backup.v1`(若 v1 已存在则升级为 v2,v2 已存在则删除旧的 v2)。备份保留策略:**仅保留前两版本**,更老的备份自动删除。

#### Scenario: 第一次 backup
- **WHEN** 应用首次有 pending migration 时执行 upload
- **AND** 当前无 `app.db.backup.v1`
- **THEN** server 把 app.db 复制到 `app.db.backup.v1`
- **AND** 应用 migrations,部署 dist

#### Scenario: 第二次 backup 升级 v1 为 v2
- **WHEN** 应用第二次有 pending migration 时执行 upload
- **AND** `app.db.backup.v1` 已存在
- **THEN** server 把 `app.db.backup.v1` 重命名为 `app.db.backup.v2`(若 v2 已存在则先删除)
- **AND** server 把当前 app.db 复制到 `app.db.backup.v1`
- **AND** 应用 migrations,部署 dist

#### Scenario: 第三次 backup 自动淘汰旧 v2
- **WHEN** 第三次 backup,`app.db.backup.v1` 和 `app.db.backup.v2` 都已存在
- **THEN** server 删除旧 `app.db.backup.v2`
- **AND** 把 `app.db.backup.v1` 重命名为 `app.db.backup.v2`
- **AND** 把当前 app.db 复制到 `app.db.backup.v1`
- **AND** 应用 migrations,部署 dist

### Requirement: localapp db restore 紧急恢复命令

`localapp db restore --backup v1` SHALL 把生产的 `app.db.backup.v1` 恢复为 `app.db`,该命令 SHALL 在生产 server 端执行(由 CLI 通过 `/api/db/restore` 触发)。

该命令 SHALL 标记为高风险:恢复会丢失 backup 之后的所有数据变更。CLI SHALL 要求用户输入项目名 + 风险确认(`--i-know-this-loses-data` 标志)才能执行。

#### Scenario: 紧急恢复到 backup.v1
- **WHEN** 用户执行 `localapp db restore --backup v1 --i-know-this-loses-data`,输入项目名确认
- **THEN** CLI 调用 server 端 `/api/db/restore` 端点
- **AND** server 把 `app.db.backup.v1` 复制为 `app.db`(覆盖当前)
- **AND** 反馈 "Restored to backup.v1. Data after this backup is lost."

#### Scenario: restore 缺少确认标志
- **WHEN** 用户执行 `localapp db restore --backup v1`,但未提供 `--i-know-this-loses-data`
- **THEN** CLI 拒绝执行,提示 "Restore is destructive. Add --i-know-this-loses-data flag."

#### Scenario: restore 不存在的 backup
- **WHEN** 用户执行 `localapp db restore --backup v5`,但只有 v1、v2
- **THEN** server 返回错误 "backup.v5 not found"
- **AND** CLI 打印错误退出

### Requirement: upload 的 migration checksum 验证

server 端 SHALL 验证 upload bundle 中的 migration 文件 checksum 与本地计算的一致。任何 checksum 不匹配(文件被篡改/损坏)SHALL 拒绝 upload,防止恶意 migration 进入生产。

#### Scenario: checksum 一致通过
- **WHEN** upload bundle 包含 `002_xxx.sql`,文件 checksum 与 CLI 端计算一致
- **THEN** server 接受该文件,加入 pending migrations 队列

#### Scenario: checksum 不一致拒绝
- **WHEN** upload bundle 包含 `002_xxx.sql`,但文件 checksum 与 CLI 声明的不一致(可能传输损坏或恶意篡改)
- **THEN** server 拒绝整个 upload
- **AND** 返回错误 "Migration 002_xxx.sql checksum mismatch"
- **AND** 反馈给 CLI,CLI 打印错误退出

### Requirement: 远程发布固定目标且不携带本地数据

远程发布 SHALL 将已解析的单一 Server 目标贯穿检查、数据库兼容验证、页面注册、上传和部署验证。发布 bundle SHALL 只包含应用代码产物、manifest、migrations 和 backend contract，SHALL NOT 隐式包含 Local Runtime 数据库、文件、备份或平台配置。

#### Scenario: 发布到指定 Server
- **WHEN** 用户选择一个命名 Server 发布本地应用
- **THEN** 发布的全部远端阶段 SHALL 只访问该 Server
- **AND** 成功结果 SHALL 返回该 Server 上的正式应用 URL

#### Scenario: 本地数据不随发布上传
- **WHEN** 本地应用存在数据库记录、用户文件、备份和平台配置
- **THEN** 常规远程发布 SHALL NOT 上传这些本地数据
- **AND** 远端应用 SHALL 使用自身独立的数据空间
