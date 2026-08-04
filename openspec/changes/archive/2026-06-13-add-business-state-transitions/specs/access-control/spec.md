## ADDED Requirements

### Requirement: transition 执行受访问控制保护

transition 查询和执行 SHALL 先通过页面级访问控制和路由级读取权限检查；执行 transition 时还 SHALL 校验 transition 自身访问策略。

#### Scenario: 页面级访问控制拒绝
- **WHEN** 当前用户无法访问页面
- **THEN** transition 查询和执行端点 SHALL 返回 401 或 403，且不得读取或修改业务记录

#### Scenario: transition 访问策略拒绝
- **WHEN** 当前用户可读取记录但不满足 transition 的访问策略
- **THEN** 查询端点 SHALL 不返回该 transition，执行端点 SHALL 返回 HTTP 403

### Requirement: transition 支持记录字段访问策略

transition 访问策略 SHALL 支持基于记录字段匹配当前用户，以表达“创建者可提交”“负责人可处理”等业务动作权限。

#### Scenario: 创建者可提交
- **WHEN** transition 访问策略要求 `created_by` 等于当前用户 ID
- **AND** 目标记录的 `created_by` 等于当前用户 ID
- **THEN** 系统 SHALL 允许执行该 transition

#### Scenario: 非创建者不可提交
- **WHEN** transition 访问策略要求 `created_by` 等于当前用户 ID
- **AND** 目标记录的 `created_by` 不等于当前用户 ID
- **THEN** 系统 SHALL 拒绝执行该 transition
