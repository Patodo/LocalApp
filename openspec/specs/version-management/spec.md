## Purpose

定义 canonical Server 对已安装应用的不可变版本记录、活动指针、历史查询、回退与删除生命周期的管理，确保版本更新和同名重装不会破坏当前可用版本或遗失可审计的包身份。

## Requirements

### Requirement: 安装创建不可变版本记录

每个成功安装的 `.localapp` SHALL 产生不可变版本记录。Server MAY 使用递增本地 deployment sequence 作为存储目录，同时 SHALL 保存包的稳定 `appVersion` 与 digest。只有完成 migration、backend contract 和健康检查的版本才可成为 current。

#### Scenario: 首次安装

- **WHEN** 所有者首次安装应用包
- **THEN** Server SHALL 创建第一个版本目录和版本元数据
- **AND** SHALL 原子设置 currentVersion

#### Scenario: 后续安装

- **WHEN** 同一所有者安装同名应用的新 `appVersion`
- **THEN** Server SHALL 创建新的本地 deployment sequence
- **AND** 旧版本 SHALL 保持不可变并可用于回滚

### Requirement: 稳定版本与摘要冲突规则

相同 `appVersion` 与相同 digest 的重复安装 SHALL 幂等成功。相同 `appVersion` 与不同 digest SHALL 返回 409 且不创建或激活版本。

#### Scenario: 重复安装相同包

- **WHEN** 相同包被再次安装
- **THEN** Server SHALL 返回已有版本结果
- **AND** SHALL NOT重复执行 migration

#### Scenario: 版本摘要冲突

- **WHEN** 已存在 `appVersion=1.0.0` 但新包 digest 不同
- **THEN** Server SHALL 返回 409
- **AND** currentVersion SHALL 保持不变

### Requirement: 版本列表、激活与回滚 API

认证所有者 SHALL 能列出应用版本、激活兼容的历史版本并请求回滚。所有操作 SHALL 执行应用权限检查，并在失败时保持当前版本与数据库一致。

#### Scenario: 列出版本

- **WHEN** 所有者请求 `GET /api/me/apps/:name/versions`
- **THEN** 响应 SHALL 包含本地 sequence、`appVersion`、digest、创建时间和活动状态

#### Scenario: 回滚当前应用

- **WHEN** 所有者请求回滚且备份完整
- **THEN** Server SHALL 恢复前一版本及其匹配数据库状态
- **AND** 完整性检查通过后才报告成功

### Requirement: 删除应用与数据是显式操作

删除应用注册/版本和永久删除应用数据库、文件、备份 SHALL 是权限受控且语义明确的操作。任何删除 SHALL 只作用于当前 Server 和目标所有者/应用，不得影响同名 peer 应用。

#### Scenario: 删除自己的应用

- **WHEN** 所有者通过受支持 API 删除应用
- **THEN** Server SHALL 删除该 Server 上目标应用的注册与版本
- **AND** SHALL 按显式选择保留或永久删除业务数据

#### Scenario: 删除他人的应用

- **WHEN** 普通用户尝试删除另一所有者的应用
- **THEN** Server SHALL 返回 403
- **AND** 版本和数据 SHALL 保持不变

### Requirement: 每个应用最多保留十个完整版本

Server SHALL 为每个应用最多保留 10 个不可变版本目录及其精确 `.localapp` 包。超过上限时 SHALL 始终保护 currentVersion 和 previousVersion，并从其余历史中保留最新版本；最旧且未受保护的版本目录、包和元数据 SHALL 在新版本已持久化后清理。

#### Scenario: 安装第十一个版本

- **WHEN** 一个应用已有 10 个版本且成功安装第 11 个版本
- **THEN** 版本列表 SHALL 最多包含 10 项
- **AND** currentVersion 与 previousVersion SHALL 仍可用于验证或回滚
- **AND** 最旧的未受保护版本 SHALL 不再占用版本目录或 retained package 存储
