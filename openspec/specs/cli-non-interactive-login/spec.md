## Purpose

CLI 非交互式登录能力。允许通过命令行参数直接配置 serverUrl 和 apiKey，跳过交互式提示，适用于自动化脚本和非交互式终端环境。

## Requirements

### Requirement: 非交互式登录

CLI `login` 命令 SHALL 支持通过 `--server-url` 和 `--api-key` 进行非交互式登录。两者均提供时，CLI MUST 先请求目标 Server 的 `GET /api/me` 验证身份，再原子写入配置。

#### Scenario: 通过命令行参数登录
- **WHEN** 执行 `localapp login --server-url http://localhost:3000 --api-key sk-valid`
- **THEN** CLI 不触发交互式输入并验证候选配置
- **AND** 验证成功后原子保存到配置目录并输出 `{"success": true, ...}`

#### Scenario: 非交互式凭据无效
- **WHEN** 两个参数均提供但 Server 拒绝 API Key
- **THEN** 命令以非零状态退出并输出结构化错误
- **AND** 已有配置保持不变

#### Scenario: 仅提供 server-url 回退交互式
- **WHEN** 执行 `localapp login --server-url http://localhost:3000`
- **THEN** 进入交互式流程，Server URL 以命令行值作为默认值，并提示输入 API Key

#### Scenario: 仅提供 api-key 时回退交互式
- **WHEN** 执行 `localapp login --api-key sk-xxx`
- **THEN** 进入交互式流程并提示输入 Server URL
- **AND** 不在提示内容中回显 API Key

#### Scenario: 无参数时使用安全交互式流程
- **WHEN** 执行 `localapp login`
- **THEN** 交互式提示输入 Server URL 和 API Key
- **AND** 不尝试自动注册
