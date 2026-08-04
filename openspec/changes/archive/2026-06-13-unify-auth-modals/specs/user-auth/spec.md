## MODIFIED Requirements

### Requirement: 用户注册

系统 SHALL 提供 `POST /api/auth/register` 接口，仅支持 CLI 注册模式（需携带 `X-Registration-Key` 头）。浏览器端注册入口 SHALL 被移除。

- 携带 `X-Registration-Key` 头时，SHALL 验证 key 匹配 `registration_key` 配置，且 `username` 匹配 `auto_register_pattern` 正则
- 通过 registration_key 注册时，SHALL 使用固定密码 `localapp` 替代请求中的 password，设置 `must_change_password=1`，并为新用户生成 API Key 一并返回
- 无 `X-Registration-Key` 头时，SHALL 返回 403（无论 `allow_register` 配置值）

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

#### Scenario: 浏览器注册始终被拒
- **WHEN** 发送 `POST /api/auth/register` 不携带 `X-Registration-Key` 头
- **THEN** 返回 HTTP 403，`{ success: false, error: "Registration disabled" }`

## REMOVED Requirements

### Requirement: 浏览器端注册页面和入口
**Reason**: 注册功能不再对浏览器端开放，统一由 CLI 或管理员创建用户
**Migration**: 浏览器端用户无法自行注册，需通过 CLI (`localapp login`) 或管理员在 admin 面板创建

### Requirement: 浏览器端注册成功场景
**Reason**: 浏览器端注册入口已完全移除，`allow_register` 配置不再控制前端行为
**Migration**: 无需迁移，浏览器注册功能不再存在
