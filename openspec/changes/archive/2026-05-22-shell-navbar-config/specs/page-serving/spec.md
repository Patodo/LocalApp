## MODIFIED Requirements

### Requirement: 页面服务根据 shell 配置调整渲染
服务端 SHALL 根据页面的 shell 配置决定渲染方式。

#### Scenario: navbar 为 false 时重定向
- **WHEN** 页面的 meta.json 中 `shell.navbar` 为 false 且用户访问 `GET /:userId/:name`
- **THEN** 服务端返回 HTTP 302 重定向到 `/serve/{userId}/{name}/`

#### Scenario: navbar 为 true 或未设置时保持现有行为
- **WHEN** 页面的 meta.json 中 `shell.navbar` 为 true 或未设置
- **THEN** 服务端保持现有行为，渲染 Shell HTML（导航栏 + iframe）
