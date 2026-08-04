## ADDED Requirements

### Requirement: dev-config 暴露 mini-server dev API 上下文
`localapp dev` 写入的 `.localapp/dev-config.json` SHALL 包含足够信息，让 DevShell 和 vite-plugin 在 dev 模式中稳定访问 mini-server dev API。至少 SHALL 包含 `miniServerPort`，并允许 DevShell 推导本地 dev API base URL。

#### Scenario: dev-config 包含 miniServerPort
- **WHEN** 用户执行 `localapp dev`
- **THEN** CLI SHALL 在 mini-server ready 后写入 `.localapp/dev-config.json`
- **AND** 文件 SHALL 包含 `miniServerPort`
- **AND** DevShell SHALL 能通过该端口访问 `/api/dev/context`

#### Scenario: 缺少 miniServerPort 时降级
- **WHEN** `dev-config.json` 缺少 `miniServerPort`
- **THEN** DevShell SHALL 隐藏需要 mini-server dev API 的工具
- **AND** vite-plugin SHALL 保持既有 fallback proxy 行为

### Requirement: dev proxy 将 dev API 固定转发到 mini-server
Vite dev proxy SHALL 将 `/api/dev/*` 请求转发到 mini-server，并且不得转发到生产 server。

#### Scenario: DevShell 请求 dev context
- **WHEN** DevShell 请求 `/api/dev/context`
- **THEN** vite dev proxy SHALL 转发到 mini-server
- **AND** 请求 SHALL NOT 到达生产 server

#### Scenario: dev API 不注入生产鉴权
- **WHEN** DevShell 请求 `/api/dev/*`
- **THEN** vite dev proxy SHALL NOT 将该请求转发到生产 server
- **AND** 不得因为生产 API key 缺失导致 dev API 不可用
