## ADDED Requirements

### Requirement: 管理员重置用户密码

系统 SHALL 提供 `POST /api/admin/reset-password` 端点，仅限 admin 角色调用，接收 `userId`，将用户密码重置为 userId 并设置 `must_change_password` 标记。

#### Scenario: 管理员成功重置密码
- **WHEN** admin 角色用户发送 `POST /api/admin/reset-password` 携带 `{ userId: "alice" }`
- **THEN** 将 alice 的密码用 bcrypt 哈希设为 "alice"，设置 `must_change_password = 1`，返回 `{ success: true, data: { message: "Password has been reset to username. User must change password on next login." } }`

#### Scenario: 非管理员被拒绝
- **WHEN** 非 admin 角色用户发送 `POST /api/admin/reset-password`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Admin access required" }`

#### Scenario: 未认证被拒绝
- **WHEN** 未携带任何凭证发送 `POST /api/admin/reset-password`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`

#### Scenario: 用户不存在
- **WHEN** 发送 `POST /api/admin/reset-password` 携带不存在的 userId
- **THEN** 返回 HTTP 404，`{ success: false, error: "User not found" }`

#### Scenario: 系统用户不可重置
- **WHEN** 发送 `POST /api/admin/reset-password` 携带 `{ userId: "admin" }`（provider 为 system 的用户）
- **THEN** 返回 HTTP 400，`{ success: false, error: "Cannot reset password for system user" }`

### Requirement: 强制改密

系统 SHALL 提供 `POST /api/auth/force-change-password` 端点（公开），接受 `userId`、`oldPassword`、`newPassword`，验证旧密码后更新新密码并清除 must_change_password 标记。

#### Scenario: 成功强制改密
- **WHEN** 发送 `POST /api/auth/force-change-password` 携带 `{ userId: "alice", oldPassword: "alice", newPassword: "newpass456" }`
- **THEN** 验证旧密码正确，用 bcrypt 哈希新密码更新，设置 `must_change_password = 0`，签发 JWT 登录，返回 `{ success: true, data: { id: "alice", name: "alice" } }`

#### Scenario: 旧密码错误
- **WHEN** 发送 `POST /api/auth/force-change-password` 携带错误的 oldPassword
- **THEN** 返回 HTTP 401，`{ success: false, error: "Invalid credentials" }`

#### Scenario: 新密码过短
- **WHEN** 发送 `POST /api/auth/force-change-password` 携带 `{ userId: "alice", oldPassword: "alice", newPassword: "12345" }`（少于 6 字符）
- **THEN** 返回 HTTP 400，`{ success: false, error: "Password too short" }`

#### Scenario: 用户不存在
- **WHEN** 发送 `POST /api/auth/force-change-password` 携带不存在的 userId
- **THEN** 返回 HTTP 404，`{ success: false, error: "User not found" }`

### Requirement: 管理员用户列表

系统 SHALL 提供 `GET /api/admin/users` 端点，返回所有用户列表供管理员查看。

#### Scenario: 管理员获取用户列表
- **WHEN** admin 角色用户请求 `GET /api/admin/users`
- **THEN** 返回 `{ success: true, data: [{ id, name, role, provider, createdAt, mustChangePassword }] }`

#### Scenario: 支持分页
- **WHEN** 请求 `GET /api/admin/users?page=1&limit=20`
- **THEN** 返回分页结果，包含 `pagination` 信息

#### Scenario: 非管理员被拒绝
- **WHEN** 非 admin 角色用户请求 `GET /api/admin/users`
- **THEN** 返回 HTTP 403

### Requirement: 强制改密页面

系统 SHALL 提供 `/force-change-password` SSR 页面，包含 userId、旧密码、新密码输入框。

#### Scenario: 页面渲染
- **WHEN** 访问 `GET /force-change-password`
- **THEN** 返回包含三个输入框和提交按钮的 HTML 页面

#### Scenario: 提交后成功
- **WHEN** 用户填写信息并提交成功
- **THEN** 设置登录 cookie，跳转到首页

### Requirement: Admin Panel 用户管理界面

Admin Panel SHALL 提供用户管理页面，显示用户列表并支持一键重置密码操作。

#### Scenario: 用户列表展示
- **WHEN** 管理员进入用户管理页面
- **THEN** 显示所有用户的列表（用户名、角色、注册时间、是否待改密）

#### Scenario: 一键重置密码
- **WHEN** 管理员点击某用户的"重置密码"按钮
- **THEN** 弹出确认弹窗，确认后调用 `POST /api/admin/reset-password`，成功后显示提示"密码已重置为用户名"

#### Scenario: 操作失败提示
- **WHEN** 重置密码请求返回错误
- **THEN** 显示具体错误信息
