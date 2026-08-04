## MODIFIED Requirements

### Requirement: 生产 serve 与 mini-server 共享应用 API 契约层

生产 server 和 dev mini-server SHALL 共享同一份应用 API 契约（`packages/server-core/src/lib/app-api-contract.ts`），且该契约 SHALL 仅识别以下端点类别：平台辅助（time/me/users/groups/groups/:id/platform/*）、内容（content/upload、content/:key）、schemas 自省（_schemas）、named SQL（queries/:name、mutations/:name）。

契约 SHALL NOT 识别 resource 风格的隐式 CRUD 路径、transition 路径、raw SQL 路径（`/db/exec`）或 legacy upload 路径（`/upload`）。

#### Scenario: dev 模式不暴露 REST CRUD

- **WHEN** dev 模式下应用通过 SDK 调用 `GET /api/tasks`
- **THEN** mini-server SHALL 返回 404
- **AND** 不得回落到隐式 CRUD 路由

#### Scenario: dev 模式 named SQL 正常工作

- **WHEN** dev 模式下应用调用 `POST /api/queries/$tasks.list`
- **AND** 应用声明了该 named SQL
- **THEN** mini-server SHALL 执行该 named SQL 并返回结果

#### Scenario: dev 与 prod API 表面一致

- **WHEN** 同一应用在 dev 模式和 prod 模式下被访问
- **THEN** 两端 SHALL 返回相同的 API 表面（仅平台辅助 + 内容 + schemas + named SQL）

### Requirement: mini-server 使用 dev context 执行业务 API

mini-server SHALL 使用 dev context（当前 dev 用户、当前时间等）执行 named SQL，并将 dev context 中的身份注入 named SQL 的系统变量（`currentUser.id`、`currentUser.name`、`now` 等）。

mini-server SHALL NOT 为前端暴露 REST CRUD 路径或 transition 路径。

#### Scenario: named SQL 注入 dev 用户

- **WHEN** dev 模式下应用调用引用 `:currentUser.id` 的 named SQL
- **THEN** mini-server SHALL 使用 dev context 中的当前用户 ID 绑定该变量

#### Scenario: dev 模式 mock 鉴权保留

- **WHEN** dev 模式下 named SQL 请求到达 mini-server
- **THEN** mini-server SHALL 不要求 API key 鉴权（本地信任）
- **AND** 当前用户固定为 dev context 中的用户（role=owner）

## REMOVED Requirements

### Requirement: mini-server 实现本地 transition API

**Reason**: transition 服务端执行入口整体移除。mini-server 不再需要实现本地 transition 查询/执行端点。

**Migration**: 前端通过 SDK 的 `availableTransitions(resource, record)` 本地纯函数计算可用动作，通过 `client.mutate('$<resource>.<action>', { id, ... })` 执行流转。

### Requirement: mini-server 支持应用资源计数

**Reason**: REST count 端点（`GET /api/<resource>/count`）已移除。该 requirement 描述的是 mini-server 对 REST count 的支持。

**Migration**: 应用声明 `$<resource>.count` named SQL。mini-server 通过 named SQL 通用路径支持计数。

### Requirement: mini-server 支持 raw SQL 执行端点

**Reason**: raw SQL 端点（`POST /api/db/exec`）整体移除。

**Migration**: 应用通过 named SQL 执行所有数据操作。开发期需要直接观察数据库时，开发者可以直接操作 SQLite 文件。
