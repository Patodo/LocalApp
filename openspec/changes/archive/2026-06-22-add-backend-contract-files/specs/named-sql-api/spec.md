## ADDED Requirements

### Requirement: Registered query endpoint
系统 SHALL 提供 `POST /serve/:owner/:app/api/queries/:name`，用于执行 backend 契约中注册的只读 named query。

#### Scenario: 执行已注册 query
- **WHEN** 前端调用已注册 query 并传入合法参数
- **THEN** server MUST 执行该 query 的注册 SQL 并返回 rows

#### Scenario: 调用未注册 query
- **WHEN** 前端调用不存在的 query name
- **THEN** server MUST 返回 404 且不得执行任何 SQL

### Requirement: Registered mutation endpoint
系统 SHALL 提供 `POST /serve/:owner/:app/api/mutations/:name`，用于执行 backend 契约中注册的写入 named mutation。

#### Scenario: 执行已注册 mutation
- **WHEN** 前端调用已注册 mutation 并传入合法参数
- **THEN** server MUST 执行该 mutation 的注册 SQL 并返回 mutation result

#### Scenario: query 端点调用 mutation
- **WHEN** 前端通过 `/api/queries/:name` 调用 mutation 类型 SQL
- **THEN** server MUST 拒绝请求且不得执行 SQL

### Requirement: No frontend supplied SQL
Named SQL API SHALL NOT accept SQL text from frontend runtime requests.

#### Scenario: 请求体包含 sql 字段
- **WHEN** 前端向 named SQL endpoint 提交 `sql` 字段
- **THEN** server MUST 忽略或拒绝该字段，并且只执行 backend 契约中注册的 SQL

### Requirement: Named SQL parameter validation
系统 SHALL 根据 backend 契约中的参数 schema 校验请求参数，拒绝缺失、类型错误或未声明参数。

#### Scenario: 参数合法
- **WHEN** 请求参数满足 named SQL 的 params schema
- **THEN** server MUST 将参数绑定到 SQL 占位符

#### Scenario: 参数包含未声明字段
- **WHEN** 请求参数包含 params schema 未声明的字段
- **THEN** server MUST 返回 400 且不得执行 SQL

### Requirement: System variable injection
系统 SHALL 为 named SQL 注入受信任系统变量，包括当前用户、应用 owner 和服务器时间，且这些变量不得由前端覆盖。

#### Scenario: SQL 使用 currentUserId
- **WHEN** 注册 SQL 引用 `:currentUserId`
- **THEN** server MUST 使用已认证 visitor 的用户 ID 绑定该变量

#### Scenario: 前端尝试覆盖系统变量
- **WHEN** 请求参数包含 `currentUserId`
- **THEN** server MUST 拒绝请求或忽略该参数，并使用服务端计算的系统变量

### Requirement: Named SQL safety rules
系统 SHALL 对 named SQL 执行语句级安全校验，query 仅允许只读语句，mutation 禁止多语句、DDL、ATTACH、DETACH 和危险 PRAGMA。

#### Scenario: query 包含写入语句
- **WHEN** query 类型 SQL 包含 INSERT、UPDATE、DELETE、DDL 或多语句
- **THEN** validate MUST 失败

#### Scenario: mutation 包含危险语句
- **WHEN** mutation SQL 包含 ATTACH、DETACH、DROP TABLE、ALTER TABLE 或危险 PRAGMA
- **THEN** validate MUST 失败
