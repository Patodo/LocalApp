## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the user-profile-api capability in LocalApp.

## Requirements

### Requirement: 修改个人资料

系统 SHALL 提供 `PUT /api/me/profile` 端点，允许已登录用户修改昵称和简介。该端点 MUST 要求 session cookie 认证。

#### Scenario: 成功修改昵称和简介
- **WHEN** 已登录用户发送 `PUT /api/me/profile` 携带 `{ displayName: "张三", bio: "全栈开发者" }`
- **THEN** 更新 `users` 表的 `display_name` 和 `bio` 字段，返回 `{ success: true, data: { displayName: "张三", bio: "全栈开发者" } }`

#### Scenario: 仅修改昵称
- **WHEN** 已登录用户发送 `PUT /api/me/profile` 携带 `{ displayName: "新昵称" }`
- **THEN** 仅更新 `display_name`，其他字段不变，返回 `{ success: true, data: { ... } }`

#### Scenario: 昵称长度不合法
- **WHEN** 已登录用户发送 `PUT /api/me/profile` 携带 `displayName` 长度不在 1-32 范围内
- **THEN** 返回 HTTP 400，`{ success: false, error: "Display name must be 1-32 characters" }`

#### Scenario: 未登录用户修改资料
- **WHEN** 未携带 session cookie 请求 `PUT /api/me/profile`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`

#### Scenario: API Key 认证不允许修改资料
- **WHEN** 仅携带 `X-API-Key` header 请求 `PUT /api/me/profile`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Session authentication required" }`

### Requirement: 修改密码

系统 SHALL 提供 `PUT /api/me/password` 端点，允许已登录用户修改密码。该端点 MUST 要求 session cookie 认证。

#### Scenario: 成功修改密码
- **WHEN** 已登录用户发送 `PUT /api/me/password` 携带 `{ oldPassword: "old123", newPassword: "new456" }`，且旧密码正确
- **THEN** 使用 bcrypt 哈希新密码并更新 `users` 表，返回 `{ success: true }`

#### Scenario: 旧密码错误
- **WHEN** 已登录用户发送 `PUT /api/me/password` 携带错误的 `oldPassword`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Incorrect current password" }`

#### Scenario: 新密码过短
- **WHEN** 已登录用户发送 `PUT /api/me/password` 携带 `newPassword` 少于 6 个字符
- **THEN** 返回 HTTP 400，`{ success: false, error: "New password must be at least 6 characters" }`

#### Scenario: OAuth 用户修改密码
- **WHEN** provider 为 `system` 的用户请求 `PUT /api/me/password`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Password change not available for this account type" }`

#### Scenario: 未登录用户修改密码
- **WHEN** 未携带 session cookie 请求 `PUT /api/me/password`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`

### Requirement: 上传头像

系统 SHALL 提供 `POST /api/me/avatar` 端点，允许已登录用户上传头像图片。该端点 MUST 要求 session cookie 认证，接受 multipart/form-data。

#### Scenario: 成功上传头像
- **WHEN** 已登录用户上传一张有效的 JPG/PNG/WebP 图片（≤2MB）
- **THEN** 删除旧头像文件（如有），将新头像存入 `{DATA_DIR}/avatars/{userId}.{ext}`，更新 `users.avatar_url`，返回 `{ success: true, data: { avatarUrl: "/api/me/avatar" } }`

#### Scenario: 文件过大
- **WHEN** 已登录用户上传超过 2MB 的图片
- **THEN** 返回 HTTP 413，`{ success: false, error: "Avatar must be smaller than 2MB" }`

#### Scenario: 格式不支持
- **WHEN** 已登录用户上传非 JPG/PNG/WebP 格式的文件
- **THEN** 返回 HTTP 400，`{ success: false, error: "Avatar must be JPG, PNG, or WebP" }`

#### Scenario: 未上传文件
- **WHEN** 请求中不包含 `avatar` 字段
- **THEN** 返回 HTTP 400，`{ success: false, error: "No avatar file provided" }`

#### Scenario: 替换旧头像
- **WHEN** 用户已有头像 `avatars/alice.jpg`，上传新 PNG 头像
- **THEN** 删除 `avatars/alice.jpg`，保存 `avatars/alice.png`，更新 `avatar_url`

### Requirement: 获取头像

系统 SHALL 提供 `GET /api/me/avatar` 端点，返回当前用户的头像文件。

#### Scenario: 用户有头像
- **WHEN** 已登录用户请求 `GET /api/me/avatar`，且 `users.avatar_url` 非空
- **THEN** 返回对应图片文件，设置正确的 Content-Type

#### Scenario: 用户无头像
- **WHEN** 已登录用户请求 `GET /api/me/avatar`，且 `users.avatar_url` 为空
- **THEN** 返回 HTTP 404，`{ success: false, error: "No avatar" }`

#### Scenario: 任意用户头像公开访问
- **WHEN** 请求 `GET /api/avatar/{userId}` 路径
- **THEN** 无需认证，返回对应用户的头像文件

### Requirement: 数据库 Migration

系统启动时 SHALL 检测 `users` 表是否包含 `display_name`、`avatar_url`、`bio` 列，缺失时自动添加。

#### Scenario: 首次启动（旧数据库）
- **WHEN** `users` 表不存在 `display_name` 列
- **THEN** 执行 `ALTER TABLE users ADD COLUMN display_name TEXT`，同理处理 `avatar_url` 和 `bio`

#### Scenario: 已有新列
- **WHEN** `users` 表已包含这三个列
- **THEN** 不执行任何 ALTER 操作
