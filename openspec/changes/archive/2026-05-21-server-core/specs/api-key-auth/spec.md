## ADDED Requirements

### Requirement: API Key 验证

所有管理接口 MUST 要求请求携带 `X-API-Key` header。服务器 SHALL 从 `meta.sqlite` 的 `api_keys` 表查询 key 对应的 userId。

#### Scenario: 有效 API Key 请求
- **WHEN** 请求携带 `X-API-Key: valid-key-123` 且该 key 存在于 meta.sqlite
- **THEN** 请求通过验证，后续处理中可获取对应的 userId

#### Scenario: 缺少 API Key
- **WHEN** 请求未携带 `X-API-Key` header
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "API key required" }`

#### Scenario: 无效 API Key
- **WHEN** 请求携带 `X-API-Key: invalid-key` 且该 key 不存在于 meta.sqlite
- **THEN** 返回 HTTP 401，响应体包含 `{ success: false, error: "Invalid API key" }`

### Requirement: API Key 存储初始化

服务器启动时 MUST 确保 `meta.sqlite` 和 `api_keys` 表存在。若不存在 SHALL 自动创建。

#### Scenario: 首次启动
- **WHEN** `meta.sqlite` 文件不存在
- **THEN** 创建文件并初始化 `api_keys` 表，服务器正常启动

#### Scenario: 已有数据库
- **WHEN** `meta.sqlite` 已存在且表结构正确
- **THEN** 直接使用，不重新创建

### Requirement: API Key 管理接口

提供管理 API Key 的接口（需已有有效的管理 Key 才能调用）。

#### Scenario: 创建新 API Key
- **WHEN** 发送 `POST /api/keys` 携带 `{ userId: "new-user" }` 和有效的管理 Key
- **THEN** 生成随机 API Key，存入 meta.sqlite，返回 `{ success: true, data: { key: "generated-key", userId: "new-user" } }`

#### Scenario: 列出 API Keys
- **WHEN** 发送 `GET /api/keys` 携带有效的管理 Key
- **THEN** 返回当前用户关联的所有 API Key 列表（不包含 key 本身的完整值，仅前 8 位 + 掩码）
