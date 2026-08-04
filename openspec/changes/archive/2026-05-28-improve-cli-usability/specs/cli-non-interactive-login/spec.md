## ADDED Requirements

### Requirement: 非交互式登录

CLI `login` 命令 SHALL 支持通过 `--server-url` 和 `--api-key` 命令行参数进行非交互式配置。当两者均提供时，跳过交互式输入，直接保存配置到 `~/.localapp/work/config.json`。

#### Scenario: 通过命令行参数配置
- **WHEN** 执行 `localapp login --server-url http://localhost:3000 --api-key sk-xxx`
- **THEN** 直接保存配置到 `~/.localapp/work/config.json`，输出 `{"success": true}`，不触发交互式输入

#### Scenario: 仅提供 server-url 回退交互式
- **WHEN** 执行 `localapp login --server-url http://localhost:3000`（未提供 --api-key）
- **THEN** 进入交互式流程，serverUrl 以命令行提供的值作为默认值，仍提示输入 apiKey

#### Scenario: 仅提供 api-key 时回退交互式
- **WHEN** 执行 `localapp login --api-key sk-xxx`（未提供 --server-url）
- **THEN** 进入标准交互式流程（不预填 apiKey，因为 Password 对话框出于安全考虑不支持默认值）

#### Scenario: 无参数时保持原有交互式行为
- **WHEN** 执行 `localapp login`（无参数）
- **THEN** 行为与原来完全一致，交互式提示输入 serverUrl 和 apiKey
