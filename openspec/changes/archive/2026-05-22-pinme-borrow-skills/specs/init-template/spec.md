## MODIFIED Requirements

### Requirement: 模板 CLAUDE.md 补充 Raw SQL 文档
`init-repo/CLAUDE.md` SHALL 包含 Raw SQL 模式和 `useExec()` Hook 的完整文档。

#### Scenario: CLAUDE.md 包含 useExec Hook 文档
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档包含 `useExec()` Hook 的 TypeScript 示例代码、参数说明、返回格式（读操作返回 columns+rows、写操作返回 changes+lastInsertRowid）

#### Scenario: CLAUDE.md 包含 db.mode 配置说明
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档说明 manifest.json 中 `db.mode` 的两种值（"crud" 和 "sql"）及其区别

#### Scenario: CLAUDE.md 包含 SQL 模式权限说明
- **WHEN** AI 或开发者阅读 init-repo/CLAUDE.md
- **THEN** 文档说明 `db.sqlAccess` 配置（默认 "owner"）和权限控制行为
