## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the password-reset capability in LocalApp.

## Requirements

### Requirement: 管理员重置用户密码

系统 SHALL 提供 `POST /api/admin/reset-password` 端点，仅限 admin 角色调用，接收 `userId`，使用密码学安全随机源生成至少 128 bit 熵的临时密码，以 bcrypt 哈希写入并设置 `must_change_password=1`。明文临时密码 SHALL 只在本次成功响应中返回。

#### Scenario: 管理员成功重置密码
- **WHEN** admin 角色用户发送 `POST /api/admin/reset-password` 携带 `{ userId: "alice" }`
- **THEN** 将 alice 的密码设为随机临时密码的 bcrypt 哈希并设置 `must_change_password=1`
- **AND** 返回 `{ success: true, data: { temporaryPassword, mustChangePassword: true } }`
- **AND** 不修改 alice 已有的 API Key

#### Scenario: 非管理员被拒绝
- **WHEN** 非 admin 角色用户发送 `POST /api/admin/reset-password`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Admin access required" }`

#### Scenario: 未认证被拒绝
- **WHEN** 未携带任何凭证发送 `POST /api/admin/reset-password`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`

#### Scenario: 用户不存在
- **WHEN** 发送 `POST /api/admin/reset-password` 携带不存在的 userId
- **THEN** 返回 HTTP 404，`{ success: false, error: "User not found" }`

#### Scenario: 系统保护账户允许安全重置
- **WHEN** admin 重置系统保护账户的密码且未违反当前管理员保护约束
- **THEN** 使用随机临时密码完成重置
- **AND** 不因用户的历史 provider 值拒绝操作

### Requirement: 强制改密

系统 SHALL 提供 `POST /api/auth/force-change-password` 端点（公开），接受 `userId`、`oldPassword`、`newPassword`，验证旧密码后更新新密码并清除 must_change_password 标记。该端点 SHALL 由 ChangePasswordDialog（force 模式）模态框调用，不再由独立页面调用。

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

### Requirement: Admin Panel 用户管理界面

Admin Panel SHALL 提供用户管理页面，显示用户列表并支持重置密码与添加用户。添加用户和重置密码成功后 SHALL 显示一次性凭据对话框，不得显示或依赖固定默认密码。

#### Scenario: 用户列表展示
- **WHEN** 管理员进入用户管理页面
- **THEN** 显示所有用户的列表（用户名、角色、注册时间、是否待改密）

#### Scenario: 一键重置密码
- **WHEN** 管理员确认重置某用户密码
- **THEN** 调用 `POST /api/admin/reset-password`
- **AND** 成功后显示仅包含本次随机临时密码的一次性凭据对话框

#### Scenario: 添加用户
- **WHEN** 管理员点击"添加用户"并提交合法用户名
- **THEN** 调用 `POST /api/admin/users` 携带 `{ username }`
- **AND** 创建成功后刷新列表并显示临时密码和初始 API Key

#### Scenario: 添加用户 — 用户名已存在
- **WHEN** 管理员输入已存在的用户名
- **THEN** 显示"用户名已存在"错误提示

#### Scenario: 操作失败提示
- **WHEN** 重置密码或添加用户请求返回错误
- **THEN** 显示具体错误信息且不展示伪造凭据
