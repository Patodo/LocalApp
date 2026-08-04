## ADDED Requirements

### Requirement: Schema 支持 transitions 元数据

Schema 管理接口 SHALL 支持保存和返回业务状态流转元数据，包括 `statusField`、`initialStatus` 和 `transitions`。

#### Scenario: 创建带 transitions 的 schema
- **WHEN** `POST /api/schemas` 请求体包含合法 transitions 元数据
- **THEN** 系统 SHALL 保存该元数据，并在 schema 查询接口中返回

#### Scenario: transition 引用不存在的状态字段
- **WHEN** transitions 元数据引用的 `statusField` 不存在于 schema 字段定义中
- **THEN** 系统 SHALL 返回 HTTP 400，并说明状态字段不存在

### Requirement: 校验 transition 定义

Schema 管理接口 SHALL 校验 transition 定义，确保每个 transition 有唯一名称、非空来源状态、目标状态和合法访问策略。

#### Scenario: transition 名称重复
- **WHEN** schema 请求体包含两个同名 transition
- **THEN** 系统 SHALL 返回 HTTP 400，且不得创建或更新 schema

#### Scenario: transition 缺少目标状态
- **WHEN** transition 缺少 `to` 字段
- **THEN** 系统 SHALL 返回 HTTP 400，且不得创建或更新 schema
