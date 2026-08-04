## ADDED Requirements

### Requirement: 业务应用模型约定

系统 SHALL 定义业务应用模型约定，覆盖申请类、审批类、分配类和目录类数据的推荐字段、状态字段、所有权字段和权限模式，并作为 Agent 与应用开发者的建模参考。

#### Scenario: 申请类模型包含推荐字段
- **WHEN** Agent 或开发者需要创建请假、报销、工单等申请类应用
- **THEN** 指引 SHALL 推荐使用 `created_by` 作为申请人字段、`status` 作为状态字段，并使用 `draft`、`submitted`、`approved`、`rejected` 等状态值

#### Scenario: 分配类模型包含负责人字段
- **WHEN** Agent 或开发者需要创建任务、跟进、处理单等分配类应用
- **THEN** 指引 SHALL 推荐使用 `assignee_id` 或等价字段表达负责人，并基于负责人字段决定记录级可见性和操作权限

### Requirement: 业务模型元数据格式

系统 SHALL 为 schema 定义可选业务模型元数据格式，用于描述模型类型、所有权字段、状态字段、状态枚举和记录级访问策略。

#### Scenario: schema 声明业务模型元数据
- **WHEN** schema 包含 `business.kind`、`business.ownerField`、`business.statusField` 或 `business.recordAccess`
- **THEN** 系统 SHALL 将这些元数据作为该 schema 的业务建模契约保存并暴露给相关 API 和 SDK

#### Scenario: schema 未声明业务模型元数据
- **WHEN** schema 不包含 `business` 元数据
- **THEN** 系统 SHALL 保持现有 CRUD、访问控制和 SDK 行为不变

### Requirement: Agent 优先使用业务模型约定

Agent 在生成 LocalApp 业务应用时 SHALL 优先使用系统定义的业务模型约定，而不是临时发明不一致的字段名、状态值或权限判断方式。

#### Scenario: 生成请假申请应用
- **WHEN** 用户要求 Agent 创建请假申请应用
- **THEN** Agent SHALL 优先创建包含申请人字段、状态字段、提交时间、审批人字段和记录级权限策略的 schema

#### Scenario: 避免仅依赖前端过滤
- **WHEN** 业务需求包含“用户只能看自己的记录”或类似权限约束
- **THEN** Agent SHALL 使用后端记录级访问策略表达该约束，而不是只在 React 组件中筛选数据
