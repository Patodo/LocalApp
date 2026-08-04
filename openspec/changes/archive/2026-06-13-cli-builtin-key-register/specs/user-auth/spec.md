## MODIFIED Requirements

### Requirement: 用户注册

系统 SHALL 提供 `POST /api/auth/cli-register` 接口，仅供 CLI 工具自动注册使用，不接受浏览器公开注册。该接口 SHALL：
- 要求请求携带 `X-Registration-Key` 头，且匹配服务端内置的 registration key（从共享文件 `packages/shared/.registration-key` 读取）
- 校验 `username` 匹配 `auto_register_pattern` 正则（默认 `^[a-z][a-z0-9_]*$`，可配）
- 使用固定密码 `localapp` 创建用户（忽略请求中的 password），设置 `must_change_password=1`
- 为新用户生成 API Key 一并返回

系统 SHALL NOT 提供浏览器公开注册端点 `POST /api/auth/register`。

#### Scenario: CLI 自动注册成功
- **WHEN** 发送 `POST /api/auth/cli-register` 携带 `X-Registration-Key: <built-in-key>`、`{ username: "zhangsan" }`，且 username 匹配 `auto_register_pattern`
- **THEN** 创建用户（密码 `localapp`，`must_change_password=1`），生成 API Key，返回 `{ success: true, data: { id: "zhangsan", name: "zhangsan", role: "user", apiKey: "generated-key" } }`

#### Scenario: CLI 注册 — registration key 无效
- **WHEN** 发送 `POST /api/auth/cli-register` 携带 `X-Registration-Key: wrong-key`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Invalid registration key" }`

#### Scenario: CLI 注册 — 缺少 registration key 头
- **WHEN** 发送 `POST /api/auth/cli-register` 不携带 `X-Registration-Key` 头
- **THEN** 返回 HTTP 403，`{ success: false, error: "Invalid registration key" }`

#### Scenario: CLI 注册 — 用户名不匹配 pattern
- **WHEN** 发送 `POST /api/auth/cli-register` 携带 `X-Registration-Key: <built-in-key>`、`{ username: "INVALID" }`，且 username 不匹配 `auto_register_pattern`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Username not allowed" }`

#### Scenario: CLI 注册 — 用户已存在
- **WHEN** 发送 `POST /api/auth/cli-register` 携带 `X-Registration-Key: <built-in-key>`、`{ username: "existing" }`，且用户已存在
- **THEN** 返回 HTTP 409，`{ success: false, error: "Username already exists" }`

#### Scenario: 浏览器注册端点不存在
- **WHEN** 发送 `POST /api/auth/register`（任何 payload）
- **THEN** 返回 HTTP 404

#### Scenario: 用户名格式不合法
- **WHEN** 发送 `POST /api/auth/cli-register` 携带的 username 不匹配 `^[a-zA-Z0-9_-]{2,32}$`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid username format" }`

### Requirement: OAuth 扩展预留

`users` 表 SHALL 包含 `provider` 字段，默认值 `'local'`。系统 SHALL 支持同一 `id` 下不同 `provider` 的组合唯一。本期仅实现 `local` provider。`provider` 字段 SHALL NOT 用于权限判断或登录过滤。

#### Scenario: 注册时 provider 默认值
- **WHEN** 通过 `POST /api/auth/cli-register` 注册用户
- **THEN** `provider` 字段自动设为 `'local'`

#### Scenario: 所有用户均可密码登录
- **WHEN** 任何 `provider='local'` 的用户通过 `POST /api/auth/login` 登录
- **THEN** 登录流程不检查 `provider` 字段，仅验证用户名和密码
