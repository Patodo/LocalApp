## MODIFIED Requirements

### Requirement: 用户注册

系统 SHALL 提供 `POST /api/auth/register` 接口，接受 `username` 和 `password`，创建用户账号。注册行为 SHALL 受 `allow_register` 配置项和 `X-Registration-Key` 头共同控制：
- 无 `X-Registration-Key` 头时，SHALL 检查 `allow_register` 配置，为 `false` 时返回 403
- 携带 `X-Registration-Key` 头时，SHALL 验证 key 匹配 `registration_key` 配置，且 `username` 匹配 `auto_register_pattern` 正则
- 通过 registration_key 注册时，SHALL 使用固定密码 `localapp` 替代请求中的 password，设置 `must_change_password=1`，并为新用户生成 API Key 一并返回

#### Scenario: 成功注册（浏览器，allow_register=true）
- **WHEN** 发送 `POST /api/auth/register` 携带 `{ username: "alice", password: "pass123" }`，无 `X-Registration-Key` 头，且 `allow_register` 为 `true`
- **THEN** 在 meta.sqlite 的 `users` 表创建记录，返回 `{ success: true, data: { id: "alice", name: "alice", role: "user" } }`

#### Scenario: 注册被拒（allow_register=false，无 registration key）
- **WHEN** 发送 `POST /api/auth/register`，无 `X-Registration-Key` 头，且 `allow_register` 为 `false`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Registration disabled" }`

#### Scenario: CLI 静默注册成功
- **WHEN** 发送 `POST /api/auth/register` 携带 `X-Registration-Key: <valid-key>`、`{ username: "zhangsan", password: "localapp" }`，且 username 匹配 `auto_register_pattern`
- **THEN** 创建用户（密码 `localapp`，`must_change_password=1`），生成 API Key，返回 `{ success: true, data: { id: "zhangsan", name: "zhangsan", role: "user", apiKey: "generated-key" } }`

#### Scenario: CLI 注册 — registration_key 无效
- **WHEN** 发送 `POST /api/auth/register` 携带 `X-Registration-Key: wrong-key`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Invalid registration key" }`

#### Scenario: CLI 注册 — 用户名不匹配 pattern
- **WHEN** 发送 `POST /api/auth/register` 携带 `X-Registration-Key: <valid-key>`、`{ username: "INVALID" }`，且 username 不匹配 `auto_register_pattern`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Username not allowed" }`

#### Scenario: CLI 注册 — 用户已存在
- **WHEN** 发送 `POST /api/auth/register` 携带 `X-Registration-Key: <valid-key>`、`{ username: "existing" }`，且用户已存在
- **THEN** 返回 HTTP 409，`{ success: false, error: "Username already exists" }`

#### Scenario: 用户名格式不合法
- **WHEN** 发送 `POST /api/auth/register` 携带的 username 不匹配 `^[a-zA-Z0-9_-]{2,32}$`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid username format" }`

#### Scenario: 密码过短（仅浏览器注册）
- **WHEN** 发送 `POST /api/auth/register`（无 registration key）携带的 password 少于 6 个字符
- **THEN** 返回 HTTP 400，`{ success: false, error: "Password too short" }`

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

### Requirement: OAuth 扩展预留

`users` 表 SHALL 包含 `provider` 字段，默认值 `'local'`。系统 SHALL 支持同一 `id` 下不同 `provider` 的组合唯一。本期仅实现 `local` provider。`provider` 字段 SHALL NOT 用于权限判断或登录过滤。

#### Scenario: 注册时 provider 默认值
- **WHEN** 通过 `POST /api/auth/register` 注册用户
- **THEN** `provider` 字段自动设为 `'local'`

#### Scenario: 所有用户均可密码登录
- **WHEN** 任何 `provider='local'` 的用户通过 `POST /api/auth/login` 登录
- **THEN** 登录流程不检查 `provider` 字段，仅验证用户名和密码

### Requirement: 用户数据初始化

服务器启动时 MUST 确保 `users` 表存在于 meta.sqlite 中。若配置了 `bootstrap_api_key`，SHALL 确保 admin 用户存在：若不存在则创建，若已存在则确保 role 为 admin。Admin 用户 SHALL 使用 `provider='local'`、`password` 为 `admin_default_password` 配置值的 bcrypt 哈希、`must_change_password=1`。若 admin 用户已存在且已有密码，SHALL NOT 覆盖密码。

#### Scenario: 首次启动 — 创建 admin
- **WHEN** 配置了 `bootstrap_api_key`，且 admin 用户不存在
- **THEN** 创建 admin 用户（`provider='local'`，密码为 `bcrypt(admin_default_password)`，`must_change_password=1`，`role='admin'`）

#### Scenario: admin 已存在且无密码
- **WHEN** 配置了 `bootstrap_api_key`，admin 用户已存在但密码为空
- **THEN** 更新 admin 密码为 `bcrypt(admin_default_password)`，设置 `must_change_password=1`、`role='admin'`

#### Scenario: admin 已存在且有密码
- **WHEN** 配置了 `bootstrap_api_key`，admin 用户已存在且密码非空
- **THEN** 仅确保 `role='admin'`，不覆盖密码和 `must_change_password`

#### Scenario: 未配置 bootstrap_api_key
- **WHEN** 未配置 `bootstrap_api_key`
- **THEN** 不创建 admin 用户

#### Scenario: 已有表缺少 must_change_password 列
- **WHEN** `users` 表已存在但缺少 `must_change_password` 列
- **THEN** 通过 `ALTER TABLE` 添加 `must_change_password INTEGER NOT NULL DEFAULT 0` 列

## ADDED Requirements

### Requirement: Admin 管理操作不再限制 provider

Admin 路由（重置密码等）和 Profile 路由（修改密码等）SHALL NOT 基于 `provider` 字段拒绝操作。所有用户（无论 provider 值）SHALL 可被 admin 管理和自行修改密码。

#### Scenario: Admin 重置 system provider 用户的密码
- **WHEN** Admin 通过 `POST /api/admin/users/:id/reset-password` 重置一个 `provider='local'`（原 system）用户的密码
- **THEN** 操作正常执行，不检查 provider 字段

#### Scenario: 用户自行修改密码
- **WHEN** 任何已登录用户通过 `PUT /api/me/password` 修改自己的密码
- **THEN** 操作正常执行，不检查 provider 字段
