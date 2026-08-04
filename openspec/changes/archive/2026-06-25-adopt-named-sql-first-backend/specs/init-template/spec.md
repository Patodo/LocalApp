## ADDED Requirements

### Requirement: Init template teaches named SQL-first backend
init-repo SHALL teach application developers and agents to implement backend behavior through schema, migration, named query, named mutation, and transaction mutation files.

#### Scenario: 新项目包含 backend 示例
- **WHEN** developer initializes a new app
- **THEN** the generated backend examples MUST demonstrate named SQL-first reads and writes
- **AND** the examples MUST NOT include hosted action source, manifest, or bundle files

#### Scenario: AI 助手指南描述复杂逻辑
- **WHEN** AI 或开发者阅读 CLAUDE.md、skills 或 backend references
- **THEN** guidance MUST direct complex reads to bounded named SQL, SQL aggregation, JOINs, pagination, or frontend assembly
- **AND** guidance MUST direct database-only short write orchestration to named mutation or transaction mutation

#### Scenario: 模板禁止 action 兜底
- **WHEN** an app-side agent cannot express logic with existing named SQL capabilities
- **THEN** template guidance MUST instruct the agent to report a platform capability gap
- **AND** guidance MUST NOT instruct the agent to create hosted backend action as a fallback
