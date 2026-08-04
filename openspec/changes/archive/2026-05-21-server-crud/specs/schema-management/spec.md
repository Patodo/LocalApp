## ADDED Requirements

### Requirement: 创建 Schema

`POST /api/schemas` SHALL 创建新的数据 Schema，在 db.sqlite 中建立对应表，并将 schema 定义写入 meta.json 的 schemas 数组。

#### Scenario: 成功创建 Schema
- **WHEN** 发送 `POST /api/schemas` 携带 `{ pageId: "abc", name: "todos", fields: { title: { type: "string", constraints: { required: true } } } }` 和有效 API Key
- **THEN** 在 db.sqlite 中执行 `CREATE TABLE todos (...)`，meta.json 的 schemas 数组新增该项，返回 `{ success: true, data: { name, fields, createdAt, updatedAt } }`

#### Scenario: Schema 名称重复
- **WHEN** 创建的 schema 名称在该 pageId 下已存在
- **THEN** 返回 HTTP 409，`{ success: false, error: "Schema already exists" }`

#### Scenario: Schema 名称不合法
- **WHEN** schema 名称包含非 `[a-zA-Z0-9_]` 字符
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid schema name" }`

#### Scenario: 页面不存在
- **WHEN** 指定的 pageId 不存在
- **THEN** 返回 HTTP 404，`{ success: false, error: "Page not found" }`

### Requirement: 更新 Schema（增量）

`PUT /api/schemas/:name` SHALL 对比现有字段定义，对新增字段执行 `ALTER TABLE ADD COLUMN`，不删除或修改已有字段。

#### Scenario: 添加新字段
- **WHEN** 现有 schema 有 `title` 字段，更新请求包含 `title` 和 `priority`（新字段）
- **THEN** 执行 `ALTER TABLE ADD COLUMN priority`，meta.json 中 schema 的 fields 更新，返回更新后的 schema

#### Scenario: 尝试删除字段（无操作）
- **WHEN** 现有 schema 有 `title` 和 `done` 字段，更新请求只包含 `title`
- **THEN** 不删除 `done` 列（保留在表中），meta.json 中 schema 的 fields 保持包含 `done`，返回更新后的完整 schema

### Requirement: 删除 Schema

`DELETE /api/schemas/:name` SHALL 删除 schema 定义并执行 `DROP TABLE`，清除所有数据。

#### Scenario: 成功删除
- **WHEN** 发送 `DELETE /api/schemas/todos` 携带有效 API Key，schema 存在
- **THEN** 执行 `DROP TABLE todos`，从 meta.json 的 schemas 数组移除该项，返回 `{ success: true, data: { deleted: true, name: "todos" } }`

#### Scenario: Schema 不存在
- **WHEN** 删除不存在的 schema
- **THEN** 返回 HTTP 404，`{ success: false, error: "Schema not found" }`

### Requirement: 列出 Schemas

`GET /api/schemas?pageId=xxx` SHALL 返回指定页面的所有 schema 定义。

#### Scenario: 列出已有 Schemas
- **WHEN** 发送 `GET /api/schemas?pageId=abc` 携带有效 API Key
- **THEN** 返回 `{ success: true, data: [{ name, fields, createdAt, updatedAt }] }`
