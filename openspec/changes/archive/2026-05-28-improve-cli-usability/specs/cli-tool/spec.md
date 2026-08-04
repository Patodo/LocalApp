## MODIFIED Requirements

### Requirement: login 命令

CLI SHALL 提供 `login` 命令，交互式收集 serverUrl 和 apiKey，保存到 `~/.localapp/work/config.json`。帮助文本 SHALL 使用中文描述命令用途。SHALL 支持通过 `--server-url` 和 `--api-key` 参数进行非交互式配置，两者均提供时跳过交互式输入。

#### Scenario: 首次配置
- **WHEN** 执行 `localapp login` 且 `~/.localapp/work/config.json` 不存在
- **THEN** 提示输入 serverUrl 和 apiKey，创建配置文件，输出 `{"success": true}`

#### Scenario: 更新配置
- **WHEN** 执行 `localapp login` 且配置文件已存在
- **THEN** 提示输入新的 serverUrl 和 apiKey（显示当前值作为默认），覆盖写入

#### Scenario: 非交互式配置
- **WHEN** 执行 `localapp login --server-url http://localhost:3000 --api-key sk-xxx`
- **THEN** 跳过交互式输入，直接保存配置，输出 `{"success": true}`

#### Scenario: 帮助文本为中文
- **WHEN** 执行 `localapp login --help`
- **THEN** 显示中文命令描述，面向用户而非开发者
