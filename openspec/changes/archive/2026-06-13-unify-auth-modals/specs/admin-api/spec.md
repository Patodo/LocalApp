## ADDED Requirements

### Requirement: 管理员创建用户

系统 SHALL 提供 `POST /api/admin/users` 端点，仅限 admin 角色调用，接受 `username`，创建新用户。创建的用户 SHALL 使用默认密码 `localapp`（bcrypt 哈希），设置 `must_change_password = 1`，`role = "user"`。

#### Scenario: 管理员成功创建用户
- **WHEN** admin 角色用户发送 `POST /api/admin/users` 携带 `{ username: "newuser" }`
- **THEN** 创建用户（密码 `localapp`，`must_change_password = 1`，`role = "user"`）
- **AND** 返回 `{ success: true, data: { id: "newuser", name: "newuser", role: "user" } }`

#### Scenario: 用户名已存在
- **WHEN** admin 发送 `POST /api/admin/users` 携带已存在的 `username`
- **THEN** 返回 HTTP 409，`{ success: false, error: "Username already exists" }`

#### Scenario: 用户名格式不合法
- **WHEN** admin 发送 `POST /api/admin/users` 携带的 username 不匹配 `^[a-zA-Z0-9_-]{2,32}$`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid username format" }`

#### Scenario: 非管理员被拒绝
- **WHEN** 非 admin 角色用户发送 `POST /api/admin/users`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Admin access required" }`

#### Scenario: 未认证被拒绝
- **WHEN** 未携带任何凭证发送 `POST /api/admin/users`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`
