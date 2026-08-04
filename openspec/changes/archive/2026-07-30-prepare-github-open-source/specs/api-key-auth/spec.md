## MODIFIED Requirements

### Requirement: API Key 验证

所有管理接口 MUST 要求请求携带 `X-API-Key` header。服务器 SHALL 使用 `meta.sqlite` 中保存的摘要验证新签发 Key，并 SHALL 在迁移期兼容匹配升级前已存在的明文 Key。验证通过后 SHALL 获取对应 userId 并执行 CLI 版本校验。API Key 认证与 session cookie 认证 SHALL 并行存在。

#### Scenario: 有效摘要 API Key 请求
- **WHEN** 请求携带新签发的有效 API Key
- **THEN** Server 对候选值计算摘要并匹配对应 userId
- **AND** 请求通过验证

#### Scenario: 升级前的有效明文 API Key
- **WHEN** 数据库包含升级前的明文 API Key 且请求携带该 Key
- **THEN** 请求在兼容路径通过验证

#### Scenario: 缺少 API Key
- **WHEN** 请求未携带 `X-API-Key` header
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "API key required" }`

#### Scenario: 无效 API Key
- **WHEN** 请求携带无法匹配明文或摘要记录的 API Key
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "Invalid API key" }`

### Requirement: API Key 管理接口

系统 SHALL 提供需认证的 API Key 管理接口。`POST /api/keys` MUST 只在创建响应中返回完整 Key，并以摘要存储；`GET /api/keys` MUST 只返回掩码标识和创建时间，不得恢复或返回完整 Key。

#### Scenario: 创建新 API Key
- **WHEN** 已认证用户发送 `POST /api/keys`
- **THEN** 生成随机 API Key，以摘要存入 meta.sqlite
- **AND** 仅本次响应返回完整 Key 与 userId

#### Scenario: 列出 API Keys
- **WHEN** 已认证用户发送 `GET /api/keys`
- **THEN** 返回当前用户的 Key 掩码和 `createdAt`
- **AND** 响应不包含任一完整 Key

#### Scenario: Session 认证创建 API Key
- **WHEN** 携带有效 session cookie 发送 `POST /api/keys` 且 body 中无 userId
- **THEN** 为当前用户创建摘要存储的 Key
- **AND** 仅本次响应返回完整 Key

### Requirement: 注册时生成 API Key

系统不再通过公开或 CLI 自动注册生成 API Key。管理员供应用户时 SHALL 原子生成初始 API Key，以摘要存储并只在供应成功响应中返回一次明文。

#### Scenario: 管理员供应返回初始 API Key
- **WHEN** 管理员成功创建用户
- **THEN** 响应包含一次性初始 API Key
- **AND** 数据库只保存该 Key 的摘要

#### Scenario: 客户端自动注册不生成 API Key
- **WHEN** 客户端请求已移除的 CLI 自动注册接口
- **THEN** 返回 HTTP 410
- **AND** 不创建 API Key
