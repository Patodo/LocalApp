## ADDED Requirements

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

## REMOVED Requirements

### Requirement: 用户注册

**Reason**: 编译进公开 CLI 的共享 registration key 无法作为安全边界，自动注册会向任何获得客户端的人授予用户创建能力。

**Migration**: 管理员通过用户管理界面供应账号、随机临时密码和初始 API Key；旧 CLI 接收 HTTP 410 后提示改用管理员签发的 API Key。

## MODIFIED Requirements

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
