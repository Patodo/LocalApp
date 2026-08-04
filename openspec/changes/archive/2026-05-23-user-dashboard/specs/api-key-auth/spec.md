## MODIFIED Requirements

### Requirement: API Key 管理接口

SHALL 提供管理 API Key 的接口（需已有有效的管理 Key 才能调用）。

#### Scenario: 创建新 API Key
- **WHEN** 发送 `POST /api/keys` 携带 `{ userId: "new-user" }` 和有效的管理 Key
- **THEN** 生成随机 API Key，存入 meta.sqlite，返回 `{ success: true, data: { key: "generated-key", userId: "new-user" } }`

#### Scenario: 列出 API Keys
- **WHEN** 发送 `GET /api/keys` 携带有效的管理 Key
- **THEN** 返回当前用户关联的所有 API Key 列表，每个条目包含完整 `key` 字符串和 `createdAt`

#### Scenario: Session 认证列出 API Keys
- **WHEN** 发送 `GET /api/keys` 携带有效的 session cookie（无 X-API-Key header）
- **THEN** 返回当前登录用户关联的所有 API Key 列表，每个条目包含完整 `key` 字符串和 `createdAt`

#### Scenario: Session 认证创建 API Key
- **WHEN** 发送 `POST /api/keys` 携带有效的 session cookie 且 body 中无 userId 字段
- **THEN** 为当前登录用户创建 API Key，返回 `{ success: true, data: { key: "generated-key", userId: "当前用户ID" } }`
