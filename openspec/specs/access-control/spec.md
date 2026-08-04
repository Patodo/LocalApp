## Purpose

访问控制机制。定义页面级和路由级的双层访问控制策略，支持 public、authenticated、owner、acl 四种控制级别，确保资源安全访问。

## Requirements

### Requirement: 访问控制级别定义

系统 SHALL 支持四种访问控制级别：`public`（任何人）、`authenticated`（仅登录用户）、`owner`（仅页面所有者）、`acl`（ACL 列表中的用户和群组成员 + 所有者）。所有者（page.userId）在任何级别下 MUST 始终拥有完全访问权限。ACL 列表中的条目 SHALL 支持用户 ID（如 `"userA"`）和群组引用（如 `"group:team-name"`）两种格式。

#### Scenario: 所有者始终有权限
- **WHEN** 访问控制的 level 为 `authenticated` 且请求的 visitorId 等于 page.userId
- **THEN** 访问被允许

#### Scenario: ACL 包含群组引用且用户是成员
- **WHEN** level 为 `acl` 且 ACL 包含 `"group:team"` 且当前用户是 team 群组成员
- **THEN** 访问被允许

#### Scenario: ACL 包含群组引用但用户不是成员
- **WHEN** level 为 `acl` 且 ACL 仅包含 `"group:team"` 且当前用户不是 team 群组成员且不是所有者
- **THEN** 返回 HTTP 403

### Requirement: 页面级访问控制

每个页面 SHALL 可选配置 `pageAccess` 字段控制谁能访问该页面（包括静态文件和 CRUD API）。未配置时 MUST 默认为 `{ level: "public" }`。

#### Scenario: 页面配置为 public
- **WHEN** 页面的 `pageAccess.level` 为 `"public"` 且访问者未登录
- **THEN** 允许访问页面静态文件和 CRUD API

#### Scenario: 页面配置为 authenticated
- **WHEN** 页面的 `pageAccess.level` 为 `"authenticated"` 且访问者已登录
- **THEN** 允许访问

#### Scenario: 页面配置为 authenticated 但未登录
- **WHEN** 页面的 `pageAccess.level` 为 `"authenticated"` 且访问者未登录
- **THEN** 返回 HTTP 401

#### Scenario: 页面配置为 owner
- **WHEN** 页面的 `pageAccess.level` 为 `"owner"` 且访问者 visitorId 等于 page.userId
- **THEN** 允许访问

#### Scenario: 页面配置为 owner 但非所有者
- **WHEN** 页面的 `pageAccess.level` 为 `"owner"` 且访问者 visitorId 不等于 page.userId
- **THEN** 返回 HTTP 403

#### Scenario: 页面配置为 acl 且用户在列表中
- **WHEN** 页面的 `pageAccess.level` 为 `"acl"` 且访问者 visitorId 在 `pageAccess.acl` 数组中
- **THEN** 允许访问

#### Scenario: 页面配置为 acl 但用户不在列表中
- **WHEN** 页面的 `pageAccess.level` 为 `"acl"` 且访问者 visitorId 不在 `pageAccess.acl` 数组中且不是所有者
- **THEN** 返回 HTTP 403

#### Scenario: 未配置 pageAccess
- **WHEN** 页面的 meta.json 中不包含 `pageAccess` 字段
- **THEN** 视为 `{ level: "public" }`，任何人可访问

### Requirement: 路由级访问控制

每个 DataSchema SHALL 可选配置 `routeAccess` 字段，独立控制该资源的四种 CRUD 操作权限。未配置时 MUST 默认为 `{ read: "public", create: "public", update: "public", delete: "public" }`。

#### Scenario: Schema 配置 read=public, create=authenticated
- **WHEN** Schema 的 `routeAccess` 为 `{ read: "public", create: "authenticated" }` 且未登录用户请求 `GET /serve/alice/app/api/comments`
- **THEN** 允许读取

#### Scenario: 路由级拦截未授权写操作
- **WHEN** Schema 的 `routeAccess.create` 为 `"authenticated"` 且未登录用户请求 `POST /serve/alice/app/api/comments`
- **THEN** 返回 HTTP 401

#### Scenario: 路由级 owner 检查
- **WHEN** Schema 的 `routeAccess.delete` 为 `"owner"` 且 visitorId 不等于 page.userId
- **THEN** 返回 HTTP 403

#### Scenario: 路由级 ACL 检查
- **WHEN** Schema 的 `routeAccess.update` 为 `"acl"` 且 visitorId 在 `routeAccess.acl` 数组中
- **THEN** 允许更新

#### Scenario: 未配置 routeAccess
- **WHEN** Schema 不包含 `routeAccess` 字段
- **THEN** 四种操作均视为 `"public"`

### Requirement: 双层检查顺序

访问控制 MUST 按页面级优先、路由级其次的顺序执行。页面级检查不通过时 MUST 直接拒绝，不进入路由级检查。

#### Scenario: 页面级通过但路由级拒绝
- **WHEN** 页面 `pageAccess.level` 为 `"public"` 且 Schema `routeAccess.create` 为 `"authenticated"` 且访问者未登录
- **THEN** 页面级通过，路由级拒绝，返回 HTTP 401

#### Scenario: 页面级直接拒绝
- **WHEN** 页面 `pageAccess.level` 为 `"authenticated"` 且访问者未登录
- **THEN** 返回 HTTP 401，不执行 CRUD 操作

### Requirement: 访问策略管理接口

Schema CRUD 接口 MUST 支持读写 `routeAccess` 字段。Page CRUD 接口 MUST 支持读写 `pageAccess` 字段。

#### Scenario: 创建 Schema 时指定 routeAccess
- **WHEN** 发送 `POST /api/schemas` 携带 `routeAccess: { read: "public", create: "authenticated", update: "owner", delete: "owner" }`
- **THEN** Schema 创建成功，`routeAccess` 按指定值存储

#### Scenario: 更新页面 pageAccess
- **WHEN** 发送 `PUT /api/pages/:name` 携带 `pageAccess: { level: "authenticated" }`
- **THEN** 页面 `pageAccess` 更新为指定值

### Requirement: meta.db.defaultAccess 作为 RouteAccess fallback

当 Schema 未配置 `routeAccess` 时，系统 MUST fallback 到 meta.json 中 `db.defaultAccess` 的对应操作级别。若 meta.json 也未配置 `db` 或 `defaultAccess` 中缺少对应操作级别，则 SHALL 使用 `"public"` 作为最终 fallback。Schema 配置了 `routeAccess` 时，Schema 的配置优先。

#### Scenario: Schema 未配置时使用 meta.db fallback

- **WHEN** Schema 不包含 `routeAccess` 字段且 meta.db.defaultAccess 为 `{ "delete": "owner" }` 且非 owner 用户请求 DELETE
- **THEN** 返回 HTTP 403

#### Scenario: Schema 和 meta.db 均未配置

- **WHEN** Schema 不包含 `routeAccess` 且 meta.json 无 `db` 字段（或 defaultAccess 为空）
- **THEN** 所有操作视为 `"public"`

#### Scenario: Schema 配置优先级高于 meta.db

- **WHEN** Schema 配置了 `routeAccess.delete = "owner"` 且 meta.db.defaultAccess 配置了 `delete = "authenticated"`
- **THEN** 使用 Schema 的 `"owner"`，非 owner 用户 DELETE 返回 403

### Requirement: Raw SQL 端点 sqlAccess 检查

系统 SHALL 对 raw SQL 端点应用 meta.db.sqlAccess 级别的访问控制。sqlAccess 为 `owner` 时仅页面所有者可执行 raw SQL，为 `authenticated` 时仅登录用户可执行，为 `public` 时任何人可执行。所有者（visitorId === ownerId）在任何级别下 MUST 始终有权限。

#### Scenario: sqlAccess 为 owner 时所有者可执行

- **WHEN** meta.db.sqlAccess 为 `owner` 且 visitorId 等于 page.userId
- **THEN** raw SQL 请求被允许

#### Scenario: sqlAccess 为 owner 时非所有者被拒

- **WHEN** meta.db.sqlAccess 为 `owner` 且 visitorId 不等于 page.userId
- **THEN** 返回 HTTP 403

#### Scenario: sqlAccess 为 authenticated 时登录用户可执行

- **WHEN** meta.db.sqlAccess 为 `authenticated` 且 visitorId 存在（已登录）
- **THEN** raw SQL 请求被允许

#### Scenario: sqlAccess 为 authenticated 时未登录被拒

- **WHEN** meta.db.sqlAccess 为 `authenticated` 且 visitorId 为 null
- **THEN** 返回 HTTP 401

### Requirement: 记录级访问控制策略

系统 SHALL 在现有页面级和路由级访问控制之外支持记录级访问控制策略，用于根据记录字段、当前用户和状态条件判断 read、update、delete 等操作。

#### Scenario: 访问控制顺序
- **WHEN** CRUD 请求进入访问控制流程
- **THEN** 系统 SHALL 按页面级、路由级、记录级的顺序执行访问控制检查

#### Scenario: 页面级拒绝时不执行记录级检查
- **WHEN** 页面级访问控制拒绝请求
- **THEN** 系统 SHALL 直接返回 401 或 403，且不得继续读取业务记录进行记录级判断

### Requirement: 记录级策略支持字段匹配当前用户

记录级访问策略 SHALL 支持通过记录字段匹配当前用户 ID 或用户名，以表达“只能看自己创建的记录”“只能处理分配给自己的记录”等场景。

#### Scenario: ownerField 匹配当前用户
- **WHEN** 记录级策略声明某字段必须等于当前用户 ID
- **AND** 目标记录该字段等于当前用户 ID
- **THEN** 系统 SHALL 允许该记录级操作

#### Scenario: ownerField 不匹配当前用户
- **WHEN** 记录级策略声明某字段必须等于当前用户 ID
- **AND** 目标记录该字段不等于当前用户 ID
- **THEN** 系统 SHALL 拒绝该记录级操作

### Requirement: 记录级策略支持状态条件

记录级访问策略 SHALL 支持基于状态字段的条件限制，以表达“草稿可编辑、已提交不可编辑、待审批可处理”等业务规则。

#### Scenario: 状态符合条件
- **WHEN** 记录级策略要求 `status` 位于允许状态集合中
- **AND** 目标记录的状态在该集合中
- **THEN** 系统 SHALL 继续执行字段匹配或其他记录级判断

#### Scenario: 状态不符合条件
- **WHEN** 记录级策略要求 `status` 位于允许状态集合中
- **AND** 目标记录的状态不在该集合中
- **THEN** 系统 SHALL 拒绝该记录级操作

### Requirement: transition 执行受访问控制保护

transition 查询和执行 SHALL 先通过页面级访问控制和路由级读取权限检查；执行 transition 时还 SHALL 校验 transition 自身访问策略。

#### Scenario: 页面级访问控制拒绝
- **WHEN** 当前用户无法访问页面
- **THEN** transition 查询和执行端点 SHALL 返回 401 或 403，且不得读取或修改业务记录

#### Scenario: transition 访问策略拒绝
- **WHEN** 当前用户可读取记录但不满足 transition 的访问策略
- **THEN** 查询端点 SHALL 不返回该 transition，执行端点 SHALL 返回 HTTP 403

### Requirement: transition 支持记录字段访问策略

transition 访问策略 SHALL 支持基于记录字段匹配当前用户，以表达"创建者可提交""负责人可处理"等业务动作权限。

#### Scenario: 创建者可提交
- **WHEN** transition 访问策略要求 `created_by` 等于当前用户 ID
- **AND** 目标记录的 `created_by` 等于当前用户 ID
- **THEN** 系统 SHALL 允许执行该 transition

#### Scenario: 非创建者不可提交
- **WHEN** transition 访问策略要求 `created_by` 等于当前用户 ID
- **AND** 目标记录的 `created_by` 不等于当前用户 ID
- **THEN** 系统 SHALL 拒绝执行该 transition
