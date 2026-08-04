## ADDED Requirements

### Requirement: mini-server 执行 backend actions
mini-server SHALL 在 dev 模式下提供 `/api/actions/:name`，并使用与生产 server 共享的 action contract 执行 backend actions。

#### Scenario: dev 模式调用 action
- **WHEN** 应用在 `localapp dev` 下调用 `client.action("leave.approve", { id: 1 })`
- **THEN** vite proxy MUST 将请求转发到 mini-server
- **AND** mini-server MUST 执行本地 backend action
- **AND** 返回与生产 server 一致的 `{ success, data }` 或错误格式

#### Scenario: dev action 使用 dev context 用户
- **WHEN** DevShell 当前模拟用户为 `alice`
- **AND** action handler 读取 `ctx.user.id`
- **THEN** mini-server MUST 返回 `alice`

### Requirement: dev/prod action API 表面一致
mini-server 和生产 server SHALL 使用同一应用 API 契约识别 action endpoint，且不得在 dev 模式下暴露生产不存在的 action 行为。

#### Scenario: dev 未注册 action 返回 404
- **WHEN** dev 应用调用未注册 action
- **THEN** mini-server MUST 返回 404
- **AND** 错误格式 MUST 与生产 server 保持一致

#### Scenario: dev action 复用 named SQL
- **WHEN** dev action handler 调用 `ctx.query` 或 `ctx.mutate`
- **THEN** mini-server MUST 使用本地 dev.db 和相同 backend contract 执行 named SQL
