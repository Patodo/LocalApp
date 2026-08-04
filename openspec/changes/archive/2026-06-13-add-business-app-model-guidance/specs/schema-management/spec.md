## ADDED Requirements

### Requirement: Schema 支持业务模型元数据

`POST /api/schemas` 和 schema 存储结构 SHALL 支持可选 `business` 字段，用于保存业务模型类型、所有权字段、状态字段、状态枚举和记录级访问策略。

#### Scenario: 创建带业务元数据的 schema
- **WHEN** 发送 `POST /api/schemas` 且请求体包含合法的 `business` 元数据
- **THEN** 系统 SHALL 将 `business` 元数据写入该 schema 定义并在后续 schema 查询中返回

#### Scenario: 创建不带业务元数据的 schema
- **WHEN** 发送 `POST /api/schemas` 且请求体不包含 `business`
- **THEN** 系统 SHALL 按现有行为创建 schema，且不要求业务模型字段存在

### Requirement: Schema 字段支持当前用户默认值

Schema 字段约束 SHALL 支持 `defaultFrom`，首批支持 `"currentUser.id"` 和 `"currentUser.name"`，用于在创建记录时由服务端填充当前访问者信息。

#### Scenario: 字段声明 currentUser.id 默认值
- **WHEN** schema 字段声明 `{ "constraints": { "defaultFrom": "currentUser.id" } }`
- **THEN** 创建记录时服务端 SHALL 在请求体未提供该字段时填充当前登录用户 ID

#### Scenario: 未登录用户触发当前用户默认值
- **WHEN** 未登录访问者创建记录且需要填充 `defaultFrom: "currentUser.id"` 或 `defaultFrom: "currentUser.name"`
- **THEN** 系统 SHALL 返回 HTTP 401，且不得创建记录

### Requirement: Schema 字段支持枚举约束

Schema 字段约束 SHALL 支持 `enum` 数组，用于限制字符串、数字或布尔字段的允许值。

#### Scenario: 创建记录时枚举值合法
- **WHEN** 字段声明 `enum` 且请求体提供的值位于枚举数组中
- **THEN** 系统 SHALL 允许创建或更新该记录

#### Scenario: 创建记录时枚举值非法
- **WHEN** 字段声明 `enum` 且请求体提供的值不在枚举数组中
- **THEN** 系统 SHALL 返回 HTTP 400，并说明字段值不符合枚举约束
