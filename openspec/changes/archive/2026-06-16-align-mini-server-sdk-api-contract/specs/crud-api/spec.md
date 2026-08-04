## ADDED Requirements

### Requirement: CRUD HTTP 契约由共享层定义

CRUD API 的 HTTP 路由解析、响应包装、过滤参数处理、count 语义和 transition 分派 SHALL 由共享应用 API 契约层定义。生产 serve 和 mini-server SHALL 通过各自 adapter 复用该共享层，避免出现同一 SDK 方法在两种运行时行为不同。

#### Scenario: list 响应形态一致
- **WHEN** dev 和 prod 分别处理同一 `GET /api/tasks` 等价请求
- **THEN** 响应 SHALL 都包含 `{ success: true, data, pagination }`

#### Scenario: count 路由解析一致
- **WHEN** dev 和 prod 分别处理同一 `GET /api/tasks/count` 等价请求
- **THEN** 两者 SHALL 都进入 count 分支
- **AND** 不得把 `count` 解析为记录 id

### Requirement: CRUD count 与 list 的过滤和权限一致

CRUD API SHALL 提供 `GET /api/{resource}/count`，并保证开发态 mini-server 与生产态 serve 的过滤、recordAccess read 策略和错误响应一致。`count` SHALL 不受 `offset`、`limit`、`sort`、`order` 影响。

#### Scenario: count 与 list total 一致
- **WHEN** 同一 visitor 请求 `GET /api/tasks?status=open&limit=1`
- **AND** 随后请求 `GET /api/tasks/count?status=open`
- **THEN** count 响应中的 `data.count` SHALL 等于列表响应 `pagination.total`

#### Scenario: count 忽略分页参数
- **WHEN** 请求 `GET /api/tasks/count?status=open&offset=10&limit=5&sort=id&order=desc`
- **THEN** 系统 SHALL 忽略 `offset`、`limit`、`sort` 和 `order`
- **AND** 仅按业务过滤条件统计记录数

#### Scenario: count 应用 read 权限
- **WHEN** schema 声明 recordAccess.read 只允许当前用户读取自己的记录
- **THEN** `GET /api/tasks/count` SHALL 只统计当前用户可读的记录

### Requirement: 保留平台端点优先级

CRUD 路由 SHALL 在平台端点、内容端点、raw SQL 端点和 dev 专用端点之后匹配，避免将保留路径误解释为应用资源。

#### Scenario: content 不进入 CRUD
- **WHEN** 请求 `POST /api/content/upload`
- **THEN** 系统 SHALL 命中内容上传端点
- **AND** 不得尝试查找名为 `content` 的资源

#### Scenario: users 不进入 CRUD
- **WHEN** 请求 `GET /api/users`
- **THEN** 系统 SHALL 命中平台用户端点
- **AND** 不得尝试查找名为 `users` 的资源
