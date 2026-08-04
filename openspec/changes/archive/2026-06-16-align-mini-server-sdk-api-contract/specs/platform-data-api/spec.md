## ADDED Requirements

### Requirement: 开发态平台数据 API 明确代理或 mock

在 `localapp dev` 下，`/api/platform/*` SHALL 由 mini-server 处理。mini-server SHALL 优先代理配置的生产 server 并注入 API Key；当代理不可用或未配置时，mini-server SHALL 返回稳定 mock 数据或明确错误，不得落入应用 CRUD。

#### Scenario: 代理平台用户
- **WHEN** dev 应用请求 `GET /api/platform/users`
- **AND** dev-config 中配置了可用 serverUrl 和 apiKey
- **THEN** mini-server SHALL 代理到生产 server
- **AND** 缓存成功响应

#### Scenario: 平台代理不可用
- **WHEN** dev 应用请求 `GET /api/platform/users`
- **AND** 生产 server 不可达
- **THEN** mini-server SHALL 返回稳定 mock 数据或明确 JSON 错误
- **AND** 不得将 `platform` 当作应用资源

#### Scenario: 保留平台资源
- **WHEN** dev 应用请求 `/api/platform/groups`、`/api/platform/roles` 或 `/api/platform/version`
- **THEN** mini-server SHALL 使用平台数据处理路径
- **AND** 返回与生产平台数据 API 同构的 `{ success, data }`
