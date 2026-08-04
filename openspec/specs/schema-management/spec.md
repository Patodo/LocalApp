## Purpose

数据 Schema 管理。提供 Schema 的创建（含建表）、增量更新、删除（含删表）和列表查询接口，底层操作 SQLite。
## Requirements
### Requirement: Schema 支持业务模型元数据

Schema 的业务模型元数据(ownerField、statusField、recordAccess、transitions 等)SHALL 移至 manifest.json 的 business 块管理,与字段定义分离。字段定义由 SQL 直接管理,业务规则由 manifest 声明。

manifest.json 的 business 块 SHALL 形如:

```json
{
  "business": {
    "<tableName>": {
      "ownerField": "created_by",
      "statusField": "status",
      "recordAccess": { "read": "owner", "update": "owner", "delete": "owner" },
      "transitions": [
        { "from": "todo", "to": "in_progress", "access": "owner" },
        { "from": "in_progress", "to": "done", "access": "owner" }
      ],
      "defaultFields": {
        "created_by": { "defaultFrom": "currentUser.id" }
      },
      "enums": {
        "status": ["todo", "in_progress", "done"]
      }
    }
  }
}
```

server 端 SHALL 读取 manifest.business,在 CRUD API 执行时强制执行业务规则(owner 检查、transition 校验、defaultFields 自动填充、enum 验证)。

#### Scenario: manifest.json 包含 business 块
- **WHEN** 用户在 dev 模式创建记录,manifest.business.tasks.defaultFields 含 `created_by: { defaultFrom: "currentUser.id" }`
- **THEN** mini-server 自动填充 `created_by = "dev-user"`
- **AND** 行为与生产一致(只是 userId 不同)

#### Scenario: recordAccess 强制执行
- **WHEN** 用户尝试 update 不属于自己的记录
- **AND** manifest.business.tasks.recordAccess.update = "owner"
- **THEN** mini-server / 生产 server 拒绝(403)
- **AND** 错误信息 "Access denied. Only owner can update."

#### Scenario: transition 校验
- **WHEN** 用户尝试 transition from="todo" to="done"(跳过 in_progress)
- **AND** manifest.business.tasks.transitions 只允许 todo → in_progress 和 in_progress → done
- **THEN** server 拒绝(400)
- **AND** 错误 "Invalid transition: todo → done not allowed"

#### Scenario: enum 字段验证
- **WHEN** 用户创建记录,tasks.status = "invalid"
- **AND** manifest.business.tasks.enums.status = ["todo", "in_progress", "done"]
- **THEN** server 拒绝(400)
- **AND** 错误 "Invalid value for status. Allowed: todo, in_progress, done"

### Requirement: Schema 支持 transitions 元数据

transitions 元数据 SHALL 移到 manifest.business.<table>.transitions 数组,定义跟之前一致(from、to、access、set)。

#### Scenario: transitions 定义在 manifest.business
- **WHEN** 用户在 manifest.json 写:
  ```json
  { "business": { "tasks": { "transitions": [
    { "from": "todo", "to": "in_progress", "access": "owner" }
  ] } } }
  ```
- **THEN** server 加载该 manifest 后,允许 todo → in_progress 迁移
- **AND** useTransitions hook 返回该迁移作为可用操作

### Requirement: 校验 transition 定义

server SHALL 在 manifest.json 上传时(validate 阶段)校验 business.<table>.transitions 定义:
- from 和 to 必须是 enum 中声明的合法值
- access 字段必须是 "owner" / "any" / "<role>" 之一
- set 字段(可选)必须是合法字段名 + 值

不合法 SHALL 拒绝 upload。

#### Scenario: transitions 引用未声明的 enum 值
- **WHEN** manifest.business.tasks.transitions 引用 from="invalid_state"
- **AND** enums.status 不包含 "invalid_state"
- **THEN** validate 失败
- **AND** CLI 提示 "Transition references unknown enum value: invalid_state"

### Requirement: Schema files live in backend contract

应用级数据 schema SHALL be defined in backend contract files instead of being maintained as hidden platform-only application schema state.

#### Scenario: schema file discovered
- **WHEN** `backend/resources/work_items/schema.json` defines a resource schema
- **THEN** validate MUST register `work_items` as an application resource schema

#### Scenario: duplicate schema names
- **WHEN** multiple backend schema files define the same resource name
- **THEN** validate MUST fail with a duplicate schema error

### Requirement: Schema JSON uses published schema

应用级 schema JSON files SHALL include a `$schema` reference to the platform resource schema JSON Schema. Published backend JSON Schemas SHALL use JSON Schema draft 2020-12 as their dialect.

#### Scenario: schema file has valid schema reference
- **WHEN** a resource schema JSON contains a valid `$schema`
- **THEN** editor tooling and CLI validate MUST be able to validate its structure against the published schema
