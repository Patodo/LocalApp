## ADDED Requirements

### Requirement: 用户注册

系统 SHALL 提供 `POST /api/auth/register` 接口，接受 `username` 和 `password`，创建用户账号。

#### Scenario: 成功注册
- **WHEN** 发送 `POST /api/auth/register` 携带 `{ username: "alice", password: "pass123" }`
- **THEN** 在 meta.sqlite 的 `users` 表创建记录，返回 `{ success: true, data: { id: "alice", name: "alice" } }`

#### Scenario: 用户名已存在
- **WHEN** 发送 `POST /api/auth/register` 携带已存在的 username
- **THEN** 返回 HTTP 409，`{ success: false, error: "Username already exists" }`

#### Scenario: 用户名格式不合法
- **WHEN** 发送 `POST /api/auth/register` 携带的 username 不匹配 `^[a-zA-Z0-9_-]{2,32}$`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid username format" }`

#### Scenario: 密码过短
- **WHEN** 发送 `POST /api/auth/register` 携带的 password 少于 6 个字符
- **THEN** 返回 HTTP 400，`{ success: false, error: "Password too short" }`

### Requirement: 用户登录

系统 SHALL 提供 `POST /api/auth/login` 接口，验证用户名密码后签发 JWT，设置 HttpOnly cookie。

#### Scenario: 登录成功
- **WHEN** 发送 `POST /api/auth/login` 携带 `{ username: "alice", password: "pass123" }` 且凭据正确
- **THEN** 返回 `{ success: true, data: { id: "alice", name: "alice" } }`，设置 HttpOnly cookie `token` 包含 JWT

#### Scenario: 用户名不存在
- **WHEN** 发送 `POST /api/auth/login` 携带不存在的 username
- **THEN** 返回 HTTP 401，`{ success: false, error: "Invalid credentials" }`

#### Scenario: 密码错误
- **WHEN** 发送 `POST /api/auth/login` 携带错误密码
- **THEN** 返回 HTTP 401，`{ success: false, error: "Invalid credentials" }`

### Requirement: 用户登出

系统 SHALL 提供 `POST /api/auth/logout` 接口，清除 session cookie。

#### Scenario: 登出成功
- **WHEN** 发送 `POST /api/auth/logout`
- **THEN** 清除 `token` cookie，返回 `{ success: true }`

### Requirement: 访客身份查询

系统 SHALL 提供 `GET /api/me` 接口，返回当前请求的访客身份。该接口 MUST 同时支持 cookie 认证和 API Key 认证。

#### Scenario: 已登录用户查询身份（cookie）
- **WHEN** 携带有效 JWT cookie 请求 `GET /api/me`
- **THEN** 返回 `{ success: true, data: { id: "alice", name: "alice" } }`

#### Scenario: 已登录用户查询身份（API Key）
- **WHEN** 携带有效 `X-API-Key` header 请求 `GET /api/me`
- **THEN** 返回 `{ success: true, data: { id: "alice", name: "alice" } }`（id 为 API Key 对应的 userId）

#### Scenario: 未登录用户查询身份
- **WHEN** 不携带任何凭证请求 `GET /api/me`
- **THEN** 返回 `{ success: true, data: null }`

### Requirement: Session Cookie 属性

JWT cookie MUST 设置以下属性：`HttpOnly`、`SameSite=Lax`、`Path=/`。过期时间 SHALL 由 JWT `exp` claim 控制，默认 7 天。JWT 签名密钥 SHALL 从 `JWT_SECRET` 环境变量读取。

#### Scenario: Cookie 属性验证
- **WHEN** 用户登录成功
- **THEN** 响应的 `Set-Cookie` header 包含 `token=<jwt>; HttpOnly; SameSite=Lax; Path=/`

#### Scenario: JWT 过期
- **WHEN** 请求携带已过期的 JWT cookie
- **THEN** 不设置 `req.visitorId`，视同未登录

### Requirement: 密码安全存储

用户密码 MUST 使用 bcrypt 哈希后存储，禁止明文存储。

#### Scenario: 注册时密码哈希
- **WHEN** 用户注册成功
- **THEN** `users` 表中存储的是 bcrypt 哈希值，非明文密码

### Requirement: OAuth 扩展预留

`users` 表 SHALL 包含 `provider` 字段，默认值 `'local'`。系统 SHALL 支持同一 `id` 下不同 `provider` 的组合唯一。本期仅实现 `local` provider。

#### Scenario: 注册时 provider 默认值
- **WHEN** 通过 `POST /api/auth/register` 注册用户
- **THEN** `provider` 字段自动设为 `'local'`

### Requirement: 用户数据初始化

服务器启动时 MUST 确保 `users` 表存在于 meta.sqlite 中。若不存在 SHALL 自动创建。

#### Scenario: 首次启动
- **WHEN** meta.sqlite 中不存在 `users` 表
- **THEN** 创建 `users` 表，服务器正常启动

#### Scenario: 已有表
- **WHEN** `users` 表已存在
- **THEN** 直接使用，不重新创建
