## Context

当前系统已经提供 schema 管理、CRUD API、`useMe`、数据 Hook、页面级访问控制和路由级访问控制。它们足以支撑简单应用，但业务应用常见的“这条记录属于谁”“谁能审批”“哪些按钮应该显示”仍需要应用开发者和 Agent 自行约定。

本设计把 P0 补强限定为一层薄的业务建模能力：不替换现有 CRUD，不引入工作流引擎，不强制所有应用采用同一业务模型；只在现有 schema、CRUD、访问控制和 SDK 之上增加可声明、可执行、可引导的业务约定。

## Goals / Non-Goals

**Goals:**

- 让应用开发者能声明业务模型用途、所有权字段、当前用户默认值、状态枚举和记录级访问策略。
- 让 CRUD API 在不写后端代码的前提下自动填充当前用户字段，并执行记录级读写权限。
- 让 React 应用能通过 `usePermissions()`、`can()` 和 `<Can>` 统一判断当前用户对记录的可见操作。
- 让 init 模板和 Agent skill 明确指导 AI Agent 为常见业务应用选择正确 schema、字段和权限模式。
- 保持现有 schema、CRUD、routeAccess、pageAccess、raw SQL 和 SDK Hook 向后兼容。

**Non-Goals:**

- 不实现完整工作流引擎、审批流编排器或状态机运行时。
- 不实现跨应用或跨数据库的组织级权限系统。
- 不要求所有记录都必须有所有权字段。
- 不改变 raw SQL 的自由度；raw SQL 仍由 `sqlAccess` 控制，不自动套用记录级策略。
- 不引入新的外部数据库、队列或身份服务。

## Decisions

### 1. 使用 schema 元数据表达业务约定

在 `DataSchema` 上新增可选的 `business` 元数据，而不是创建独立配置文件。元数据示例：

```json
{
  "business": {
    "kind": "request",
    "ownerField": "created_by",
    "statusField": "status",
    "statuses": ["draft", "submitted", "approved", "rejected"],
    "recordAccess": {
      "read": { "mode": "ownerField", "field": "created_by" },
      "update": { "mode": "ownerField", "field": "created_by", "when": { "status": ["draft"] } }
    }
  }
}
```

原因：schema 已经是平台生成 CRUD API 的契约来源，把业务约定放在 schema 上能让 CLI、服务端、SDK、Agent 上下文使用同一份信息。

备选方案是新增 `business.json` 或 manifest 配置。该方案可读性较好，但会产生多源配置，需要额外同步 schema 与业务策略。

### 2. 当前用户默认值作为字段约束扩展

字段约束新增 `defaultFrom`，首批支持 `"currentUser.id"` 和 `"currentUser.name"`。创建记录时，如果请求体未提供该字段，CRUD API 使用当前 visitor 填充；未登录但字段要求当前用户时返回 401。

原因：这能覆盖“申请人默认当前用户”“创建者默认当前用户”的高频场景，同时避免前端伪造归属字段。

备选方案是让 Agent 在前端手动写入 `me.id`。该方案简单但不安全，用户可篡改请求体。

### 3. 记录级访问控制在 CRUD API 中执行

现有顺序保持为页面级访问控制优先、路由级访问控制其次。通过后再执行记录级策略：

```text
pageAccess -> routeAccess/defaultAccess -> recordAccess -> CRUD 操作
```

读列表时，系统根据记录级 read 策略自动追加过滤；读单条、更新、删除时读取记录后再判断；创建时先填充默认字段，再判断 create 策略。

原因：这样不破坏已有访问控制语义，同时把数据归属保护放在后端执行。

备选方案是在 SDK 中过滤数据。该方案只能影响 UI，不能阻止直接调用 API。

### 4. SDK 权限 API 只做 UI 判断，不作为安全边界

`@localapp/sdk-react` 新增 `usePermissions()`，返回 `{ can, loading, error }`；同时导出 `<Can>` 组件。`can(action, record, schema?)` 基于当前用户、schema 业务元数据和记录内容判断 UI 是否显示操作。

原因：后端仍是安全边界，SDK 只帮助应用避免展示不可用按钮。

备选方案是让每个应用自己写权限函数。该方案重复且容易与后端策略不一致。

### 5. Agent 指引优先覆盖模式，不生成复杂抽象

模板新增业务建模 skill，指导 Agent 在常见应用中选择字段：

- 申请类：`created_by`、`status`、`submitted_at`、`reviewed_by`
- 分配类：`assignee_id`、`status`、`due_at`
- 目录类：名称、描述、启用状态、排序字段

原因：多数应用需要的是稳定模式，不需要 Agent 即兴设计一套权限系统。

备选方案是提供代码生成器一次生成整套应用。该方案更重，也更容易限制应用形态。

## Risks / Trade-offs

- 记录级策略表达过复杂会变成半个权限 DSL -> 首批只支持 `ownerField`、`assigneeField`、`aclField`、`status` 条件和 `authenticated`，后续再扩展。
- 列表过滤和单条权限判断语义可能不一致 -> 所有策略由同一个服务端 helper 解析，测试覆盖 list/get/update/delete。
- `defaultFrom` 涉及用户身份，未登录时行为容易混淆 -> 字段需要当前用户但 visitor 不存在时统一返回 401，并在文档中明确。
- SDK `can()` 与后端判断可能漂移 -> SDK 使用 schema 元数据中的同一策略格式，且文档强调后端才是安全边界。
- raw SQL 不套用记录级策略可能绕过限制 -> 保持 `sqlAccess` 默认严格，Agent 指引要求业务应用默认不用 raw SQL 写敏感数据。

## Migration Plan

1. 新增类型字段为可选字段，旧 schema 不需要迁移。
2. 服务端 CRUD 对缺少 `business` 元数据的 schema 维持现有行为。
3. CLI 与模板新增扩展示例，不改变旧命令的最小用法。
4. SDK 新增导出，不修改现有 Hook 签名。
5. 如果实施后需要回滚，移除新增策略解析即可；旧 schema 和旧应用仍可按原始 CRUD 行为运行。

## Open Questions

- 首批是否允许 `recordAccess.read` 同时包含多个条件的 OR 逻辑，还是只支持单一模式。
- CLI 是否需要新增 `localapp schemas create --preset request`，还是先仅支持 `--file` 扩展 schema。
- `<Can>` 是否应放在 `@localapp/sdk-react` 内，还是由 init 模板提供本地组件包装。
