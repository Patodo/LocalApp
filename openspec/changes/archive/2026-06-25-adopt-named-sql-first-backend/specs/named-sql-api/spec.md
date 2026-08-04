## MODIFIED Requirements

### Requirement: Short transactional mutations without custom action
系统 SHALL 支持将常见短事务写逻辑表达为平台托管的 named mutation 或批量 mutation 能力，以减少仅为多条 SQL 原子性而创建 hosted action 的需求。

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
- **THEN** 该逻辑 MUST use platform-provided primitives or remain outside the stable named SQL backend path
- **AND** 文档 MUST explain that named SQL transaction is for database writes only

## ADDED Requirements

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
