## ADDED Requirements

### Requirement: Named SQL as default read model path
系统 SHALL 将 named SQL 作为应用列表、详情、筛选、统计、分页和聚合读模型的默认服务端路径。

#### Scenario: 应用需要分页列表
- **WHEN** 应用需要展示列表型数据
- **THEN** backend contract MUST be able to express the read model as registered named SQL with filtering, ordering and pagination parameters
- **AND** hosted action developer guidance MUST NOT recommend loading all rows into action for assembly

#### Scenario: 应用需要统计或汇总
- **WHEN** 应用需要展示计数、分组、合计或其他轻量统计
- **THEN** backend contract MUST be able to express the computation using SQL aggregation when the computation fits SQL
- **AND** action runtime MUST NOT be required for ordinary aggregate reads

### Requirement: Named SQL result budgets
系统 SHALL 对 named SQL 查询结果提供可配置的 rows 和 bytes 预算，以保护服务端内存并向开发者暴露可理解错误。

#### Scenario: named query 返回过多 rows
- **WHEN** registered query 返回 rows 数超过平台配置或 contract 声明的预算
- **THEN** server MUST return a clear named SQL result too large error
- **AND** error guidance MUST mention pagination or more selective filters

#### Scenario: action ctx query 触发 named SQL 预算
- **WHEN** action 内部 `ctx.query` 调用 named SQL 且查询结果超过 named SQL 预算
- **THEN** action MUST receive a stable database or action budget error
- **AND** 平台 MUST record the SQL name and result size summary in diagnostics

### Requirement: Short transactional mutations without custom action
系统 SHALL 支持将常见短事务写逻辑表达为平台托管的 named mutation 或批量 mutation 能力，以减少仅为多条 SQL 原子性而创建 hosted action 的需求。

#### Scenario: 应用需要原子执行多条注册 mutation
- **WHEN** 应用声明一个由多条已注册 mutation 组成的短事务
- **THEN** server MUST execute them within the same app DB transaction
- **AND** 任意一步失败时 MUST 回滚该事务内已执行的写入

#### Scenario: 短事务包含外部副作用
- **WHEN** 应用逻辑需要通知、网络调用或其他外部副作用
- **THEN** 该逻辑 MUST remain in hosted action rather than named SQL transaction
- **AND** 文档 MUST explain that named SQL transaction is for database writes only
