## Purpose

This spec defines the registered named SQL runtime API for application-owned queries and mutations.
## Requirements
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

### Requirement: Per-database execution queue
系统 SHALL 对同一应用数据库文件的 named SQL 和相关数据库操作使用 per-db 执行队列，确保同一个 sql.js Database 实例不会被多个异步流程交错访问。

#### Scenario: 同一应用并发 query
- **WHEN** 多个请求同时调用同一应用的 named query
- **THEN** server MUST 通过该应用 DB 的执行队列调度 SQL 执行
- **AND** 每个请求 MUST 收到与串行执行一致的结果

#### Scenario: mutation 与 transaction mutation 并发
- **WHEN** named mutation 与 transaction mutation 同时访问同一应用 DB
- **THEN** server MUST 按队列顺序执行它们
- **AND** transaction 执行期间 MUST NOT 插入其他同 DB 操作

### Requirement: Database queue timeout
系统 SHALL 为 per-db 队列等待设置有限超时，避免请求无限期等待。

#### Scenario: 队列等待超时
- **WHEN** named SQL 请求等待同一 DB 队列超过平台配置的等待时间
- **THEN** server MUST 返回明确的 database busy 或 queue timeout 错误
- **AND** 不得执行该请求对应 SQL

### Requirement: sql.js runtime error wrapping
系统 SHALL 捕获 sql.js/WASM 抛出的底层运行时错误，并返回稳定的数据库运行时错误响应。

#### Scenario: sql.js 抛出 memory access out of bounds
- **WHEN** SQL 执行期间底层 sql.js/WASM 抛出 `memory access out of bounds`
- **THEN** server MUST 返回可读的 database runtime error
- **AND** 响应错误文本 MUST NOT 只包含未解释的底层 WASM 错误

#### Scenario: SQL 执行失败需要内部诊断
- **WHEN** named SQL 执行失败
- **THEN** server MUST 在内部日志记录 SQL 名称、应用 DB 标识、错误分类和原始错误摘要
- **AND** server MUST NOT 在外部响应中泄漏完整底层栈或数据库文件路径

### Requirement: Named SQL as default read model path
系统 SHALL 将 named SQL 作为应用列表、详情、筛选、统计、分页和聚合读模型的默认服务端路径。

#### Scenario: 应用需要分页列表
- **WHEN** 应用需要展示列表型数据
- **THEN** backend contract MUST be able to express the read model as registered named SQL with filtering, ordering and pagination parameters
- **AND** developer guidance MUST NOT recommend loading all rows into hosted actions for assembly

#### Scenario: 应用需要统计或汇总
- **WHEN** 应用需要展示计数、分组、合计或其他轻量统计
- **THEN** backend contract MUST be able to express the computation using SQL aggregation when the computation fits SQL
- **AND** hosted action runtime MUST NOT be required for ordinary aggregate reads

### Requirement: Named SQL result budgets
系统 SHALL 对 named SQL 查询结果提供可配置的 rows 和 bytes 预算，以保护服务端内存并向开发者暴露可理解错误。

#### Scenario: named query 返回过多 rows
- **WHEN** registered query 返回 rows 数超过平台配置或 contract 声明的预算
- **THEN** server MUST return a clear named SQL result too large error
- **AND** error guidance MUST mention pagination or more selective filters

### Requirement: Short transactional mutations without custom action
系统 SHALL 支持将常见短事务写逻辑表达为平台托管的 named mutation 或批量 mutation 能力，以避免应用仅为多条 SQL 原子性而创建自定义 JS 后端。

#### Scenario: 应用需要原子执行多条注册 mutation
- **WHEN** 应用声明一个由多条已注册 mutation 组成的短事务
- **THEN** server MUST execute them within the same app DB transaction
- **AND** 任意一步失败时 MUST 回滚该事务内已执行的写入

#### Scenario: 后续 mutation 引用前序 mutation 结果
- **WHEN** a transaction mutation step parameter declares a result reference to an earlier step
- **THEN** server MUST resolve the reference before validating and executing that step
- **AND** server MUST support references to `changes` and `lastInsertRowId`
- **AND** server MUST reject references to the current step, future steps, missing steps, or unsupported result fields

#### Scenario: 短事务包含外部副作用
- **WHEN** 应用逻辑需要通知、网络调用或其他外部副作用
- **THEN** 该逻辑 MUST use a platform-provided primitive or report a platform capability gap
- **AND** 文档 MUST explain that named SQL transaction is for database writes only

### Requirement: Named query result shapes

Named query contract entries SHALL support result shape metadata used by validate, upload, runtime budgets, and SDK guidance.

#### Scenario: page result shape
- **WHEN** a named query declares `result.mode` as `page`
- **THEN** the contract MUST define a bounded page size through params or metadata
- **AND** runtime MUST enforce the smaller of request limit, contract max rows, and platform max rows

#### Scenario: single result shape
- **WHEN** a named query declares `result.mode` as `single`
- **THEN** runtime MUST reject results containing more than one row

#### Scenario: aggregate result shape
- **WHEN** a named query declares `result.mode` as `aggregate`
- **THEN** runtime MUST enforce declared rows and bytes budgets
- **AND** upload MUST allow the query to be referenced by actions only if those budgets fit platform limits

### Requirement: Named SQL query execution enforces budgets during row materialization

Named SQL query execution SHALL enforce row and byte budgets while reading SQL results, before the full result set is materialized as JavaScript objects.

#### Scenario: query exceeds max rows while stepping
- **WHEN** a query produces more rows than its effective budget allows
- **THEN** execution MUST stop reading additional rows
- **AND** server MUST return `named_sql_result_too_large` or equivalent stable error

#### Scenario: query exceeds max bytes while stepping
- **WHEN** the estimated JSON bytes of accumulated rows exceeds the effective byte budget
- **THEN** execution MUST stop reading additional rows
- **AND** server MUST return a clear result-too-large error without exposing sql.js internals

#### Scenario: small bounded query succeeds
- **WHEN** a query result stays within row and byte budgets
- **THEN** server MUST return rows in the existing named SQL response shape

### Requirement: Named SQL remains the default read model path

Applications SHALL use bounded named SQL rather than hosted actions for ordinary read models such as lists, detail views, filters, search, summaries, and reports.

#### Scenario: application needs list page
- **WHEN** an application needs a list screen
- **THEN** the platform contract MUST support expressing the read model as paginated named SQL
- **AND** hosted action runtime MUST NOT be required for that list screen

#### Scenario: application needs count or summary
- **WHEN** an application needs counts, grouped totals, or lightweight summaries
- **THEN** the platform contract MUST support expressing the computation as aggregate named SQL
- **AND** the result MUST be protected by named SQL budgets

### Requirement: Named SQL remains stable without hosted actions
Named SQL APIs SHALL remain fully usable when hosted actions are disabled.

#### Scenario: hosted action disabled but named query succeeds
- **WHEN** hosted action files are unsupported by the stable platform
- **AND** an application calls a registered named query
- **THEN** server MUST execute the named query through the normal named SQL path
- **AND** no hosted action worker or bundle MUST be loaded

#### Scenario: hosted action disabled but transaction mutation succeeds
- **WHEN** hosted actions are disabled
- **AND** an application calls a registered transaction mutation
- **THEN** server MUST execute the transaction mutation through the platform named SQL executor
- **AND** the transaction MUST rollback on any failed registered mutation
