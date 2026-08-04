## ADDED Requirements

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
- **WHEN** 需求包含“草稿可编辑、提交后不可编辑”等状态规则
- **THEN** 数据 skill SHALL 指导 Agent 使用状态字段和记录级 update 策略表达该规则
