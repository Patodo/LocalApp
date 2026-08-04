## ADDED Requirements

### Requirement: Per-database execution queue
系统 SHALL 对同一应用数据库文件的 named SQL 和相关数据库操作使用 per-db 执行队列，确保同一个 sql.js Database 实例不会被多个异步流程交错访问。

#### Scenario: 同一应用并发 query
- **WHEN** 多个请求同时调用同一应用的 named query
- **THEN** server MUST 通过该应用 DB 的执行队列调度 SQL 执行
- **AND** 每个请求 MUST 收到与串行执行一致的结果

#### Scenario: action ctx SQL 与页面 query 并发
- **WHEN** hosted backend action 的 `ctx.query` 与页面普通 named query 同时访问同一应用 DB
- **THEN** 两类 SQL MUST 共享同一个 per-db 执行队列
- **AND** server MUST NOT 让它们并发操作同一个 sql.js Database 实例

#### Scenario: mutation 与 transaction 并发
- **WHEN** named mutation 与 action transaction 同时访问同一应用 DB
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
