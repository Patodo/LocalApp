## ADDED Requirements

### Requirement: 数据操作 Agent Skill 定义
项目 SHALL 在 `.claude/skills/localapp-data.md` 中提供数据操作指导 skill，帮助 AI Agent 理解 LocalApp 的数据能力。

#### Scenario: skill 包含 CRUD 模式文档
- **WHEN** AI 读取 `localapp-data.md`
- **THEN** skill 包含 CRUD 模式的完整说明：schema 创建命令、字段类型参考、8 个 SDK Hook（useList/useGet/useCreate/useUpdate/useDelete/useCount/useExec）的 TypeScript 示例

#### Scenario: skill 包含 SQL 模式文档
- **WHEN** AI 读取 `localapp-data.md`
- **THEN** skill 包含 SQL 模式的说明：manifest.json 的 `db.mode=sql` 配置、`useExec()` Hook 用法、读/写操作返回格式

#### Scenario: skill 包含模式选择指南
- **WHEN** AI 需要决定使用哪种数据模式
- **THEN** skill 提供选择指南：简单增删改查用 CRUD 模式、复杂查询用 SQL 模式、可混合使用

#### Scenario: skill 触发条件
- **WHEN** 用户提到数据存储、定义数据表、执行 SQL、使用 useList/useCreate/useExec 等 Hook
- **THEN** AI Agent 匹配到 `localapp-data` skill 的 description 字段并激活
