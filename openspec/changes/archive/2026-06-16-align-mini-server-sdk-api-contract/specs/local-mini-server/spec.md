## ADDED Requirements

### Requirement: 生产 serve 与 mini-server 共享应用 API 契约层

生产 serve 和 mini-server SHALL 复用同一套应用 API 契约处理逻辑。共享层 SHALL 至少统一 CRUD、count、transition、raw SQL、time 的路由解析、响应包装、过滤参数处理和错误形态。生产和开发运行时差异 SHALL 通过 adapter 或 provider 注入，不得复制整套 HTTP 分发逻辑。

#### Scenario: 新增应用 API 只需修改共享层
- **WHEN** LocalApp 新增一个 SDK 公开的应用 API 端点
- **THEN** 实现 SHALL 优先落在共享应用 API 契约层
- **AND** 生产 serve 与 mini-server SHALL 通过 adapter 复用该实现

#### Scenario: 路由优先级一致
- **WHEN** 请求 `/api/{resource}/count`、`/api/db/exec` 或 `/api/content/upload`
- **THEN** 生产 serve 和 mini-server SHALL 使用一致的保留路径优先级
- **AND** 不得在任一运行时中落入错误的 CRUD `{resource}/{id}` 分支

#### Scenario: 响应包装一致
- **WHEN** 共享层处理成功或失败响应
- **THEN** 生产 serve 与 mini-server SHALL 返回同构 JSON
- **AND** SDK SHALL 能用同一套解析逻辑处理两种运行时

### Requirement: mini-server 提供 SDK 应用 API 等价契约

mini-server SHALL 实现 `@localapp/sdk` 和 `@localapp/sdk-react` 面向应用公开的本地等价端点。除 `/api/llm/*` 等明确走生产 server 的端点外，开发态 `/api/*` SHALL 不因为缺少 mini-server 实现而落入错误的 CRUD fallback。

#### Scenario: SDK 公开端点在 dev 下可用
- **WHEN** 应用在 `localapp dev` 下调用 `useList`、`useGet`、`useCreate`、`useUpdate`、`useDelete`、`useCount`、`useMe`、`useUsers`、`useGroups`、`useUpload` 或 `useExec`
- **THEN** mini-server SHALL 返回与 SDK 期待一致的 `{ success, data }` 响应或标准错误响应
- **AND** 不得把平台端点或内容端点误解析为应用资源名

#### Scenario: 未实现端点返回明确错误
- **WHEN** 应用请求 SDK 未公开且 mini-server 未支持的 `/api/*` 端点
- **THEN** mini-server SHALL 返回明确的 404 JSON 错误
- **AND** 错误 SHALL 帮助开发者判断端点未受支持，而不是返回误导性的 `Invalid id`

### Requirement: mini-server 支持应用资源计数

mini-server SHALL 实现 `GET /api/{resource}/count`，返回 `{ success: true, data: { count } }`。计数 SHALL 使用与列表查询一致的过滤语义、资源校验、schema 推断和 recordAccess read 策略。

#### Scenario: 计数返回总数
- **WHEN** dev 应用请求 `GET /api/work_items/count`
- **THEN** mini-server SHALL 返回 `200`
- **AND** 响应 SHALL 为 `{ success: true, data: { count: <number> } }`

#### Scenario: 计数支持过滤
- **WHEN** dev 应用请求 `GET /api/work_items/count?status=active&owner_member_id=3`
- **THEN** mini-server SHALL 仅统计匹配过滤条件且当前 visitor 可读的记录

#### Scenario: 无读取权限时计数为零
- **WHEN** 当前 dev context user 无权读取任何目标资源记录
- **THEN** mini-server SHALL 返回 `{ success: true, data: { count: 0 } }`

### Requirement: mini-server 支持内容上传和读取路径

mini-server SHALL 支持 `POST /api/content/upload` 和 `GET /api/content/{key}`，并将内容存储在 `.localapp/dev-uploads/` 下。mini-server MAY 保留旧的 `POST /api/upload` 作为兼容别名，但 SDK 推荐路径 SHALL 为 `/api/content/upload`。

#### Scenario: SDK upload 在 dev 下可用
- **WHEN** 应用通过 `useUpload()` 上传文件
- **THEN** mini-server SHALL 接收 `multipart/form-data`
- **AND** 将文件保存到 `.localapp/dev-uploads/`
- **AND** 返回 `{ success: true, data: { key, url } }`

#### Scenario: 上传后可读取内容
- **WHEN** 上传响应中的 `url` 被浏览器访问
- **THEN** mini-server SHALL 返回对应文件内容和合适的 content-type

### Requirement: mini-server 支持 raw SQL 执行端点

mini-server SHALL 实现 `POST /api/db/exec`，使 `useExec()` 在本地开发中可用。该端点 SHALL 复用 server-core 的 SQL 执行、防护和持久化逻辑，并遵守 manifest 中的 `db.sqlAccess` 配置。

#### Scenario: dev 下执行查询 SQL
- **WHEN** 应用请求 `POST /api/db/exec`，body 为 `{ "sql": "SELECT COUNT(*) as cnt FROM work_items" }`
- **THEN** mini-server SHALL 返回 `{ success: true, data: { columns, rows } }`

#### Scenario: dev 下执行写入 SQL
- **WHEN** 应用请求 `POST /api/db/exec` 执行合法写入 SQL
- **THEN** mini-server SHALL 持久化 `.localapp/dev.db`
- **AND** 返回 changes 和 lastInsertRowId 信息

#### Scenario: raw SQL 访问受限
- **WHEN** manifest 的 `db.sqlAccess` 不允许当前 dev context user 执行 SQL
- **THEN** mini-server SHALL 返回 401 或 403
- **AND** 不得执行 SQL

### Requirement: mini-server 平台数据端点不得落入 CRUD fallback

mini-server SHALL 对 `/api/platform/*`、`/api/users`、`/api/groups` 和 `/api/groups/{id}` 使用平台数据处理路径。对于 `/api/platform/*`，mini-server SHALL 优先代理真实 server 并缓存；当代理不可用时 SHALL 返回稳定 mock 数据或明确错误。

#### Scenario: useUsers 不落入 CRUD
- **WHEN** dev 应用调用 `useUsers()`
- **THEN** 请求 `GET /api/users` SHALL 命中平台用户处理逻辑
- **AND** 不得被解释为名为 `users` 的应用数据表

#### Scenario: useGroups 不落入 CRUD
- **WHEN** dev 应用调用 `useGroups()`
- **THEN** 请求 `GET /api/groups` SHALL 命中平台分组处理逻辑
- **AND** 不得被解释为名为 `groups` 的应用数据表

#### Scenario: platform data 代理失败时有稳定行为
- **WHEN** dev 应用请求 `GET /api/platform/users` 且生产 server 不可达
- **THEN** mini-server SHALL 返回稳定 mock 数据或带有明确错误信息的 JSON 响应
- **AND** 不得进入应用 CRUD fallback
