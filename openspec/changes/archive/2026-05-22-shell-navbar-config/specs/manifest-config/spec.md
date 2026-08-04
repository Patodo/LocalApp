## MODIFIED Requirements

### Requirement: manifest.json 支持 shell 配置
manifest.json SHALL 支持可选的 `shell` 字段，控制页面渲染方式。

#### Scenario: manifest.json 包含 shell.navbar 配置
- **WHEN** manifest.json 包含 `{ "shell": { "navbar": false } }`
- **THEN** 页面访问时不显示导航栏，直接服务页面内容

#### Scenario: manifest.json 不包含 shell 配置
- **WHEN** manifest.json 不包含 `shell` 字段或 `shell.navbar` 为 true 或未设置
- **THEN** 页面访问时使用默认行为（显示导航栏 + iframe 嵌套）

#### Scenario: shell 配置的数据类型
- **WHEN** manifest.json 包含 shell 字段
- **THEN** shell 为可选对象，包含可选的 boolean 类型 navbar 字段
