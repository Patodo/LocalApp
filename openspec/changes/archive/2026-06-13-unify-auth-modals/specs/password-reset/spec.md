## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: 强制改密页面
**Reason**: 强制改密功能由全局 ChangePasswordDialog 模态框替代，不再需要独立页面
**Migration**: 登录时检测到 `MUST_CHANGE_PASSWORD` 错误码后，自动弹出 ChangePasswordDialog（force 模式），不再跳转到 `/force-change-password` 页面

### Requirement: Admin Panel 用户管理界面

Admin Panel SHALL 提供用户管理页面，显示用户列表并支持一键重置密码操作。页面 SHALL 新增"添加用户"按钮，点击后弹出输入框要求输入用户名，提交后调用 `POST /api/admin/users` 创建用户。

#### Scenario: 用户列表展示
- **WHEN** 管理员进入用户管理页面
- **THEN** 显示所有用户的列表（用户名、角色、注册时间、是否待改密）

#### Scenario: 一键重置密码
- **WHEN** 管理员点击某用户的"重置密码"按钮
- **THEN** 弹出确认弹窗，确认后调用 `POST /api/admin/reset-password`，成功后显示提示"密码已重置为用户名"

#### Scenario: 添加用户
- **WHEN** 管理员点击"添加用户"按钮并输入用户名提交
- **THEN** 调用 `POST /api/admin/users` 携带 `{ username }`
- **THEN** 创建成功后用户列表刷新，显示新用户（状态为"待改密"）

#### Scenario: 添加用户 — 用户名已存在
- **WHEN** 管理员输入已存在的用户名
- **THEN** 显示"用户名已存在"错误提示

#### Scenario: 操作失败提示
- **WHEN** 重置密码或添加用户请求返回错误
- **THEN** 显示具体错误信息
