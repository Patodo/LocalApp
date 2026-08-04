## ADDED Requirements

### Requirement: mini-server 维护 dev context
mini-server SHALL 在 dev 进程内维护 dev context，并通过 `/api/dev/context` 提供读取和更新接口。dev context SHALL 至少包含当前模拟用户、时间模式和固定时间。

#### Scenario: 读取默认 dev context
- **WHEN** DevShell 请求 `GET /api/dev/context`
- **THEN** mini-server SHALL 返回默认用户 `dev-user`
- **AND** 时间模式 SHALL 为真实时间

#### Scenario: 更新 dev context
- **WHEN** DevShell 请求 `PUT /api/dev/context` 并提交新的用户或固定时间
- **THEN** mini-server SHALL 校验 payload
- **AND** mini-server SHALL 更新当前 dev 进程内的 context
- **AND** 后续本地 API SHALL 使用更新后的 context

#### Scenario: 拒绝非 dev 路径
- **WHEN** 生产 server 收到 `/api/dev/context` 请求
- **THEN** 生产 server SHALL 不提供该端点

### Requirement: mini-server 使用 dev context 执行业务 API
mini-server SHALL 使用 dev context 生成当前 visitor 和当前业务时间。`/api/me`、CRUD、`defaultFrom`、`recordAccess`、transition access 和 transition `set` SHALL 使用同一份 visitor 和业务时间。

#### Scenario: 当前用户影响 defaultFrom
- **WHEN** dev context 当前用户为 `alice`
- **AND** 应用创建包含 `defaultFrom: "currentUser.id"` 的记录
- **THEN** mini-server SHALL 写入 `alice`

#### Scenario: 当前用户影响 recordAccess
- **WHEN** dev context 当前用户为 `bob`
- **AND** 表的 `recordAccess.read` 使用 owner 字段策略
- **THEN** mini-server SHALL 只返回 owner 字段匹配 `bob` 的记录

#### Scenario: 固定时间影响 now
- **WHEN** dev context 固定时间为 `2026-07-01T09:00:00.000Z`
- **AND** transition 声明 `set: { "reviewed_at": "now" }`
- **THEN** mini-server SHALL 写入 `2026-07-01T09:00:00.000Z`

### Requirement: mini-server 实现本地 transition API
mini-server SHALL 实现与生产应用 API 一致的记录级 transition 端点，包括 `GET /api/{resource}/{id}/transitions` 和 `POST /api/{resource}/{id}/transitions/{name}`。

#### Scenario: 查询本地可用 transitions
- **WHEN** 应用在 dev 模式请求 `GET /api/leaves/1/transitions`
- **THEN** mini-server SHALL 根据记录当前状态和 dev context visitor 返回可用 transitions

#### Scenario: 执行本地 transition
- **WHEN** 应用在 dev 模式请求 `POST /api/leaves/1/transitions/approve`
- **AND** 当前状态和 dev context visitor 满足 transition 规则
- **THEN** mini-server SHALL 更新状态字段和 `set` 字段
- **AND** 返回更新后的记录

#### Scenario: 无权执行 transition
- **WHEN** dev context visitor 不满足 transition access 策略
- **THEN** mini-server SHALL 返回 HTTP 403
- **AND** 不得修改记录

### Requirement: mini-server 提供本地数据管理 API
mini-server SHALL 提供 dev-only 数据管理 API，用于 reset、snapshot 和 restore `.localapp/dev.db`。这些 API SHALL 不访问生产 server。

#### Scenario: reset dev.db
- **WHEN** DevShell 请求 reset 本地数据
- **THEN** mini-server SHALL 关闭当前 SQLite 连接
- **AND** 删除并重建 `.localapp/dev.db`
- **AND** 重新应用 migrations 和 `db/seeds/dev.sql`

#### Scenario: snapshot dev.db
- **WHEN** DevShell 请求保存快照
- **THEN** mini-server SHALL 将当前 `.localapp/dev.db` 复制到 `.localapp/dev-snapshots/`
- **AND** 返回 snapshot id 和创建时间

#### Scenario: restore dev.db snapshot
- **WHEN** DevShell 请求恢复指定 snapshot
- **THEN** mini-server SHALL 关闭当前 SQLite 连接
- **AND** 用 snapshot 覆盖 `.localapp/dev.db`
- **AND** 重新打开数据库连接

### Requirement: mini-server 记录开发诊断信息
mini-server SHALL 在内存中记录最近的本地 API 请求诊断信息，并通过 dev-only API 提供给 DevShell。诊断信息 SHALL 限制数量并截断请求/响应摘要。

#### Scenario: 记录最近请求
- **WHEN** 应用请求 mini-server 的本地 API
- **THEN** mini-server SHALL 记录 method、path、status、duration 和截断 body 摘要

#### Scenario: 查询最近请求
- **WHEN** DevShell 请求诊断 API
- **THEN** mini-server SHALL 返回最近请求列表
- **AND** 不得返回完整大体积文件上传内容

## MODIFIED Requirements

### Requirement: mini-server 实现 mock /api/me

mini-server SHALL 实现 `GET /api/me` 端点，返回 dev context 中的当前模拟用户。当 dev context 未设置时，mini-server SHALL 使用默认用户 `dev-user`。当 dev context 当前用户为 `null` 时，mini-server SHALL 按未登录状态响应，并保持与 SDK 对未登录用户的兼容行为。

#### Scenario: dev 模式 useMe 返回默认 mock 用户
- **WHEN** 应用通过 `useMe` hook 在 dev 模式中查询当前用户
- **AND** 开发者没有修改 dev context
- **THEN** mini-server SHALL 返回 `{ id: "dev-user", name: "Dev User", role: "owner" }`
- **AND** 不需要 API key 鉴权

#### Scenario: dev 模式 useMe 返回切换后的用户
- **WHEN** DevShell 将 dev context 当前用户切换为 `alice`
- **AND** 应用通过 `useMe` 查询当前用户
- **THEN** mini-server SHALL 返回 `alice`

#### Scenario: dev 模式 useMe 返回未登录状态
- **WHEN** DevShell 将 dev context 当前用户切换为未登录
- **AND** 应用通过 `useMe` 查询当前用户
- **THEN** mini-server SHALL 返回未登录响应
- **AND** 需要当前用户的业务操作 SHALL 按未登录 visitor 校验

#### Scenario: 应用层 created_by 自动填充为当前 dev context 用户
- **WHEN** 应用通过 useCreate 创建记录，字段含 `defaultFrom: "currentUser.id"`
- **AND** dev context 当前用户为 `bob`
- **THEN** mini-server SHALL 把 `created_by` 字段填充为 `"bob"`
- **AND** 与生产模式行为一致，只是 userId 来自 dev context
