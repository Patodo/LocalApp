## REMOVED Requirements

### Requirement: 创建 Schema

**Reason**: 废除声明式 schema 创建,改为用户手写 SQL migration(`migrations/` 目录)。schema 由 SQL DDL 直接管理,不再通过 manifest.schemas 抽象。

**Migration**: 现有项目运行 `localapp migrate-from-manifest` 一次性转换 manifest.schemas 为初始 SQL migration 文件 `migrations/001_initial_from_manifest.sql`。后续 schema 变更通过手动编辑/添加 migration 文件。

### Requirement: 更新 Schema（增量）

**Reason**: 同上。schema 变更通过新增 migration 文件实现,不再有"增量更新"命令。

**Migration**: 用户手动写新 migration 文件(`00N_<description>.sql`),包含 ALTER TABLE 等 DDL。

### Requirement: 删除 Schema

**Reason**: 删表通过 migration 实现(`DROP TABLE` SQL)。

**Migration**: 用户写 `00N_drop_<table>.sql`,内容 `DROP TABLE <name>;`。

### Requirement: 列出 Schemas

**Reason**: manifest.schemas 不再存在,无法"列出 schemas"。需要查询 schema 时,通过 `localapp db types` 或 `localapp db shell`(直接 PRAGMA table_info)。

**Migration**: 用户用 `localapp db types -o -` 输出到 stdout,或 `localapp db shell` 进 sqlite CLI 后 `.schema` 或 `PRAGMA table_info(<table>)`。

### Requirement: Schema 字段支持当前用户默认值

**Reason**: 字段约束(defaultFrom: currentUser.id)从声明式 schema 移到 manifest.business,跟 ownerField 等业务规则一致管理。

**Migration**: 用户在 manifest.json 的 business 块声明字段约束:
```json
{
  "business": {
    "tasks": {
      "defaultFields": {
        "created_by": { "defaultFrom": "currentUser.id" }
      }
    }
  }
}
```

### Requirement: Schema 字段支持枚举约束

**Reason**: 枚举约束从声明式 schema 移到 manifest.business。

**Migration**: 用户在 manifest.json business 块声明:
```json
{
  "business": {
    "tasks": {
      "enums": {
        "status": ["todo", "in_progress", "done"]
      }
    }
  }
}
```

## MODIFIED Requirements

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
