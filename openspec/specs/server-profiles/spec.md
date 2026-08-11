# server-profiles Specification

## Purpose

定义 CLI 保存多个彼此独立的 canonical Server 连接、保护各端 API Key 并确定性选择命令目标的行为，避免一次构建、安装或同步操作在执行途中切换 Server 或泄漏另一端凭据。

## Requirements

### Requirement: 命名 Server profile

每个 profile SHALL 包含唯一名称、规范化 Server URL 和该 Server 用户的 API Key。CLI SHALL 支持 add、login、list、use 和 remove；任何列表、错误与日志 SHALL NOT 输出 API Key。

#### Scenario: 管理多个 Server

- **WHEN** 用户添加 `local` 和 `production` 两个有效 profile
- **THEN** `localapp server list` SHALL 列出名称、URL 和当前状态
- **AND** SHALL NOT 输出任何凭据

#### Scenario: login 验证 profile

- **WHEN** 用户对一个命名 profile 执行 login
- **THEN** CLI SHALL 先请求该 Server 的 `/api/me`
- **AND** 只有验证成功后才原子保存 URL 和 API Key

### Requirement: 发布目标确定性解析

需要 Server 的命令 SHALL 在开始时按“显式参数、项目默认 profile、当前 profile”的顺序解析一次目标，并在 capability check、数据库兼容检查、包安装和验证阶段复用同一个 `ResolvedTarget`。完整环境临时目标与显式 profile 同时存在 SHALL 返回冲突错误。

#### Scenario: 显式选择安装目标

- **WHEN** 用户执行 `localapp app install --target staging`
- **THEN** 检查和安装 SHALL 全部访问 `staging`
- **AND** 中途改变当前 profile SHALL NOT 改变本次操作

#### Scenario: 项目默认目标

- **WHEN** `.localapp/publish.json` 指定 `defaultProfile: "office"` 且命令未传 target
- **THEN** CLI SHALL 使用 `office`

#### Scenario: 冲突目标被拒绝

- **WHEN** 用户同时设置完整 Server 环境变量并传入显式 profile
- **THEN** CLI SHALL 在发出远程请求前返回目标冲突错误

### Requirement: Profile 变更原子且互不影响

添加、登录、切换或删除一个 profile SHALL 原子修改 profile store；验证或写入失败 SHALL 保留旧内容，且 SHALL NOT 修改其它 profile。当前 profile 的单连接镜像 MAY 供仍使用 `Config::load` 的现有统一 Server 命令读取，但不得引入另一种服务类型。

#### Scenario: 更新失败不破坏配置

- **WHEN** 用户用无效 API Key 更新 `staging`
- **THEN** `staging` 的旧配置和其它 profile SHALL 保持字节级不变

#### Scenario: 切换当前 Server

- **WHEN** 用户执行 `localapp server use production`
- **THEN** current profile SHALL 变为 `production`
- **AND** 后续未显式选目标的命令 SHALL 解析到该 Server

### Requirement: 测试可隔离 CLI 配置目录

`LOCALAPP_CONFIG_DIR` SHALL 覆盖默认 CLI 配置目录，使本地验收可把 profile、当前目标和 API Key 放在仓库 `tmp/` 下，而不修改用户真实配置。

#### Scenario: 使用项目临时配置

- **WHEN** 测试设置 `LOCALAPP_CONFIG_DIR=<repo>/tmp/acceptance/cli-config`
- **THEN** CLI SHALL 只从该目录读取和写入配置
- **AND** 默认用户配置目录 SHALL 保持不变
