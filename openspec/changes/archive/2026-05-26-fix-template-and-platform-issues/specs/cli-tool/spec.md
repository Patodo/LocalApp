## MODIFIED Requirements

### Requirement: init 命令

CLI SHALL 提供 `init --name <name>` 命令创建新项目。帮助文本 SHALL 使用中文描述命令用途和各参数含义。

init 成功完成后 SHALL 输出 JSON 到 stdout，其中 `url` 字段为 shell wrapper 格式（`http://{host}/{userId}/{name}/`），而非直接 serve 路径。

#### Scenario: init --help 输出
- **WHEN** 执行 `localapp init --help`
- **THEN** 显示中文命令描述，name 和 description 参数说明为中文，skip_deploy 参数说明为中文

#### Scenario: init 成功后输出 shell wrapper URL
- **WHEN** 执行 `localapp init my-cool-app` 且流程完全成功
- **THEN** stdout 的 JSON 中 `url` 字段为 `http://{host}/{user}/my-cool-app/` 格式，不包含 `/serve/` 路径段
