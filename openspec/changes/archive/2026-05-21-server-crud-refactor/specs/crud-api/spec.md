## MODIFIED Requirements

### Requirement: 列表查询

`GET /serve/{userId}/{pageId}/api/{resource}` SHALL 返回指定资源的数据列表，支持分页、过滤和排序。

~`GET /api/{userId}/{pageId}/{resource}` SHALL 返回指定资源的数据列表，支持分页、过滤和排序。~

#### Scenario: 基本列表
- **WHEN** 请求 `GET /serve/user1/abc/api/todos`
- **THEN** 返回 `{ success: true, data: [...], pagination: { offset, limit, total } }`

#### Scenario: 分页查询
- **WHEN** 请求 `GET /serve/user1/abc/api/todos?offset=10&limit=5`
- **THEN** 返回第 11-15 条记录，pagination 中 total 为总行数

#### Scenario: 排序查询
- **WHEN** 请求 `GET /serve/user1/abc/api/todos?sort=created_at&order=desc`
- **THEN** 按 created_at 降序返回记录

#### Scenario: 过滤查询
- **WHEN** 请求 `GET /serve/user1/abc/api/todos?done=false`
- **THEN** 只返回 done 字段值为 false 的记录

#### Scenario: 资源不存在
- **WHEN** 请求的 resource 名称未定义 schema
- **THEN** 返回 HTTP 404，`{ success: false, error: "Resource not found" }`

### Requirement: 新增记录

`POST /serve/{userId}/{pageId}/api/{resource}` SHALL 创建一条新记录。

~`POST /api/{userId}/{pageId}/{resource}` SHALL 创建一条新记录。~

（其余 Scenario 不变：成功新增、timestamp 自动填充、超出单表行数限制、必填字段缺失）

### Requirement: 获取单条记录

`GET /serve/{userId}/{pageId}/api/{resource}/:id` SHALL 返回指定 ID 的记录。

~`GET /api/{userId}/{pageId}/{resource}/:id` SHALL 返回指定 ID 的记录。~

（其余 Scenario 不变：记录存在、记录不存在）

### Requirement: 更新记录

`PUT /serve/{userId}/{pageId}/api/{resource}/:id` SHALL 更新指定 ID 的记录，自动更新 `updated_at`。

~`PUT /api/{userId}/{pageId}/{resource}/:id` SHALL 更新指定 ID 的记录，自动更新 `updated_at`。~

（其余 Scenario 不变：成功更新、记录不存在）

### Requirement: 删除记录

`DELETE /serve/{userId}/{pageId}/api/{resource}/:id` SHALL 删除指定 ID 的记录。

~`DELETE /api/{userId}/{pageId}/{resource}/:id` SHALL 删除指定 ID 的记录。~

（其余 Scenario 不变：成功删除）

### Requirement: 计数

`GET /serve/{userId}/{pageId}/api/{resource}/count` SHALL 返回记录总数，支持过滤。

~`GET /api/{userId}/{pageId}/{resource}/count` SHALL 返回记录总数，支持过滤。~

（其余 Scenario 不变：总数、带过滤的计数）

### Requirement: CRUD API 无需鉴权

CRUD API 端点 SHALL 不要求 `X-API-Key` header，仅校验 pageId 存在。

（不变：无 API Key 访问 CRUD）

## REMOVED Requirements

### Requirement: 旧路径 CRUD 路由（已移除）

`/api/{userId}/{pageId}/{resource}` 路径格式已移除。所有 CRUD 操作使用 `/serve/{userId}/{pageId}/api/{resource}` 路径。
