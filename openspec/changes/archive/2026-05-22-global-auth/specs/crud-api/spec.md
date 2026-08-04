## MODIFIED Requirements

### Requirement: CRUD API 路由

CRUD API 路径 SHALL 使用 name 替代 pageId 作为页面标识。路由模式为 `/serve/{userId}/{name}/api/{resource}[/:id][/count]`。每个 CRUD 请求 MUST 执行双层访问控制检查（页面级优先，路由级其次）。

#### Scenario: 列表查询
- **WHEN** 请求 `GET /serve/user1/my-app/api/todos`
- **THEN** 返回该页面的 todos 资源列表（通过页面级和路由级 read 权限检查后）

#### Scenario: 单条查询
- **WHEN** 请求 `GET /serve/user1/my-app/api/todos/1`
- **THEN** 返回对应记录

#### Scenario: 创建记录
- **WHEN** 请求 `POST /serve/user1/my-app/api/todos` 携带数据且通过路由级 create 权限检查
- **THEN** 创建记录并返回

#### Scenario: 更新记录
- **WHEN** 请求 `PUT /serve/user1/my-app/api/todos/1` 携带数据且通过路由级 update 权限检查
- **THEN** 更新记录并返回

#### Scenario: 删除记录
- **WHEN** 请求 `DELETE /serve/user1/my-app/api/todos/1` 且通过路由级 delete 权限检查
- **THEN** 删除记录并返回确认

#### Scenario: 计数查询
- **WHEN** 请求 `GET /serve/user1/my-app/api/todos/count`
- **THEN** 返回记录总数

#### Scenario: 页面不存在
- **WHEN** 请求 `GET /serve/user1/nonexistent/api/todos`
- **THEN** 返回 HTTP 404

### Requirement: CRUD API 访问控制

CRUD API 端点 SHALL 不要求 `X-API-Key` header，但 MUST 从 session cookie 提取访客身份（visitorId，可为 null）并执行访问控制检查。未配置访问策略时 MUST 默认允许所有请求。

#### Scenario: 无 cookie 访问 public 资源
- **WHEN** 不携带 cookie 请求 `GET /serve/user1/abc/api/todos` 且页面和路由策略均为 public
- **THEN** 正常返回数据

#### Scenario: 无 cookie 访问需认证资源
- **WHEN** 不携带 cookie 请求 `POST /serve/user1/abc/api/todos` 且 `routeAccess.create` 为 `"authenticated"`
- **THEN** 返回 HTTP 401

#### Scenario: 已登录用户访问 ACL 资源
- **WHEN** 携带有效 cookie（visitorId=bob）请求 `GET /serve/alice/app/api/votes` 且 `routeAccess.read` 为 `"acl"` 且 `routeAccess.acl` 包含 "bob"
- **THEN** 正常返回数据
