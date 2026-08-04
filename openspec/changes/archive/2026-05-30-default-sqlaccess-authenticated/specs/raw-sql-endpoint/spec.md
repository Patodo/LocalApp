## MODIFIED Requirements

### Requirement: Raw SQL 执行端点

系统 SHALL 提供 `POST /serve/{userId}/{pageName}/api/db/exec` 端点，允许前端执行 SQL 语句（包括 DDL 和 DML）。该端点 MUST 受 meta.json 的 `db.sqlAccess` 管控（不再受 `db.mode` 限制）。CRUD 模式和 SQL 模式均 SHALL 允许执行 raw SQL。请求 body MUST 包含 `sql` 字符串和可选的 `params` 数组用于参数化绑定。CRUD 模式下，系统 MUST 阻止 DROP TABLE 语句删除由 CRUD 基础设施管理的表（即出现在 `_schemas` 中的表）。

当 sqlAccess 未配置时，服务器 SHALL 默认为 `"authenticated"`（已登录用户可执行 SQL），而非 `"owner"`。

#### Scenario: 默认 sqlAccess 允许已登录用户

- **WHEN** manifest.json 中 `db.sqlAccess` 为 `null` 或未设置，且请求者已登录（有 visitorId）
- **THEN** 请求被允许执行 SQL

#### Scenario: sqlAccess 检查拒绝
- **WHEN** meta.db.sqlAccess 为 `"owner"` 且 visitorId 不等于 ownerId
- **THEN** 返回 HTTP 403，error 包含配置指引
