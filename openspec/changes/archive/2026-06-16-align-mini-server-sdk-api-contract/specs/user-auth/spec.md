## ADDED Requirements

### Requirement: 开发态 /api/me 使用标准响应形态

mini-server 的 `GET /api/me` SHALL 返回与生产 server 一致的 `{ success: true, data: User | null }` 响应形态。返回用户 SHALL 包含 SDK `User` 类型允许的字段：`id`、`name`、`role`、`displayName`、`avatarUrl`、`bio`。

#### Scenario: 默认 dev 用户
- **WHEN** dev 应用请求 `GET /api/me`
- **THEN** mini-server SHALL 返回 `{ success: true, data: { id: "dev-user", name: "Dev User", role: "owner", ... } }`

#### Scenario: 切换 dev 用户
- **WHEN** Dev Toolkit 将当前 dev context user 切换为 `alice`
- **THEN** 后续 `GET /api/me` SHALL 返回 `{ success: true, data: { id: "alice", name: "Alice", role: "user", ... } }`

#### Scenario: 未登录 dev 用户
- **WHEN** Dev Toolkit 将当前 dev context user 设置为 `null`
- **THEN** 后续 `GET /api/me` SHALL 返回 `{ success: true, data: null }`
- **AND** SDK `useMe()` SHALL 将 `me` 设为 `null` 且不设置错误
