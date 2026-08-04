## MODIFIED Requirements

### Requirement: init 命令 name 验证

CLI `init` 命令 SHALL 使用与 server 一致的 name 验证规则：小写字母+数字+连字符，字母开头，3-63 字符，禁止连续连字符和首尾连字符，禁止保留词。init 成功后 SHALL 在项目目录下创建 `.localapp/dev-config.json`，包含 CLI 配置中的服务器地址。

#### Scenario: 合法 name
- **WHEN** 执行 `localapp init my-cool-app`
- **THEN** 创建 manifest.json 和 `.localapp/dev-config.json`，dev-config 包含 `{ "serverUrl": "<cli配置的server_url>" }`

#### Scenario: 非法 name（大写）
- **WHEN** 执行 `localapp init My-Cool-App`
- **THEN** 输出错误，提示 name 规则

#### Scenario: 非法 name（保留词）
- **WHEN** 执行 `localapp init api`
- **THEN** 输出错误，提示 name 为保留词

#### Scenario: 非法 name（数字开头）
- **WHEN** 执行 `localapp init 123app`
- **THEN** 输出错误，提示 name 必须字母开头
