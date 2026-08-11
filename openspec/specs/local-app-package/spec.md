# local-app-package Specification

## Purpose

定义可移植 `.localapp` 应用包，以及统一 Server 对该包执行校验、安装、版本更新和失败回滚的唯一发布契约。

## Requirements

### Requirement: 可验证且不携带实例数据的应用包

LocalApp CLI SHALL 将通过本地检查和构建的应用生成为确定性 `.localapp` ZIP。包 SHALL 只包含构建产物、`manifest.json`、migrations、backend contract、平台兼容信息、版本元数据和逐文件 SHA-256 清单。包 SHALL NOT 包含应用数据库、上传文件、备份、Server 配置、用户或权限、API Key、session、`node_modules` 或可执行 Server 实现。

#### Scenario: 离线构建应用包

- **WHEN** 用户在有效项目中执行 `localapp build --package`
- **THEN** CLI SHALL 在不读取 Server 凭据且不发出远程请求的情况下完成检查和构建
- **AND** SHALL 输出 `.localapp` 文件路径、应用名、应用版本和摘要

#### Scenario: 包中不包含实例数据

- **WHEN** 项目或开发 Server 已有业务记录、上传文件、用户、备份和配置
- **THEN** 生成的 `.localapp` SHALL NOT 包含这些实例数据
- **AND** 文件清单 SHALL 只列出允许的可移植发布内容

### Requirement: 统一 Server 提供正式安装入口并复用唯一安装器

所有部署形态安装 `.localapp` 的正式入口 SHALL 为 `POST /api/me/apps/install`。该端点 SHALL 使用正常 session 或 API Key 鉴权，并把认证用户作为目标端应用所有者。Server MAY 保留 `legacy-upload-transport` 定义的已认证 multipart 部署兼容传输，但它 SHALL 先规范化为 `.localapp` 并调用同一个正式安装器，不得形成第二套安装实现。CLI SHALL 使用 `localapp app install --target <profile>` 选择一个明确 Server；不得存在旧原生客户端安装协议、模板安装服务或按部署形态分叉的安装器。

#### Scenario: 首次安装应用

- **WHEN** 目标 API Key 对应用户执行 `localapp app install --target local`
- **AND** 目标用户尚无该名称的应用
- **THEN** Server SHALL 创建同名应用并将该用户设为所有者
- **AND** 响应 SHALL 返回正式 `/<owner>/<app>/` URL

#### Scenario: 同名应用安装新版本

- **WHEN** 目标用户已有同名应用且安装包使用新的应用版本
- **THEN** Server SHALL 创建不可变版本记录并在全部检查成功后原子激活
- **AND** 应用名称和所有者 SHALL 保持不变

### Requirement: 安装前完整性与兼容性校验

Server SHALL 在修改应用版本、数据库或文件前验证包 schema、应用名称、版本、平台兼容范围、backend contract、路径、文件类型、数量和展开大小预算以及全部 checksum。Server SHALL 拒绝绝对路径、路径穿越、符号链接、重复条目、未声明 backend 文件和不支持的压缩格式。

#### Scenario: 拒绝损坏或越界的包

- **WHEN** 安装包 checksum 不匹配、包含路径穿越或符号链接，或超出平台预算
- **THEN** Server SHALL 原子拒绝安装并返回可操作错误
- **AND** 已安装版本、应用数据库、文件和 current 指针 SHALL 保持不变

#### Scenario: 平台或 backend contract 不兼容

- **WHEN** 包声明的 `platformVersion` 不兼容，或 backend contract 校验失败
- **THEN** Server SHALL 在 staging 阶段拒绝安装
- **AND** 包内容 SHALL NOT 成为可访问版本

### Requirement: 应用版本身份确定且幂等

包中的稳定 `appVersion` 与包摘要 SHALL 共同标识一个可移植应用版本。相同名称、相同版本和相同摘要的重复安装 SHALL 幂等成功；相同名称和版本使用不同摘要 SHALL 返回 HTTP 409，且不得覆盖已有版本。

#### Scenario: 重复安装同一包

- **WHEN** 用户重复安装相同 `appVersion` 和摘要的 `.localapp`
- **THEN** Server SHALL 返回已有安装结果
- **AND** SHALL NOT 重复运行 migration 或创建另一个版本目录

#### Scenario: 同版本摘要冲突

- **WHEN** 用户安装与已有 `appVersion` 相同但摘要不同的包
- **THEN** Server SHALL 返回 HTTP 409
- **AND** 当前活动版本 SHALL 保持不变

### Requirement: migration、激活与回滚原子化

Server SHALL 在 Server 自有 staging 根中解包，备份目标应用数据库和版本元数据，按顺序应用未执行 migrations，验证 backend contract 和应用健康状态，再原子切换活动版本。每个不可变版本 SHALL 在私有 `.localapp` 元数据中保留 migration 快照标记，记录应用版本、包摘要以及 migration 文件大小和 SHA-256；即使 migration 集为空也 SHALL 保留显式空标记。migration、文件移动、健康检查或激活失败时 SHALL 恢复先前版本和数据库；只有经过完整性校验的回滚才可标记为成功。

#### Scenario: migration 失败自动回滚

- **WHEN** 新包 migration 执行失败
- **THEN** Server SHALL 保持旧活动版本可用
- **AND** SHALL 恢复安装前数据库并清理或隔离 staging 内容

#### Scenario: 安装中断后恢复

- **WHEN** Server 在 staging、migration 或激活过程中退出
- **THEN** Server 下次启动 SHALL 根据持久化安装状态幂等完成恢复
- **AND** SHALL NOT 暴露半安装版本

#### Scenario: 回滚校验失败

- **WHEN** Server 无法验证恢复后的旧版本或数据库
- **THEN** 安装任务 SHALL 进入 `recovery-required`
- **AND** Server SHALL 保留 staging 与备份以供管理员恢复

#### Scenario: 升级旧布局后回滚并重置数据

- **WHEN** 已保留旧版本 `.localapp` 包，但该历史版本目录尚无 migration 快照，并安装一个新版本
- **THEN** Server SHALL 先验证旧包的名称、应用版本和摘要，再安全补建该历史版本的 migration 快照
- **AND** 回滚到旧版本后恢复出厂 SHALL 只应用旧版本快照并保留安全备份
- **AND** SHALL NOT 回退到当前源码、其它版本或含糊的空 migration 目录

#### Scenario: 无 migration 的版本

- **WHEN** 合法应用包不包含任何 migration
- **THEN** Server SHALL 为该版本写入 `files: []` 的显式快照标记和空 migration 目录
- **AND** 后续重置 SHALL 将其识别为经过验证的空 schema，而不是缺失元数据

### Requirement: 开发安装复用正式包契约

`localapp dev` SHALL 为每次开发构建生成合法且唯一的应用版本，并通过 `/api/me/apps/install` 安装到项目下的 canonical Server。CLI SHALL NOT 直接复制 `dist/`、migration 或数据库到 Server 数据目录。

#### Scenario: 源码变化但 manifest 版本未变

- **WHEN** 两次 `localapp dev` 使用相同 manifest 版本但构建摘要不同
- **THEN** CLI SHALL 生成两个不同的合法开发版本
- **AND** 第二个版本 SHALL 通过普通安装器成为同名应用更新
