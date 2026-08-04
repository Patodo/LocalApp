## ADDED Requirements

### Requirement: Hosted action usage guidance
`init-repo/` SHALL document that hosted backend action is a constrained server-side orchestration feature, while named SQL is the default path for CRUD, lists, pagination, filtering and aggregation.

#### Scenario: AI assistant reads CLAUDE.md
- **WHEN** AI 或应用开发者阅读 `init-repo/CLAUDE.md`
- **THEN** 文档 MUST 明确普通读写优先使用 named SQL
- **AND** 文档 MUST 明确 action 适合审批、状态流转、级联删除、权限敏感写操作、同步服务端校验和通知编排
- **AND** 文档 MUST 明确无分页全量读模型不应放入 action

#### Scenario: developer reads backend actions README
- **WHEN** 开发者阅读 `init-repo/backend/actions/README.md`
- **THEN** 文档 MUST include action resource budget guidance
- **AND** 文档 MUST explain common budget errors and suggested migrations to paginated named SQL or aggregation

### Requirement: Template examples prefer lightweight backend paths
模板示例 SHALL demonstrate named SQL for ordinary reads and hosted action only for short write orchestration.

#### Scenario: 示例应用展示列表数据
- **WHEN** 模板或示例应用需要展示列表
- **THEN** 示例 MUST use a named query with pagination or filtering
- **AND** 示例 MUST NOT use an action to fetch and assemble an unpaginated full list

#### Scenario: 示例应用展示 action
- **WHEN** 模板示例需要展示 hosted action
- **THEN** 示例 MUST use a short transactional or permission-sensitive write scenario
- **AND** 示例 MUST stay within documented action runtime budgets
