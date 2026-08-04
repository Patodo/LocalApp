## MODIFIED Requirements

### Requirement: CRUD API 路由

CRUD API 路径 SHALL 使用 name 替代 pageId 作为页面标识。路由模式为 `/serve/{userId}/{name}/api/{resource}[/:id][/count]`。每个 CRUD 请求 MUST 执行双层访问控制检查（页面级优先，路由级其次）。

根路径 `/` SHALL 作为独立路由处理，不匹配 `/:userId/:name` 模式。

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

#### Scenario: 根路径不匹配页面路由
- **WHEN** 请求 `GET /`
- **THEN** 不进入 `/:userId/:name` 路由处理，而是命中独立的根路径重定向处理器
