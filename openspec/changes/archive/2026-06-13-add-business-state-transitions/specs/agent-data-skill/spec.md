## ADDED Requirements

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
- **WHEN** Agent 为审批页面生成“批准”按钮
- **THEN** 数据 skill SHALL 指导 Agent 调用 transition API 执行 `approve` 动作

#### Scenario: 生成提交按钮
- **WHEN** Agent 为申请表生成“提交”按钮
- **THEN** 数据 skill SHALL 指导 Agent 调用 transition API 执行 `submit` 动作
