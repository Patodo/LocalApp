## ADDED Requirements

### Requirement: CRUD API 提供 transition 查询端点

CRUD API SHALL 为声明 transitions 的 schema 提供 `GET /serve/{userId}/{name}/api/{resource}/{id}/transitions` 端点。

#### Scenario: 查询存在记录的 transitions
- **WHEN** 用户请求存在记录的 transitions 端点
- **THEN** 系统 SHALL 返回 `{ success: true, data: [...] }`，其中 `data` 为当前可用 transition 列表

#### Scenario: 查询不存在记录的 transitions
- **WHEN** 用户请求不存在记录的 transitions 端点
- **THEN** 系统 SHALL 返回 HTTP 404

### Requirement: CRUD API 提供 transition 执行端点

CRUD API SHALL 为声明 transitions 的 schema 提供 `POST /serve/{userId}/{name}/api/{resource}/{id}/transitions/{transitionName}` 端点。

#### Scenario: 执行存在的 transition
- **WHEN** 用户请求执行存在且可用的 transition
- **THEN** 系统 SHALL 更新记录状态并返回更新后的记录

#### Scenario: 执行不存在的 transition
- **WHEN** 用户请求执行 schema 未声明的 transition 名称
- **THEN** 系统 SHALL 返回 HTTP 404，且不得修改记录

### Requirement: transition 执行复用 CRUD 字段校验

transition 执行端点 SHALL 复用 CRUD 字段校验，包括 required、enum、defaultFrom 和字段类型约束。

#### Scenario: transition 写入枚举字段合法
- **WHEN** transition 将状态字段写入 schema enum 允许的值
- **THEN** 系统 SHALL 允许更新记录

#### Scenario: transition 写入枚举字段非法
- **WHEN** transition 将状态字段写入 schema enum 不允许的值
- **THEN** 系统 SHALL 返回 HTTP 400，且不得修改记录
