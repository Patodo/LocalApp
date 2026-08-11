# db-validate-flow Specification

## Purpose

定义本地 migrations/backend contract 针对明确 Server 目标的兼容性检查；该检查不构成第二个运行时后端。

## Requirements

### Requirement: localapp db validate 对明确 Server 快照执行兼容性检查

`localapp db validate` SHALL 使用当前命名 Server 连接拉取目标应用数据库快照，将快照写入 `tmp/localapp-schema/production-snapshot.db`，并在该副本上按顺序应用尚未执行的 migrations、校验 checksum 和 backend contract 一致性。该文件 SHALL 只是可删除的本地验证产物，不得接收应用 HTTP 请求或作为 `localapp dev` 的业务数据库。

#### Scenario: 远端兼容性检查通过

- **WHEN** 目标 Server 上的应用已有数据库且本地有两个新 migration
- **THEN** CLI SHALL 将目标快照写入项目 `tmp/localapp-schema/production-snapshot.db`
- **AND** SHALL 在副本上应用两个 migration 并验证 backend contract
- **AND** SHALL 写入 `.localapp/.last-validated` 的时间戳与 checksum

#### Scenario: 目标应用尚无数据库

- **WHEN** 目标 Server 返回应用快照不存在
- **THEN** CLI SHALL 以空数据库作为兼容性起点验证完整 migration 链
- **AND** SHALL NOT 创建或修改目标应用

#### Scenario: migration 不兼容

- **WHEN** 某个 migration 无法应用到目标快照
- **THEN** CLI SHALL 返回包含 migration 名称的明确错误
- **AND** SHALL 删除或不更新 `.localapp/.last-validated`
- **AND** 目标 Server 数据 SHALL 保持不变

### Requirement: localapp check 绑定同一个命名目标

`localapp check --profile <name>` SHALL 在命令开始时解析一次目标，并在 capability、migration 和 backend contract 检查中复用该目标。离线 `localapp build --package` SHALL 只验证从空库开始的 migration 链；目标 Server 在安装时仍 SHALL 独立执行完整包校验和原子 migration。

#### Scenario: 使用指定 profile 检查

- **WHEN** 用户执行 `localapp check --profile staging --json`
- **THEN** capability 与数据库快照请求 SHALL 只访问 `staging`
- **AND** 输出 SHALL 标识该目标的检查结果

#### Scenario: 离线构建包

- **WHEN** 用户未配置 Server 而执行 `localapp build --package`
- **THEN** CLI SHALL 验证 migration 可从空库顺序执行
- **AND** SHALL NOT要求存在生产快照或验证标记

### Requirement: 验证产物与 runtime 数据严格分离

`tmp/localapp-schema/production-snapshot.db`、`tmp/localapp-schema/schema.db` 和 `.localapp/.last-validated` SHALL NOT 进入 `.localapp` 包、Server backup、应用数据同步或版本目录。

#### Scenario: 安装已验证项目

- **WHEN** 项目存在 schema 工作库、目标快照和验证标记并执行 `localapp app install`
- **THEN** 包清单 SHALL 不包含这些文件
- **AND** Server SHALL 只从包内 migrations 和自身当前数据库决定安装结果
