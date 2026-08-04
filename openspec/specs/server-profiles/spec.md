# server-profiles Specification

## Purpose
TBD - created by syncing change add-desktop-local-runtime. Update Purpose when the capability is finalized.

## Requirements

### Requirement: 命名 Server 配置

LocalApp SHALL 支持多个命名 Server profile。每个 profile SHALL 包含规范化 Server URL 和独立凭据；CLI 与 Desktop 展示 profile 时 SHALL NOT 向前端或日志返回 API Key。现有 `config.json` SHALL 继续作为当前目标的兼容配置。

#### Scenario: 管理多个 Server
- **WHEN** 用户添加两个不同名称的有效 Server profile
- **THEN** `localapp server list` SHALL 列出名称、URL、当前状态和登录状态
- **AND** SHALL NOT 输出 API Key

#### Scenario: 旧配置继续工作
- **WHEN** 用户只有旧格式 `config.json` 且未创建 profile
- **THEN** 现有需要 Server 的命令 SHALL 继续使用该配置
- **AND** 不要求用户先迁移配置

### Requirement: 发布目标确定性解析

需要 Server 的操作 SHALL 在命令开始时按规定优先级解析一次目标，并在 capability check、数据库验证、页面注册、上传和验证阶段复用同一个 `ResolvedTarget`。完整环境临时目标与显式 profile 同时存在 SHALL 返回冲突错误。

#### Scenario: 显式选择发布目标
- **WHEN** 用户执行 `localapp upload --profile staging --verify`
- **THEN** 检查、注册、上传和验证 SHALL 全部请求 `staging` 的 Server
- **AND** 中途切换 active profile SHALL NOT 改变本次发布目标

#### Scenario: 冲突目标被拒绝
- **WHEN** 用户同时设置完整 Server 环境变量并传入 `--profile`
- **THEN** CLI SHALL 在发出任何远端请求前返回目标冲突错误

### Requirement: Profile 变更原子且互不影响

登录、更新、退出或删除一个 profile SHALL 原子修改 profile store，验证失败 SHALL 保留旧内容，且 SHALL NOT 修改其他 profile。选择 active profile SHALL 更新旧 `config.json` 兼容镜像。

#### Scenario: 命名登录失败不破坏配置
- **WHEN** 用户对一个 profile 使用无效 API Key 登录
- **THEN** 该 profile 的旧配置和其他 profile SHALL 保持字节级不变

#### Scenario: 切换当前 Server
- **WHEN** 用户执行 `localapp server use production`
- **THEN** active profile SHALL 变为 `production`
- **AND** 兼容 `config.json` SHALL 原子反映该目标
