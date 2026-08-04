## ADDED Requirements

### Requirement: 列表查询

`GET /api/{userId}/{pageId}/{resource}` SHALL 返回指定资源的数据列表，支持分页、过滤和排序。

#### Scenario: 基本列表
- **WHEN** 请求 `GET /api/user1/abc/todos`
- **THEN** 返回 `{ success: true, data: [...], pagination: { offset, limit, total } }`

#### Scenario: 分页查询
- **WHEN** 请求 `GET /api/user1/abc/todos?offset=10&limit=5`
- **THEN** 返回第 11-15 条记录，pagination 中 total 为总行数

#### Scenario: 排序查询
- **WHEN** 请求 `GET /api/user1/abc/todos?sort=created_at&order=desc`
- **THEN** 按 created_at 降序返回记录

#### Scenario: 过滤查询
- **WHEN** 请求 `GET /api/user1/abc/todos?done=false`
- **THEN** 只返回 done 字段值为 false 的记录

#### Scenario: 资源不存在
- **WHEN** 请求的 resource 名称未定义 schema
- **THEN** 返回 HTTP 404，`{ success: false, error: "Resource not found" }`

### Requirement: 新增记录

`POST /api/{userId}/{pageId}/{resource}` SHALL 创建一条新记录。

#### Scenario: 成功新增
- **WHEN** 发送 `POST /api/user1/abc/todos` 携带 `{ title: "test" }`
- **THEN** 插入记录，自动填充 id、created_at、updated_at，返回 `{ success: true, data: { id: 1, title: "test", created_at: "...", updated_at: "..." } }`

#### Scenario: timestamp 自动填充
- **WHEN** schema 定义包含 `created_at: { type: "timestamp" }`，请求 body 不包含该字段
- **THEN** 服务器自动填充当前 ISO 8601 时间字符串

#### Scenario: 超出单表行数限制
- **WHEN** 表中已有 10000 行，尝试新增
- **THEN** 返回 HTTP 403，`{ success: false, error: "Table row limit exceeded (10000)" }`

#### Scenario: 必填字段缺失
- **WHEN** schema 定义 `title` 为 required，请求 body 不包含 title
- **THEN** 返回 HTTP 400，`{ success: false, error: "Required field missing: title" }`

### Requirement: 获取单条记录

`GET /api/{userId}/{pageId}/{resource}/:id` SHALL 返回指定 ID 的记录。

#### Scenario: 记录存在
- **WHEN** 请求 `GET /api/user1/abc/todos/1`
- **THEN** 返回 `{ success: true, data: { id: 1, ... } }`

#### Scenario: 记录不存在
- **WHEN** 请求 `GET /api/user1/abc/todos/999` 且该 ID 不存在
- **THEN** 返回 HTTP 404，`{ success: false, error: "Record not found" }`

### Requirement: 更新记录

`PUT /api/{userId}/{pageId}/{resource}/:id` SHALL 更新指定 ID 的记录，自动更新 `updated_at`。

#### Scenario: 成功更新
- **WHEN** 发送 `PUT /api/user1/abc/todos/1` 携带 `{ done: true }`
- **THEN** 更新 done 字段，自动更新 updated_at，返回更新后的完整记录

#### Scenario: 记录不存在
- **WHEN** 更新不存在的 ID
- **THEN** 返回 HTTP 404，`{ success: false, error: "Record not found" }`

### Requirement: 删除记录

`DELETE /api/{userId}/{pageId}/{resource}/:id` SHALL 删除指定 ID 的记录。

#### Scenario: 成功删除
- **WHEN** 发送 `DELETE /api/user1/abc/todos/1`
- **THEN** 删除该记录，返回 `{ success: true, data: { deleted: true, id: 1 } }`

### Requirement: 计数

`GET /api/{userId}/{pageId}/{resource}/count` SHALL 返回记录总数，支持过滤。

#### Scenario: 总数
- **WHEN** 请求 `GET /api/user1/abc/todos/count`
- **THEN** 返回 `{ success: true, data: { count: 42 } }`

#### Scenario: 带过滤的计数
- **WHEN** 请求 `GET /api/user1/abc/todos/count?done=false`
- **THEN** 返回 `{ success: true, data: { count: 15 } }`（只计算 done=false 的记录）

### Requirement: CRUD API 无需鉴权

CRUD API 端点 SHALL 不要求 `X-API-Key` header，仅校验 pageId 存在。

#### Scenario: 无 API Key 访问 CRUD
- **WHEN** 不携带 API Key 请求 `GET /api/user1/abc/todos`
- **THEN** 正常返回数据，不返回 401
