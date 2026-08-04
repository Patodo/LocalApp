## MODIFIED Requirements

### Requirement: 创建 Schema

`POST /api/schemas` SHALL 创建新的数据 Schema。响应中 SHALL 包含 `endpoints` 字段，提供基于 serve 路径的完整 CRUD URL。

#### Scenario: 成功创建 Schema
- **WHEN** 发送 `POST /api/schemas` 携带 `{ pageId: "abc", name: "todos", fields: { ... } }` 和有效 API Key
- **THEN** 返回 `{ success: true, data: { name, fields, createdAt, updatedAt, endpoints: { list: "/serve/{userId}/abc/api/todos", create: "/serve/{userId}/abc/api/todos", ... } } }`

（其余 Scenario 不变：Schema 名称重复、Schema 名称不合法、页面不存在）

（其余 Requirement 不变：更新 Schema、删除 Schema、列出 Schemas）
