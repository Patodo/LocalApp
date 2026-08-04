## MODIFIED Requirements

### Requirement: 访客身份查询

系统 SHALL 提供 `GET /api/me` 接口，返回当前请求的访客身份。该接口 MUST 同时支持 cookie 认证和 API Key 认证。返回数据 SHALL 包含 `displayName`、`avatarUrl`、`bio` 字段。

#### Scenario: 已登录用户查询身份（cookie）
- **WHEN** 携带有效 JWT cookie 请求 `GET /api/me`
- **THEN** 返回 `{ success: true, data: { id: "alice", name: "alice", role: "user", displayName: "张三", avatarUrl: "/api/me/avatar", bio: "全栈开发者" } }`

#### Scenario: 已登录用户查询身份（API Key）
- **WHEN** 携带有效 `X-API-Key` header 请求 `GET /api/me`
- **THEN** 返回 `{ success: true, data: { id: "alice", name: "alice", role: "user", displayName: "张三", avatarUrl: "/api/me/avatar", bio: "全栈开发者" } }`

#### Scenario: 未设置昵称和头像
- **WHEN** 用户的 `display_name` 和 `avatar_url` 为 NULL
- **THEN** 返回 `displayName: null`，`avatarUrl: null`，`bio: null`

#### Scenario: 未登录用户查询身份
- **WHEN** 不携带任何凭证请求 `GET /api/me`
- **THEN** 返回 `{ success: true, data: null }`
