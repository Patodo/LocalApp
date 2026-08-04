## MODIFIED Requirements

### Requirement: 用户登录

系统 SHALL 提供 `POST /api/auth/login` 接口，验证用户名密码后签发 JWT，设置 HttpOnly cookie。若用户 `must_change_password` 标记为 true，SHALL 拒绝登录并返回特定错误。

#### Scenario: 登录成功
- **WHEN** 发送 `POST /api/auth/login` 携带 `{ username: "alice", password: "pass123" }` 且凭据正确且 `must_change_password` 为 false
- **THEN** 返回 `{ success: true, data: { id: "alice", name: "alice" } }`，设置 HttpOnly cookie `token` 包含 JWT

#### Scenario: 需要强制改密
- **WHEN** 发送 `POST /api/auth/login` 携带正确凭据但 `must_change_password` 为 true
- **THEN** 返回 HTTP 403，`{ success: false, error: "Password reset required", code: "MUST_CHANGE_PASSWORD" }`

#### Scenario: 用户名不存在
- **WHEN** 发送 `POST /api/auth/login` 携带不存在的 username
- **THEN** 返回 HTTP 401，`{ success: false, error: "Invalid credentials" }`

#### Scenario: 密码错误
- **WHEN** 发送 `POST /api/auth/login` 携带错误密码
- **THEN** 返回 HTTP 401，`{ success: false, error: "Invalid credentials" }`

### Requirement: 用户数据初始化

服务器启动时 MUST 确保 `users` 表存在于 meta.sqlite 中。若不存在 SHALL 自动创建。users 表 SHALL 包含 `must_change_password` 列。

#### Scenario: 已有表缺少 must_change_password 列
- **WHEN** `users` 表已存在但缺少 `must_change_password` 列
- **THEN** 通过 `ALTER TABLE` 添加 `must_change_password INTEGER NOT NULL DEFAULT 0` 列

#### Scenario: 已有表且包含该列
- **WHEN** `users` 表已存在且包含 `must_change_password` 列
- **THEN** 直接使用，不做修改
