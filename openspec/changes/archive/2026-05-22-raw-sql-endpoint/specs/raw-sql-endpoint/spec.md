## ADDED Requirements

### Requirement: Raw SQL 执行端点

系统 SHALL 提供 `POST /serve/{userId}/{pageName}/api/db/exec` 端点，允许前端执行任意 SQL 语句（包括 DDL 和 DML）。该端点 MUST 受 meta.json 的 `db.mode` 和 `db.sqlAccess` 管控。请求 body MUST 包含 `sql` 字符串和可选的 `params` 数组用于参数化绑定。

#### Scenario: 执行 SELECT 查询

- **WHEN** POST 请求 `/serve/alice/my-app/api/db/exec` 且 meta.db.mode 为 `sql` 且 sqlAccess 为 `public`，body 为 `{ "sql": "SELECT * FROM todos WHERE status = ?", "params": ["done"] }`
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

#### Scenario: mode 为 crud 时拒绝

- **WHEN** meta.db.mode 为 `crud` 或 meta 无 `db` 字段时请求 raw SQL 端点
- **THEN** 返回 HTTP 404（端点不可用）

#### Scenario: sqlAccess 检查拒绝

- **WHEN** meta.db.sqlAccess 为 `owner` 且 visitorId 不等于 ownerId
- **THEN** 返回 HTTP 403

#### Scenario: 资源不存在

- **WHEN** 请求 raw SQL 端点但 pageName 对应的页面不存在
- **THEN** 返回 HTTP 404

### Requirement: Raw SQL 长连接常驻

Raw SQL 和 CRUD 端点 SHALL 共享同一个 SQLite 连接实例。系统 MUST 使用长连接地图管理 db.sqlite 实例，避免每次请求 load/save/close。写操作后 MUST 立即持久化到磁盘。空闲超过 5 分钟的连接 MUST 自动关闭释放资源。服务关闭时 MUST 遍历保存并关闭所有连接。

#### Scenario: 多次请求复用连接

- **WHEN** 对同一个 pageName 连续发送多次 raw SQL 请求
- **THEN** 底层使用同一个 SQLite 实例，不重复 load/save

#### Scenario: 写操作后持久化

- **WHEN** raw SQL 执行 INSERT/UPDATE/DELETE/DDL 后
- **THEN** 数据库变更立即写入磁盘文件

#### Scenario: 空闲连接自动关闭

- **WHEN** 某个页面的连接超过 5 分钟未被使用且无未持久化的写操作
- **THEN** 该连接被关闭释放

#### Scenario: 服务关闭时保存所有连接

- **WHEN** 服务器进程退出
- **THEN** 所有已打开且有未持久化变更的连接先保存再关闭

### Requirement: 路由解析特殊分支

`handleCrudRequest` MUST 在 CRUD 分发之前检查 `parts[0] === "db" && parts[1] === "exec"`，将请求路由到 raw SQL 处理器，避免被当作 `api/{resource}/{id}` 解析。

#### Scenario: api/db/exec 路由正确

- **WHEN** 请求路径为 `/serve/alice/my-app/api/db/exec`
- **THEN** 不返回 400 "Invalid id"，正确路由到 raw SQL 处理器

### Requirement: 多语句 SQL 限制

使用 params 数组时，raw SQL 端点 SHALL 不支持分号分隔的多语句 SQL（sql.js 限制）。前端 MUST 拆分为多次单语句调用。

#### Scenario: 多语句 SQL 被拒绝或报错

- **WHEN** POST body 为 `{ "sql": "SELECT 1; SELECT 2", "params": [] }`
- **THEN** 服务端返回错误（sql.js 限制）
