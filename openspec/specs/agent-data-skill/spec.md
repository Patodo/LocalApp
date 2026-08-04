## Purpose

数据操作 Agent Skill 定义。提供数据操作指导 skill，帮助 AI Agent 理解 LocalApp 的 CRUD 和 SQL 数据能力。

## Requirements

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

### Requirement: 数据 skill 包含业务模型选择指南

`.claude/skills/localapp-data.md` SHALL 包含业务模型选择指南，帮助 Agent 在常见业务应用中选择申请类、审批类、分配类或目录类模型。

#### Scenario: 用户要求创建申请应用
- **WHEN** 用户要求创建请假、报销、工单等申请类应用
- **THEN** Agent SHALL 能从数据 skill 中获得申请类 schema 字段和权限策略建议

#### Scenario: 用户要求创建任务分配应用
- **WHEN** 用户要求创建任务、客户跟进或处理单应用
- **THEN** Agent SHALL 能从数据 skill 中获得负责人字段、状态字段和记录级可见性建议

### Requirement: 数据 skill 要求后端表达数据权限

`.claude/skills/localapp-data.md` SHALL 要求 Agent 使用 schema 业务元数据和记录级访问控制表达数据权限，而不是仅依赖前端筛选或隐藏按钮。

#### Scenario: 只能查看自己的数据
- **WHEN** 需求包含“只能查看自己的数据”
- **THEN** 数据 skill SHALL 指导 Agent 声明所有权字段、当前用户默认值和记录级 read 策略

#### Scenario: 只有符合状态的记录可编辑
- **WHEN** 需求包含”草稿可编辑、提交后不可编辑”等状态规则
- **THEN** 数据 skill SHALL 指导 Agent 使用状态字段和记录级 update 策略表达该规则

### Requirement: 数据 skill 包含状态流转建模规则

`.claude/skills/localapp-data.md` SHALL 指导 Agent 在申请、审批、工单等业务应用中声明状态字段和 transitions。

#### Scenario: 用户要求创建审批应用
- **WHEN** 用户要求创建审批类应用
- **THEN** 数据 skill SHALL 指导 Agent 定义状态字段、初始状态、提交、批准和拒绝等 transitions

#### Scenario: 用户要求创建工单应用
- **WHEN** 用户要求创建工单或任务处理应用
- **THEN** 数据 skill SHALL 指导 Agent 定义打开、处理中、完成或关闭等 transitions

### Requirement: 数据 skill 要求业务状态变化使用 transition

`.claude/skills/localapp-data.md` SHALL 要求 Agent 对提交、审批、拒绝、关闭等业务状态变化优先使用 transition API，而不是普通 update。

#### Scenario: 生成审批按钮
- **WHEN** Agent 为审批页面生成”批准”按钮
- **THEN** 数据 skill SHALL 指导 Agent 调用 transition API 执行 `approve` 动作

#### Scenario: 生成提交按钮
- **WHEN** Agent 为申请表生成”提交”按钮
- **THEN** 数据 skill SHALL 指导 Agent 调用 transition API 执行 `submit` 动作
