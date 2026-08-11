## Purpose

应用层数据 API。原 RESTful CRUD 端点已全部移除，应用层数据通道统一为 named SQL（`/api/queries/:name`、`/api/mutations/:name`）。本 capability 描述统一 Server 在开发与正式部署中的同一 HTTP 契约。

## Requirements

### Requirement: CRUD HTTP 契约由共享层定义

应用 API 路由匹配（`matchAppApiRoute`）SHALL 仅识别以下端点类别：平台辅助（time/me/users/groups/groups/:id/platform/*）、内容（content/upload、content/:key）、schemas 自省（_schemas）、named SQL（queries/:name、mutations/:name）。路由匹配 SHALL NOT 识别 resource 风格的隐式 CRUD 路径（`/<resource>`、`/<resource>/:id`、`/<resource>/count`、`/<resource>/:id/transitions`、`/<resource>/:id/transitions/:name`）、raw SQL（`/db/exec`）或 legacy upload（`/upload`）。

Named SQL HTTP 契约 SHALL 由唯一 Server 路由实现；开发模式不得复制或适配另一套分发逻辑。

#### Scenario: 未识别路径返回 404

- **WHEN** 请求到达 `/serve/{user}/{app}/api/<unknown_resource>`
- **AND** 该路径不匹配任何已注册的 named SQL 或平台端点
- **THEN** 系统 SHALL 返回 HTTP 404
- **AND** 不得回落到隐式 CRUD 路由

#### Scenario: dev 与 prod 行为一致

- **WHEN** 同一应用在 `localapp dev` 和正式 Server 安装后被访问
- **THEN** 两端 SHALL 返回相同的 API 表面
- **AND** 都不得暴露 REST CRUD 路径

#### Scenario: 平台端点优先级保留

- **WHEN** 请求到达 `/serve/{user}/{app}/api/time` 或 `/serve/{user}/{app}/api/me`
- **THEN** 系统 SHALL 走平台辅助端点
- **AND** 不得被任何 resource 路径匹配拦截

### Requirement: Application CRUD is backed by backend contract

现有资源 CRUD SDK 方法 SHALL resolve to system named query / mutation definitions from the application backend contract.

#### Scenario: backend contract provides system list query
- **WHEN** a resource has a registered `$resource.list` query
- **THEN** `client.list(resource)` MUST call the corresponding named query endpoint

#### Scenario: backend contract missing system query
- **WHEN** a resource does not provide the corresponding system named endpoint
- **THEN** SDK/runtime MUST return a clear named SQL missing error
- **AND** SDK/runtime MUST NOT fall back to an implicit REST CRUD endpoint

### Requirement: System CRUD contract compatibility

系统 named CRUD definitions SHALL preserve the response shape expected by existing SDK resource methods.

#### Scenario: list response shape
- **WHEN** `client.list(resource)` is served by a system named query
- **THEN** response MUST include rows and pagination data compatible with existing list consumers

#### Scenario: count response shape
- **WHEN** `client.count(resource)` is served by a system named query
- **THEN** response MUST include `{ count }` compatible with existing count consumers
