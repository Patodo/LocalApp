## Purpose

用户供应、登录、鉴权机制。管理员负责供应用户，用户通过用户名密码登录；JWT session cookie 与 API Key 认证并行服务于不同访问场景。
## Requirements
### Requirement: 公开注册保持关闭

系统 MUST NOT 提供浏览器、CLI 或其他客户端可使用共享秘密创建用户的公开注册能力。用户 SHALL 由管理员供应。

#### Scenario: 浏览器注册端点不存在
- **WHEN** 未认证客户端发送 `POST /api/auth/register`
- **THEN** 返回 HTTP 404
- **AND** 不创建用户

### Requirement: 旧 CLI 自动注册获得迁移响应

系统 SHALL 在兼容周期内为 `POST /api/auth/cli-register` 返回无副作用的 HTTP 410 响应和稳定错误码 `CLI_AUTO_REGISTRATION_REMOVED`，不得读取 `X-Registration-Key` 或写入用户数据。

#### Scenario: 旧 CLI 请求自动注册
- **WHEN** 客户端发送 `POST /api/auth/cli-register`，无论是否携带 `X-Registration-Key`
- **THEN** 返回 HTTP 410 和管理员供应 API Key 的迁移说明
- **AND** 用户与 API Key 数据保持不变

### Requirement: 用户登录

系统 SHALL 提供 `POST /api/auth/login` 接口，验证用户名密码后签发 JWT，设置 HttpOnly cookie。`findUserByName` SHALL NOT 按 `provider` 过滤，所有用户均可通过用户名密码登录。若用户 `must_change_password` 标记为 true，SHALL 拒绝登录并返回特定错误。

#### Scenario: 登录成功
- **WHEN** 发送 `POST /api/auth/login` 携带 `{ username: "alice", password: "pass123" }` 且凭据正确且 `must_change_password` 为 false
- **THEN** 返回 `{ success: true, data: { id: "alice", name: "alice", role: "user" } }`，设置 HttpOnly cookie `token` 包含 JWT

#### Scenario: 需要强制改密
- **WHEN** 发送 `POST /api/auth/login` 携带正确凭据但 `must_change_password` 为 true
- **THEN** 返回 HTTP 403，`{ success: false, error: "Password reset required", code: "MUST_CHANGE_PASSWORD" }`

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

#### Scenario: 供应用户时密码哈希
- **WHEN** 管理员成功供应用户
- **THEN** `users` 表中存储的是 bcrypt 哈希值，非明文密码

### Requirement: OAuth 扩展预留

`users` 表 SHALL 包含 `provider` 字段，默认值 `'local'`。系统 SHALL 支持同一 `id` 下不同 `provider` 的组合唯一。本期仅实现 `local` provider。`provider` 字段 SHALL NOT 用于权限判断或登录过滤。

#### Scenario: 供应用户时 provider 默认值
- **WHEN** 管理员成功供应用户且未指定 provider
- **THEN** `provider` 字段自动设为 `'local'`

#### Scenario: 所有用户均可密码登录
- **WHEN** 任何 `provider='local'` 的用户通过 `POST /api/auth/login` 登录
- **THEN** 登录流程不检查 `provider` 字段，仅验证用户名和密码

### Requirement: 空 Server 使用单次 setup 创建首位管理员

Server 启动时 MUST 确保用户 schema 存在，但用户数量为零时 SHALL 保持空状态。worker SHALL 生成短时、单次 setup token 并在 loopback readiness 中提供 setup URL；`POST /api/setup/initialize` SHALL 仅从 loopback 接受该 token、用户名和密码，并在事务中创建首位管理员。成功后 SHALL 撤销所有 setup token。

#### Scenario: 首次 setup 成功
- **WHEN** 空 Server 从 loopback 提交有效 token、合法用户名和密码
- **THEN** 创建的用户 SHALL 使用 bcrypt 密码哈希并具有 `admin` 角色
- **AND** setup token SHALL 立即失效

#### Scenario: setup token 重放
- **WHEN** 客户端再次提交已使用或过期 token
- **THEN** Server SHALL 返回 410
- **AND** SHALL NOT创建第二个用户

#### Scenario: 非 loopback setup
- **WHEN** setup 请求来自非 loopback 地址
- **THEN** Server SHALL 返回 403

#### Scenario: 已完成 setup
- **WHEN** Server 已存在至少一个用户
- **THEN** setup status SHALL 报告 `required: false`
- **AND** initialize SHALL NOT创建或修改用户

### Requirement: 用户认证支持角色
用户供应和登录流程 SHALL 感知 `role` 字段。

#### Scenario: 供应用户返回 role
- **WHEN** 管理员成功供应用户
- **THEN** 响应 `data` 包含 `role: "user"`

#### Scenario: 登录 JWT 包含 role
- **WHEN** 用户登录成功
- **THEN** JWT payload 包含 `{ id, name, role }`

#### Scenario: /api/me 返回 role
- **WHEN** 已认证用户请求 `GET /api/me`
- **THEN** 响应 `data` 包含 `role` 字段

### Requirement: Admin 管理操作不再限制 provider

Admin 路由（重置密码等）和 Profile 路由（修改密码等）SHALL NOT 基于 `provider` 字段拒绝操作。所有用户（无论 provider 值）SHALL 可被 admin 管理和自行修改密码。

#### Scenario: Admin 重置 system provider 用户的密码
- **WHEN** Admin 通过 `POST /api/admin/users/:id/reset-password` 重置一个 `provider='local'`（原 system）用户的密码
- **THEN** 操作正常执行，不检查 provider 字段

#### Scenario: 用户自行修改密码
- **WHEN** 任何已登录用户通过 `PUT /api/me/password` 修改自己的密码
- **THEN** 操作正常执行，不检查 provider 字段

### Requirement: 开发态 /api/me 使用标准响应形态

统一 Server 的 `GET /api/me` SHALL 在开发与正式部署返回同一 `{ success: true, data: User | null }` 响应形态。返回用户 SHALL 包含 SDK `User` 类型允许的字段：`id`、`name`、`role`、`displayName`、`avatarUrl`、`bio`。

#### Scenario: 默认 dev 用户
- **WHEN** dev 应用请求 `GET /api/me`
- **THEN** 项目统一 Server SHALL 返回其真实 `dev-user` 用户，Dev Toolkit 模拟身份时返回选中的 Server 用户

#### Scenario: 切换 dev 用户
- **WHEN** Dev Toolkit 将当前 dev context user 切换为 `alice`
- **THEN** 后续 `GET /api/me` SHALL 返回 `{ success: true, data: { id: "alice", name: "Alice", role: "user", ... } }`

#### Scenario: 未登录 dev 用户
- **WHEN** Dev Toolkit 将当前 dev context user 设置为 `null`
- **THEN** 后续 `GET /api/me` SHALL 返回 `{ success: true, data: null }`
- **AND** SDK `useMe()` SHALL 将 `me` 设为 `null` 且不设置错误
