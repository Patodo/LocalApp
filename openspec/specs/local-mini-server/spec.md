# local-mini-server Specification

## Purpose
TBD - created by archiving change local-mini-server-and-sql-migrations. Update Purpose after archive.
## Requirements
### Requirement: localapp dev 启动本地 mini-server

`localapp dev` 命令 SHALL 在启动 vite dev server 之前,先 spawn 一个 Node.js 子进程运行 `runtime/mini-server.mjs`。mini-server 提供应用层 API(`/api/<resource>`、`/api/_schemas`、`/api/me`、`/api/upload`),数据写入 `.localapp/dev.db`。

mini-server SHALL 由 server-core 提供核心逻辑(schema、CRUD、权限),行为与生产 server 一致。LLM 请求(`/api/llm/*`)SHALL NOT 由 mini-server 处理,继续走生产 server。平台公共数据请求(`/api/platform/*`)SHALL 由 mini-server 处理：有 API key 时优先转发到生产 server 并提供 5 分钟 TTL 缓存；无 API key 或生产 server 不可用时返回稳定本地 mock。

mini-server 端口 SHALL 随机分配(避免与 vite 或其他进程冲突),写入 `dev-config.json` 的 `miniServerPort` 字段。vite-plugin 读取该字段配置 proxy target。

#### Scenario: localapp dev 启动 mini-server 和 vite 两个进程
- **WHEN** 用户执行 `localapp dev`
- **THEN** CLI 先 spawn Node 子进程运行 `runtime/mini-server.mjs`,分配随机端口
- **AND** mini-server 启动后,把端口号写入 `.localapp/dev-config.json` 的 `miniServerPort` 字段
- **AND** CLI 随后 spawn Vite 开发脚本（优先 `npm run dev:vite`，旧项目回退 `npm run dev`）,vite-plugin 读 `miniServerPort` 配置 proxy
- **AND** 终端打印 mini-server 和 vite 的状态行

#### Scenario: mini-server 应用未应用的 migrations
- **WHEN** mini-server 启动,检测到 `.localapp/dev.db` 存在
- **AND** 项目 `migrations/` 目录有未被 dev.db 应用的 migration 文件
- **THEN** mini-server 在启动时按文件名数字顺序应用 pending migrations
- **AND** 应用记录写入 dev.db 的 `_localapp_applied_migrations` 表

#### Scenario: dev.db 不存在时创建并应用所有 migrations
- **WHEN** mini-server 启动,检测到 `.localapp/dev.db` 不存在
- **THEN** mini-server 创建空 dev.db,应用 `migrations/` 目录下所有 migration 文件
- **AND** 如果存在 `db/seeds/dev.sql`,在所有 migration 应用后执行 seed

#### Scenario: 应用层 API 走本地 mini-server
- **WHEN** 浏览器请求 `/api/tasks`(或任何非 `/api/llm/*`、非 `/api/platform/*` 的 API)
- **THEN** vite-plugin 转发到 mini-server(localhost:<miniServerPort>)
- **AND** mini-server 从 dev.db 读/写数据,返回响应

#### Scenario: LLM 走生产 server,平台数据走 mini-server 缓存
- **WHEN** 浏览器请求 `/api/llm/chat`
- **THEN** vite-plugin 转发到生产 server(dev-config.json 的 `serverUrl`)
- **AND** mini-server 不参与该请求
- **WHEN** 浏览器请求 `/api/platform/users`
- **THEN** vite-plugin 转发到 mini-server(localhost:<miniServerPort>)
- **AND** mini-server 转发到生产 server,返回并缓存结果 5 分钟

#### Scenario: 未登录时平台数据使用本地 mock
- **WHEN** `localapp dev` 在未登录状态启动，dev-config 的 `apiKey` 为空
- **AND** 浏览器请求 `/api/platform/users`、`/api/platform/groups`、`/api/platform/roles` 或 `/api/platform/version`
- **THEN** mini-server SHALL 不请求生产 server
- **AND** 返回 `{ success: true, data: ... }` 形状的稳定本地 mock 数据
- **AND** 应用不得因为缺少平台连接而无法本地运行

#### Scenario: 本地开发请求不返回 HTML 给 SDK
- **WHEN** 应用在本地开发中请求 `/api/users` 或 DevShell 请求 `/api/dev/users`
- **AND** 平台 server 未连接或 dev-config 的 `serverUrl` 为空
- **THEN** 请求 SHALL 由 mini-server 返回 JSON
- **AND** 前端 SHALL 显示可读的本地 mini-server 连接提示，而不是暴露 `Unexpected token '<'`

#### Scenario: mini-server 随机端口避免冲突
- **WHEN** mini-server 启动
- **THEN** 在 5174-5200 范围内尝试寻找空闲端口
- **AND** 找到空闲端口后写入 dev-config.json
- **AND** 如果范围内所有端口都被占用,打印错误并退出

#### Scenario: dev 进程退出时 mini-server 也退出
- **WHEN** 用户按 Ctrl+C 或localapp dev 进程被 kill
- **THEN** mini-server 子进程也立即退出
- **AND** dev.db 文件保持完整(无 corruption)

### Requirement: mini-server 实现 dev context 驱动的 /api/me

mini-server SHALL 实现 `GET /api/me` 端点，并从当前 dev context 读取模拟用户。默认 context SHALL 返回 `dev-user`，以保持既有 dev 模式兼容；当 context user 为 `null` 时，`/api/me` SHALL 返回未登录响应。

#### Scenario: 默认 dev 模式 useMe 返回 dev-user
- **WHEN** 应用通过 `useMe` hook 在 dev 模式下查询当前用户
- **THEN** mini-server 返回 `{ id: "dev-user", name: "Dev User", role: "owner" }`
- **AND** 不需要 API key 鉴权(dev 模式)

#### Scenario: 切换用户后 /api/me 返回当前 dev context user
- **WHEN** DevShell 将 dev context user 切换为 `alice`
- **THEN** 后续 `GET /api/me` SHALL 返回 `alice`

#### Scenario: 未登录 context 返回未登录
- **WHEN** DevShell 将 dev context user 设置为 `null`
- **THEN** 后续 `GET /api/me` SHALL 返回未登录响应

#### Scenario: 应用层 defaultFrom 使用当前 dev context user
- **WHEN** 应用通过 useCreate 创建记录,字段含 `defaultFrom: "currentUser.id"`
- **AND** 当前 dev context user 为 `alice`
- **THEN** mini-server 把对应字段填充为 `"alice"`
- **AND** 与生产模式行为一致(只是 visitor 来自 dev context)

### Requirement: mini-server 实现本地 /api/upload

mini-server SHALL 实现 `POST /api/upload` 端点,把上传的文件存储到 `.localapp/dev-uploads/`,返回 `{ key, url }`。url 指向 mini-server 自己的端点 `/dev-uploads/<key>`。

#### Scenario: dev 模式文件上传到本地
- **WHEN** 应用通过 `useUpload` hook 上传图片
- **THEN** mini-server 接收文件,保存到 `.localapp/dev-uploads/<key>`
- **AND** 返回 `{ key: "<uuid>.<ext>", url: "/dev-uploads/<uuid>.<ext>" }`
- **AND** 应用可以通过该 url 访问文件(由 mini-server 提供)

#### Scenario: dev-uploads 目录自动创建
- **WHEN** 第一次上传文件
- **THEN** mini-server 自动创建 `.localapp/dev-uploads/` 目录(如果不存在)

### Requirement: mini-server 维护 dev context

mini-server SHALL 维护本地 dev context，并通过 `/api/dev/context` 提供读取和更新接口。dev context SHALL 包含当前模拟用户和当前开发时间模式。默认用户 SHALL 为 `dev-user`，默认时间模式 SHALL 为真实时间。

#### Scenario: 读取默认 dev context
- **WHEN** DevShell 请求 `GET /api/dev/context`
- **THEN** mini-server SHALL 返回默认用户 `dev-user`
- **AND** 时间模式 SHALL 为真实时间

#### Scenario: 更新 dev context
- **WHEN** DevShell 请求 `PUT /api/dev/context` 并提交新的用户或时间模式
- **THEN** mini-server SHALL 校验 payload
- **AND** 后续业务 API SHALL 使用更新后的 dev context

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

### Requirement: mini-server 提供本地数据管理 API

mini-server SHALL 通过 `/api/dev/data` 提供 reset、snapshot 和 restore 能力。所有文件操作 SHALL 限制在项目 `.localapp/` 目录下，reset SHALL 重建 `.localapp/dev.db` 并重新应用 migrations 和 `db/seeds/dev.sql`。

#### Scenario: reset 重建 dev.db
- **WHEN** DevShell 请求本地数据 reset
- **THEN** mini-server SHALL 关闭现有 SQLite 连接
- **AND** 重建 `.localapp/dev.db`
- **AND** 重新应用 migrations 和 dev seed

#### Scenario: snapshot 保存当前 dev.db
- **WHEN** DevShell 请求创建 snapshot
- **THEN** mini-server SHALL 将当前 `.localapp/dev.db` 复制到 `.localapp/dev-snapshots/`
- **AND** 返回 snapshot id 和创建时间

#### Scenario: restore 恢复指定 snapshot
- **WHEN** DevShell 请求恢复指定 snapshot
- **THEN** mini-server SHALL 用该 snapshot 覆盖当前 `.localapp/dev.db`
- **AND** 后续 API 读取 SHALL 使用恢复后的数据

### Requirement: mini-server 记录开发诊断信息

mini-server SHALL 记录本地开发诊断信息，包括最近请求的 method、path、status、duration 和截断 body 摘要。mini-server SHALL 通过 `/api/dev/diagnostics` 提供诊断读取接口，并通过 `/api/dev/business` 暴露当前 manifest 的业务规则摘要。

#### Scenario: 记录最近请求
- **WHEN** mini-server 处理任意本地 API 请求
- **THEN** mini-server SHALL 将请求摘要写入有限长度的 ring buffer
- **AND** body 摘要 SHALL 被截断以避免过大响应

#### Scenario: 读取诊断信息
- **WHEN** DevShell 请求 `GET /api/dev/diagnostics`
- **THEN** mini-server SHALL 返回最近请求摘要
- **AND** 响应 SHALL 包含可用于排查本地行为的状态和耗时信息

#### Scenario: 读取业务规则摘要
- **WHEN** DevShell 请求 `GET /api/dev/business`
- **THEN** mini-server SHALL 返回 manifest 中的 `recordAccess`、`defaultFields`、`transitions` 和 `enums` 摘要

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

### Requirement: Mini-server uses backend contract executor

本地 mini-server SHALL read the same backend contract files as production and SHALL use shared server-core logic for named SQL validation and execution.

#### Scenario: local query matches production
- **WHEN** a registered named query is called in `localapp dev`
- **THEN** mini-server MUST apply the same params validation, access checks, system variables and SQL safety rules as production server

#### Scenario: backend contract changes locally
- **WHEN** developer edits backend contract files during local development
- **THEN** mini-server MUST reload or re-read the updated contract consistently with existing dev refresh behavior

### Requirement: Mini-server rejects frontend SQL for named endpoints

本地 mini-server SHALL reject attempts to submit SQL text to named query / mutation endpoints.

#### Scenario: local request includes sql field
- **WHEN** frontend code calls local named SQL endpoint with a `sql` field
- **THEN** mini-server MUST NOT execute that frontend-supplied SQL

### Requirement: mini-server rejects hosted actions
mini-server SHALL 在 dev 模式下提供 `/api/actions/:name` legacy endpoint，并与生产 server 一样拒绝 hosted actions。

#### Scenario: dev 模式调用 action
- **WHEN** 应用在 `localapp dev` 下调用 `client.action("leave.approve", { id: 1 })`
- **THEN** vite proxy MUST 将请求转发到 mini-server
- **AND** mini-server MUST return `hosted_actions_disabled`
- **AND** mini-server MUST NOT build or execute local backend action code

### Requirement: dev/prod action API 表面一致
mini-server 和生产 server SHALL 使用同一应用 API 契约识别 action endpoint，且不得在 dev 模式下暴露生产不存在的 action 行为。

#### Scenario: dev action endpoint returns same disabled code
- **WHEN** dev 应用调用任意 action name
- **THEN** mini-server MUST 返回与生产 server 一致的 `hosted_actions_disabled`
