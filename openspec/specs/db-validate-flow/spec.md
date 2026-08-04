# db-validate-flow Specification

## Purpose
TBD - created by archiving change local-mini-server-and-sql-migrations. Update Purpose after archive.
## Requirements
### Requirement: localapp db validate 命令

`localapp db validate` SHALL 在 upload 前强制执行,验证本地 migrations 能否安全应用到生产 app.db。流程:

1. 拉取生产 server 的 app.db 完整副本到 `.localapp/prod-snapshot.db`(在线,无缓存)
2. 比对 prod-snapshot.db 的 `_localapp_applied_migrations` 与本地 `migrations/` 目录
3. 把未应用的 migration 按数字顺序应用到 prod-snapshot.db
4. 验证 schema 一致性(可选:跑用户提供的 migration 测试)
5. 全部通过 → 标记 `.localapp/.last-validated` 文件(含时间戳 + checksum)
6. 失败 → 拒绝 upload,提示修复

validate SHALL 强制在线,离线时拒绝执行。

#### Scenario: validate 通过
- **WHEN** 用户执行 `localapp db validate`,本地有 2 个未应用的 migration
- **THEN** CLI 从 server 拉 prod app.db 到 `.localapp/prod-snapshot.db`
- **AND** 按顺序应用 2 个 migration 到 prod-snapshot.db
- **AND** 验证成功 → 写入 `.localapp/.last-validated`(含 migration checksums + 时间戳)
- **AND** 打印 "Validate OK. 2 migrations ready to apply."

#### Scenario: validate 失败
- **WHEN** 应用某个 migration 时 SQL 错误
- **THEN** CLI 打印 "Validation FAILED: migration 005_xxx.sql at line 12: <SQL error>"
- **AND** prod-snapshot.db 保留(用于调试),不被清理
- **AND** `.localapp/.last-validated` 不更新
- **AND** 后续 `localapp upload` 拒绝执行

#### Scenario: validate 强制在线
- **WHEN** 用户执行 `localapp db validate`,但无法连接生产 server
- **THEN** CLI 拒绝执行,打印 "Cannot reach prod server. Validation requires online connection."
- **AND** 退出码 1

#### Scenario: validate 时 prod-snapshot.db 保留
- **WHEN** validate 完成(无论成功失败)
- **THEN** `.localapp/prod-snapshot.db` 文件保留在磁盘
- **AND** 用户可后续用 `localapp db shell --snapshot` 连接该 db 调试

### Requirement: upload 强制 validate 前置

`localapp upload` SHALL 在执行前检查 `.localapp/.last-validated`,如果不存在或时间戳过期(超过 1 小时)或 migration checksum 与当前不一致,SHALL 自动运行 `localapp db validate`。

`--skip-validate` 标志 SHALL 存在但被标记为危险,CLI SHALL 打印警告 + 要求输入项目名确认。

#### Scenario: upload 自动触发 validate
- **WHEN** 用户执行 `localapp upload`,`.localapp/.last-validated` 不存在或过期
- **THEN** CLI 自动运行 validate 流程
- **AND** validate 通过后继续 upload
- **AND** validate 失败则 upload 中断

#### Scenario: upload 复用近期 validate 结果
- **WHEN** 用户在 30 分钟前成功执行 `localapp db validate`
- **AND** migrations/ 目录内容未变
- **AND** 现在执行 `localapp upload`
- **THEN** CLI 跳过 validate 步骤(直接复用)
- **AND** 继续打包上传

#### Scenario: upload 跳过 validate 被视为危险
- **WHEN** 用户执行 `localapp upload --skip-validate`,未输入项目名确认
- **THEN** CLI 拒绝执行
- **AND** 打印 "Skipping validation is dangerous. Add --confirm-project-name <name> to proceed."

#### Scenario: migration 文件变更使 validate 失效
- **WHEN** 用户最近 validate 过,但之后又新增了 migration 文件
- **AND** 执行 `localapp upload`
- **THEN** CLI 检测到 checksum 不匹配,自动重新 validate
- **AND** 不直接复用过期结果

