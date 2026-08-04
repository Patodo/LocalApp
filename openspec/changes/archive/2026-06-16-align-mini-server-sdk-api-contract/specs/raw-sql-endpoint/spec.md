## ADDED Requirements

### Requirement: raw SQL endpoint 在 dev/prod 均可用

`POST /api/db/exec` SHALL 在开发态 mini-server 和生产态 serve 中保持一致的请求与响应契约。端点 SHALL 支持参数化 SQL，返回查询结果或写入结果，并遵守 `manifest.db.sqlAccess`。

#### Scenario: dev 执行查询
- **WHEN** dev 应用调用 `useExec().exec("SELECT * FROM tasks WHERE status = ?", ["open"])`
- **THEN** mini-server SHALL 返回 `{ success: true, data: { columns, rows } }`

#### Scenario: prod 执行查询
- **WHEN** 生产应用调用同样的 `useExec()` 查询
- **THEN** 生产 serve SHALL 返回同构响应

#### Scenario: SQL 权限一致
- **WHEN** 当前 visitor 不满足 `sqlAccess`
- **THEN** dev 和 prod SHALL 均返回 401 或 403
- **AND** 不得执行 SQL

#### Scenario: 危险 SQL 被拒绝
- **WHEN** SQL 试图破坏 CRUD 管理表或越过允许边界
- **THEN** dev 和 prod SHALL 均返回 400
- **AND** 数据库 SHALL 保持未被破坏
