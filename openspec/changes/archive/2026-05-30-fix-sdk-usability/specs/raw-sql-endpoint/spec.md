## MODIFIED Requirements

### Requirement: Raw SQL 执行端点

系统 SHALL 提供 `POST /serve/{userId}/{pageName}/api/db/exec` 端点，允许前端执行 SQL 语句（包括 DDL 和 DML）。该端点 MUST 受 meta.json 的 `db.sqlAccess` 管控（不再受 `db.mode` 限制）。CRUD 模式和 SQL 模式均 SHALL 允许执行 raw SQL。请求 body MUST 包含 `sql` 字符串和可选的 `params` 数组用于参数化绑定。CRUD 模式下，系统 MUST 阻止 DROP TABLE 语句删除由 CRUD 基础设施管理的表（即出现在 `_schemas` 中的表）。

#### Scenario: 执行 SELECT 查询

- **WHEN** POST 请求 `/serve/alice/my-app/api/db/exec` 且 sqlAccess 为 `public`，body 为 `{ "sql": "SELECT * FROM todos WHERE status = ?", "params": ["done"] }`
- **THEN** 返回 `{ success: true, data: { columns: ["id", "title", "status"], rows: [...] } }`

#### Scenario: 执行 INSERT 写入

- **WHEN** POST body 为 `{ "sql": "INSERT INTO todos (title) VALUES (?)", "params": ["New"] }`
- **THEN** 返回 `{ success: true, data: { changes: 1, lastInsertRowId: 1 } }`

#### Scenario: 执行 DDL 建表

- **WHEN** POST body 为 `{ "sql": "CREATE TABLE custom_table (id INTEGER PRIMARY KEY, name TEXT)" }`
- **THEN** 返回 `{ success: true, data: {} }`

#### Scenario: 无参数查询

- **WHEN** POST body 为 `{ "sql": "SELECT * FROM todos" }`（无 params）
- **THEN** 正常执行，sql.js 不做参数绑定

#### Scenario: CRUD 模式下执行 SELECT 聚合查询

- **WHEN** meta.db.mode 为 `crud` 且 sqlAccess 允许当前用户，POST body 为 `{ "sql": "SELECT status, COUNT(*) as cnt FROM todos GROUP BY status" }`
- **THEN** 返回 `{ success: true, data: { columns: ["status", "cnt"], rows: [...] } }`，不再返回 404

#### Scenario: sqlAccess 检查拒绝

- **WHEN** meta.db.sqlAccess 为 `owner` 且 visitorId 不等于 ownerId
- **THEN** 返回 HTTP 403

#### Scenario: 资源不存在

- **WHEN** 请求 raw SQL 端点但 pageName 对应的页面不存在
- **THEN** 返回 HTTP 404

#### Scenario: CRUD 模式下 DROP TABLE 受管表被阻止

- **WHEN** meta.db.mode 为 `crud`，POST body 为 `{ "sql": "DROP TABLE todos" }`，且 `todos` 出现在 `_schemas` 中
- **THEN** 返回 HTTP 400，error 包含 "Cannot DROP CRUD-managed table" 提示

#### Scenario: CRUD 模式下 DROP TABLE 非受管表允许

- **WHEN** meta.db.mode 为 `crud`，POST body 为 `{ "sql": "DROP TABLE custom_table" }`，且 `custom_table` 不在 `_schemas` 中
- **THEN** 正常执行 DROP TABLE
