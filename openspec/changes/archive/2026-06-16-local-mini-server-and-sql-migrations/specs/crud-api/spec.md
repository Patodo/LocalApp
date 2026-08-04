## MODIFIED Requirements

### Requirement: CRUD API 路由

CRUD API 路由 SHALL 在 dev 模式下由 mini-server 提供,在 prod 模式下由生产 server 提供。两端共享 server-core 的核心实现,行为一致。

mini-server 的 CRUD 端点 SHALL 写入 `.localapp/dev.db`,生产 server 的 CRUD 端点 SHALL 写入 prod `app.db`。两端 SHALL NOT 跨越数据存储。

#### Scenario: dev 模式 CRUD 走本地
- **WHEN** dev 模式下应用通过 SDK 调用 `GET /api/tasks`
- **THEN** vite-plugin 转发请求到 mini-server
- **AND** mini-server 从 dev.db 读取 tasks 表
- **AND** 返回数据,跟 useList 接口一致

#### Scenario: prod 模式 CRUD 走生产
- **WHEN** 生产模式下(浏览器访问 /serve/<userId>/<page>/)应用调用 `/serve/<userId>/<page>/api/tasks`
- **THEN** 生产 server 处理,从 app.db 读
- **AND** 行为与 dev 一致(共享 server-core)

#### Scenario: dev 模式 mock 鉴权
- **WHEN** dev 模式下 CRUD 请求到达 mini-server
- **THEN** mini-server 不要求 API key 鉴权(假设本地信任)
- **AND** 当前用户固定为 "dev-user"(role=owner)
- **AND** recordAccess 检查时所有用户都视为 dev-user,owner 检查通过

#### Scenario: 平台数据走专属路由
- **WHEN** 应用调用 `/api/platform/users`
- **THEN** 请求走平台数据 API 路由(详见 platform-data-api spec)
- **AND** 不进入应用层 CRUD 路由

## ADDED Requirements

### Requirement: CRUD API 的字段元数据从 manifest.business 读取

server / mini-server SHALL 在执行 CRUD 时,从 manifest.json 的 business 块读取字段元数据:
- defaultFields(创建时自动填充)
- enums(创建/更新时验证)
- recordAccess(读/写/删时检查权限)

字段定义本身(类型、约束)由 SQL DDL 决定,业务规则由 manifest 声明。

#### Scenario: 创建记录时填充 defaultFields
- **WHEN** 应用 `useCreate("tasks")` 创建记录
- **AND** manifest.business.tasks.defaultFields 含 `created_by: { defaultFrom: "currentUser.id" }`
- **THEN** server 自动填充 `created_by = "<当前用户 id>"`
- **AND** 客户端传入的 created_by 值被忽略(防伪造)

#### Scenario: 更新记录时检查 recordAccess
- **WHEN** 应用 `useUpdate("tasks")` 更新记录
- **AND** manifest.business.tasks.recordAccess.update = "owner"
- **AND** 当前用户不是该记录的 owner
- **THEN** server 返回 403
- **AND** 错误 "Access denied. Only owner can update."
