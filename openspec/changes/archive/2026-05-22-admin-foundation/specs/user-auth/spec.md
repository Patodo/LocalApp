## MODIFIED Requirements

### Requirement: 用户认证支持角色
用户注册/登录流程 SHALL 感知 `role` 字段。

#### Scenario: 注册返回 role
- **WHEN** 用户注册成功
- **THEN** 响应 `data` 包含 `role: "user"`

#### Scenario: 登录 JWT 包含 role
- **WHEN** 用户登录成功
- **THEN** JWT payload 包含 `{ id, name, role }`

#### Scenario: /api/me 返回 role
- **WHEN** 已认证用户请求 `GET /api/me`
- **THEN** 响应 `data` 包含 `role` 字段
