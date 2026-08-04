## ADDED Requirements

### Requirement: Schema 声明状态流转

系统 SHALL 支持在 schema 业务元数据中声明状态流转配置，包括状态字段、初始状态、transition 名称、来源状态、目标状态、显示标签、访问策略和服务端写入字段。

#### Scenario: 声明提交 transition
- **WHEN** schema 的业务元数据声明 `statusField: "status"` 和名为 `submit` 的 transition
- **THEN** 系统 SHALL 将该 transition 作为该 schema 的状态流转契约保存

#### Scenario: schema 未声明 transitions
- **WHEN** schema 不包含 transitions 配置
- **THEN** 系统 SHALL 保持现有 CRUD 行为不变，且不得要求应用使用状态流转端点

### Requirement: 查询记录可用 transitions

系统 SHALL 提供记录级接口查询当前访问者可对指定记录执行的 transitions。

#### Scenario: 查询可用动作
- **WHEN** 当前用户请求某条记录的 transitions
- **THEN** 系统 SHALL 根据记录当前状态和访问策略返回可执行 transition 列表

#### Scenario: 当前状态无可用动作
- **WHEN** 记录当前状态不匹配任何 transition 的 `from` 条件
- **THEN** 系统 SHALL 返回空 transition 列表

### Requirement: 执行状态流转

系统 SHALL 提供记录级接口执行指定 transition，并在服务端原子地校验当前状态、访问权限和字段写入规则后更新记录。

#### Scenario: 成功提交记录
- **WHEN** 记录状态为 `draft` 且当前用户有权执行 `submit`
- **THEN** 系统 SHALL 将记录状态更新为 transition 声明的目标状态并返回更新后的记录

#### Scenario: 当前状态不允许执行
- **WHEN** 记录状态不在 transition 的 `from` 状态集合中
- **THEN** 系统 SHALL 返回 HTTP 400，且不得修改记录

#### Scenario: 当前用户无权执行
- **WHEN** 当前用户不满足 transition 的访问策略
- **THEN** 系统 SHALL 返回 HTTP 403，且不得修改记录

### Requirement: transition 服务端写入字段

系统 SHALL 支持 transition 声明服务端写入字段，用于写入目标状态、当前用户、当前时间或固定值。

#### Scenario: transition 写入当前用户和当前时间
- **WHEN** transition 声明 `set` 字段包含 `"reviewed_by": "currentUser.id"` 和 `"reviewed_at": "now"`
- **THEN** 执行 transition 时系统 SHALL 使用服务端识别的当前用户和当前时间填充这些字段

#### Scenario: 未登录用户触发当前用户写入
- **WHEN** transition 需要写入 `currentUser.id` 但当前访问者未登录
- **THEN** 系统 SHALL 返回 HTTP 401，且不得修改记录
