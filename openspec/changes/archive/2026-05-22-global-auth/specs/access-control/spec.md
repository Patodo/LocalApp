## ADDED Requirements

### Requirement: 访问控制级别定义

系统 SHALL 支持四种访问控制级别：`public`（任何人）、`authenticated`（仅登录用户）、`owner`（仅页面所有者）、`acl`（ACL 列表中的用户 + 所有者）。所有者（page.userId）在任何级别下 MUST 始终拥有完全访问权限。

#### Scenario: 所有者始终有权限
- **WHEN** 访问控制的 level 为 `authenticated` 且请求的 visitorId 等于 page.userId
- **THEN** 访问被允许

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
