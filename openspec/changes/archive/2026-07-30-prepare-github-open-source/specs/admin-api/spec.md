## MODIFIED Requirements

### Requirement: 管理员创建用户

系统 SHALL 提供 `POST /api/admin/users` 端点，仅限 admin 角色调用，接受 `username`。系统 MUST 使用密码学安全随机源生成临时密码和初始 API Key，在同一事务中创建 `role="user"`、`must_change_password=1` 的用户并存储密码与 API Key 的安全哈希。

#### Scenario: 管理员成功创建用户
- **WHEN** admin 角色用户发送 `POST /api/admin/users` 携带 `{ username: "newuser" }`
- **THEN** 原子创建用户、随机临时密码和初始 API Key
- **AND** 返回 `{ success: true, data: { id: "newuser", name: "newuser", role: "user", mustChangePassword: true, credentials: { temporaryPassword, apiKey } } }`

#### Scenario: 用户名已存在
- **WHEN** admin 发送 `POST /api/admin/users` 携带已存在的 `username`
- **THEN** 返回 HTTP 409，`{ success: false, error: "Username already exists" }`
- **AND** 不生成或返回凭据

#### Scenario: 用户名格式不合法
- **WHEN** admin 发送 `POST /api/admin/users` 携带的 username 不匹配 `^[a-zA-Z0-9_-]{2,32}$`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid username format" }`

#### Scenario: 非管理员被拒绝
- **WHEN** 非 admin 角色用户发送 `POST /api/admin/users`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Admin access required" }`

#### Scenario: 未认证被拒绝
- **WHEN** 未携带任何凭证发送 `POST /api/admin/users`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`
