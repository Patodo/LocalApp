## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the client-sdk capability in LocalApp.
## Requirements
### Requirement: SDK 包结构

`init-repo/src/lib/localapp/` SHALL 作为 SDK 的唯一源码位置，包含 `client.ts`（底层 HTTP 客户端）、`react.ts`（React Hook）、`index.ts`（统一导出）、`types.ts`（类型定义）。`packages/client/` 包 SHALL 被移除。运行时依赖仅 `react`（peerDependency）和浏览器内置 `fetch`。

`client.ts` SHALL 定义 `LocalAppError` 类继承 `Error`，携带 `status: number` 字段。`request()` 函数在非 2xx 响应时 SHALL 抛出 `LocalAppError` 而非 `Error`。

`index.ts` SHALL 额外导出 `LocalAppError` 类和 `redirectToLogin` 函数。

#### Scenario: 包结构验证
- **WHEN** 查看 `init-repo/src/lib/localapp/` 目录
- **THEN** 包含 `client.ts`、`react.ts`、`index.ts`、`types.ts`

#### Scenario: packages/client 不存在
- **WHEN** 查看 `packages/` 目录
- **THEN** 不包含 `client` 子目录

#### Scenario: 零运行时依赖
- **WHEN** 查看 `init-repo/package.json`
- **THEN** SDK 相关代码无额外 npm 依赖，仅使用 react 和浏览器内置 API

#### Scenario: LocalAppError 导出
- **WHEN** 从 `./lib/localapp` 导入 `LocalAppError`
- **THEN** `LocalAppError` 是 `Error` 的子类，构造函数接受 `message: string` 和 `status: number`

#### Scenario: redirectToLogin 导出
- **WHEN** 从 `./lib/localapp` 导入 `redirectToLogin`
- **THEN** 它是一个无参数函数，调用后将外层窗口跳转到 `/login?redirect=...`

### Requirement: basePath 自动检测

SDK 的 `createClient()` 函数 SHALL 自动检测应用 API basePath。检测顺序 SHALL 为：优先读取平台 Shell 注入的 native app resource base（如 `[data-localapp-app-resource-base]` 或等价元数据），当该 base 指向 `/serve/{userId}/{name}/` 时，basePath SHALL 解析为 `/serve/{userId}/{name}/api`；其次兼容应用直接运行在 raw route `/serve/{userId}/{name}/` 下的 pathname 检测；最后回退为 `/api`。`/api/me` 路径 SHALL 固定使用 `/api/me`，不依赖 basePath。

#### Scenario: native Shell 内自动检测
- **WHEN** 应用在正式 Shell route `/alice/my-app/` 中运行
- **AND** 页面注入的 native app resource base 为 `/serve/alice/my-app/`
- **THEN** `createClient()` 自动设置 basePath 为 `/serve/alice/my-app/api`

#### Scenario: raw route 兼容检测
- **WHEN** 应用直接运行在 raw route，`window.location.pathname` 为 `/serve/alice/my-app/index.html`
- **THEN** `createClient()` 自动设置 basePath 为 `/serve/alice/my-app/api`
- **AND** 该场景 SHALL 被视为 raw route 兼容，不代表默认用户验收入口

#### Scenario: 根路径访问
- **WHEN** 应用直接在根路径运行，`window.location.pathname` 为 `/`
- **THEN** `createClient()` 设置 basePath 为 `/api`

### Requirement: useMe Hook

SDK SHALL 提供 `useMe()` Hook，调用 `GET /api/me` 获取当前访客身份。返回 `{ me: User | null, loading: boolean, error: LocalAppError | null }`。请求失败时 `loading` SHALL 归位为 `false`，`error` SHALL 为错误对象。请求成功时 `error` SHALL 为 `null`。

#### Scenario: 已登录用户
- **WHEN** 浏览器携带有效 session cookie 调用 `useMe()`
- **THEN** `me` 为 `{ id: "alice", name: "alice" }`，`loading` 最终为 `false`，`error` 为 `null`

#### Scenario: 未登录用户
- **WHEN** 浏览器不携带 cookie 调用 `useMe()`
- **THEN** `me` 为 `null`，`loading` 最终为 `false`，`error` 为 `null`

#### Scenario: 请求失败（网络错误）
- **WHEN** `/api/me` 请求失败（如网络断开）
- **THEN** `me` 为 `null`，`loading` 最终为 `false`，`error` 为 `LocalAppError` 实例

### Requirement: useList Hook

`useList<T>(resource, options?)` Hook SHALL 调用 `client.query('$<resource>.list', params)` 获取列表数据。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

未声明 `$<resource>.list` named SQL 时，Hook SHALL 直接抛出 `LocalAppError`（status 为服务端返回的 404，message 含 named SQL 名字），不得隐式切换到其它路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.list` named SQL 且参数合法
- **THEN** useList SHALL 调用该 named SQL 并返回 rows + pagination

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.list` named SQL
- **THEN** useList SHALL 抛出 LocalAppError
- **AND** 错误信息 MUST 提示该 named SQL 缺失
- **AND** 不得发起任何 REST CRUD 请求

### Requirement: useGet Hook

`useGet<T>(resource, id)` Hook SHALL 调用 `client.query('$<resource>.get', { id })` 获取单条记录。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.get` named SQL 且参数合法
- **THEN** useGet SHALL 返回该记录

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.get` named SQL
- **THEN** useGet SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `GET /api/<resource>/:id`

### Requirement: useCreate Hook

`useCreate<T>(resource)` Hook 返回的 mutate 函数 SHALL 调用 `client.mutate('$<resource>.create', data)`。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.create` named SQL 且参数合法
- **THEN** useCreate SHALL 返回新建记录

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.create` named SQL
- **THEN** useCreate SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `POST /api/<resource>`

### Requirement: useUpdate Hook

`useUpdate<T>(resource)` Hook 返回的 mutate 函数 SHALL 调用 `client.mutate('$<resource>.update', { id, ...data })`。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.update` named SQL 且参数合法
- **THEN** useUpdate SHALL 返回更新后的记录

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.update` named SQL
- **THEN** useUpdate SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `PUT /api/<resource>/:id`

### Requirement: useDelete Hook

`useDelete(resource)` Hook 返回的 mutate 函数 SHALL 调用 `client.mutate('$<resource>.delete', { id })`。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.delete` named SQL 且参数合法
- **THEN** useDelete SHALL 完成删除

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.delete` named SQL
- **THEN** useDelete SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `DELETE /api/<resource>/:id`

### Requirement: useCount Hook

`useCount(resource, filters?)` Hook SHALL 调用 `client.query('$<resource>.count', filters)` 获取计数。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径或 list-then-count 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.count` named SQL 且参数合法
- **THEN** useCount SHALL 返回数字类型的计数

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.count` named SQL
- **THEN** useCount SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `GET /api/<resource>/count` 或 list 模拟计数

### Requirement: SDK 测试位置

SDK 单元测试 SHALL 位于 `init-repo/src/lib/localapp/__tests__/` 目录，使用 init-repo 已有的 vitest 环境。测试 SHALL 覆盖 client、react hooks、mutations、redirect 等功能。

#### Scenario: 测试文件存在
- **WHEN** 查看 `init-repo/src/lib/localapp/__tests__/` 目录
- **THEN** 包含 `client.test.ts`、`react.test.ts`、`mutations.test.ts`、`redirect.test.ts`

#### Scenario: 测试可运行
- **WHEN** 在 `init-repo/` 目录执行 `npm test`
- **THEN** 所有 SDK 测试通过

### Requirement: LocalAppError 错误类

SDK SHALL 提供 `LocalAppError` 类，继承 `Error`，额外携带 `status: number` 字段表示 HTTP 状态码。`client.ts` 的 `request()` 函数在响应非 2xx 时 SHALL 抛出 `LocalAppError`，message 为服务端返回的 error 字段或 `HTTP {status}`。

#### Scenario: 401 错误
- **WHEN** API 返回 `{ success: false, error: "Authentication required" }` 且 HTTP 状态码为 401
- **THEN** `request()` 抛出 `LocalAppError`，`message` 为 `"Authentication required"`，`status` 为 `401`

#### Scenario: 非 LocalAppError 的异常
- **WHEN** fetch 本身抛出异常（如网络断开）
- **THEN** hooks 内部将非 `LocalAppError` 异常包装为 `LocalAppError`，`status` 为 `0`

### Requirement: redirectToLogin 工具函数

SDK SHALL 提供 `redirectToLogin()` 函数，无参数。调用时 SHALL 请求当前 same-page shell 原地打开平台登录框；Shell SHALL 保存当前同源应用路径，并在登录成功后继续访问该路径。没有 Shell 处理请求时 SHALL 回退到平台首页。

#### Scenario: native app 内调用
- **WHEN** 应用在 native app 中运行并调用 `redirectToLogin()`
- **THEN** Shell 在当前页面打开登录框，不先离开应用
- **AND** 登录成功后重新访问调用时的同源应用路径

#### Scenario: 非 native app 环境调用
- **WHEN** 当前页面没有 Shell 处理登录请求
- **THEN** `window.location.href` 被设置为 `/`

#### Scenario: DevShell 内调用
- **WHEN** 应用在 DevShell 中以未登录身份调用 `redirectToLogin()`
- **THEN** DevShell 在当前页面打开开发身份选择面板
- **AND** 选择身份后应用收到更新后的开发用户上下文

### Requirement: useUpload Hook

SDK SHALL 提供 `useUpload()` Hook，返回 `{ upload: (file: File) => Promise<UploadResult>, loading: boolean, error: LocalAppError | null }`。`upload` 函数将文件以 `multipart/form-data` 形式 POST 到 `{basePath}/content/upload`。

`UploadResult` 类型 SHALL 为 `{ key: string; url: string }`。

#### Scenario: 成功上传图片
- **WHEN** 调用 `upload(file)` 且 file 为 PNG 图片
- **THEN** 请求 `POST {basePath}/content/upload`，body 为 `FormData` 包含该文件，返回 `{ key: "abc123.png", url: "/serve/.../api/content/abc123.png" }`

#### Scenario: 上传中 loading 状态
- **WHEN** `upload(file)` 正在执行
- **THEN** `loading` 为 `true`

#### Scenario: 上传完成 loading 归位
- **WHEN** `upload(file)` 执行完成（成功或失败）
- **THEN** `loading` 为 `false`

#### Scenario: 上传失败
- **WHEN** 服务端返回 401
- **THEN** Promise reject，`error` 为 `LocalAppError` 且 `status === 401`

#### Scenario: 文件类型不支持
- **WHEN** 服务端返回 400 (unsupported file type)
- **THEN** Promise reject，`error` 为 `LocalAppError` 且 `status === 400`

#### Scenario: 文件过大
- **WHEN** 服务端返回 413
- **THEN** Promise reject，`error` 为 `LocalAppError` 且 `status === 413`

### Requirement: SDK 方法必须有服务端契约

`LocalAppClient` 暴露的每个公开方法 SHALL 对应一个开发态和生产态均可用的服务端契约。SDK 测试 SHALL 验证请求路径，运行时契约测试 SHALL 验证 mini-server 与生产 serve 至少覆盖同一组应用 API。

#### Scenario: count 方法有 dev/prod 端点
- **WHEN** 应用调用 `client.count("posts")`
- **THEN** SDK SHALL 请求 `{basePath}/posts/count`
- **AND** mini-server 和生产 serve SHALL 均支持该路径

#### Scenario: upload 方法使用内容 API
- **WHEN** 应用调用 `client.upload(file)`
- **THEN** SDK SHALL 请求 `{basePath}/content/upload`
- **AND** mini-server 和生产 serve SHALL 均支持该路径

#### Scenario: me 方法解析标准响应
- **WHEN** 应用调用 `client.me()`
- **THEN** SDK SHALL 解析 `{ success: true, data: User | null }`
- **AND** 不得依赖开发态裸对象响应

### Requirement: SDK count 兼容旧运行时

SDK `count()` MUST 调用 `$<resource>.count` named SQL；未声明该 named SQL 时 SHALL 直接抛出 `LocalAppError`。SDK SHALL NOT 在 named SQL 缺失时降级到 list 路径或 REST count 端点。

#### Scenario: 命名 SQL 已声明
- **WHEN** 应用声明了 `$posts.count` named SQL
- **THEN** `client.count("posts")` SHALL 通过 named SQL 返回计数
- **AND** 不得发起额外 list 请求

#### Scenario: 命名 SQL 未声明
- **WHEN** 应用未声明 `$posts.count` named SQL
- **THEN** `client.count("posts")` SHALL 抛出 `LocalAppError`
- **AND** 不得降级到 list 模拟计数

#### Scenario: 权限错误不降级
- **WHEN** named SQL 返回 401 或 403
- **THEN** `client.count("posts")` SHALL 抛出 `LocalAppError`
- **AND** 不得用 list 降级绕过权限错误

### Requirement: availableTransitions 纯函数

SDK SHALL 提供 `availableTransitions(resource, record)` 纯函数，根据 schema 的 `business.transitions` 元数据结合 record 当前状态本地计算可执行的 transitions 列表。

函数 SHALL：
- 从 schema 读取 `business.transitions` 和 `business.statusField`
- 取 record 中 `statusField` 指示的当前状态
- 过滤 `from` 数组包含当前状态的 transitions
- 返回 `[{ name, label, to }]` 列表

函数 SHALL NOT 发起任何网络请求。所有计算在客户端完成。

#### Scenario: 当前状态匹配多个 transitions

- **WHEN** record 当前状态为 `pending`
- **AND** schema 声明了 `approve`（from: ["pending"]）和 `reject`（from: ["pending"]）两个 transitions
- **THEN** 函数 SHALL 返回 `[{ name: "approve", ... }, { name: "reject", ... }]`

#### Scenario: 当前状态无可用 transition

- **WHEN** record 当前状态为 `approved`
- **AND** schema 声明的 transitions 中没有任何 `from` 包含 `approved`
- **THEN** 函数 SHALL 返回空数组

#### Scenario: schema 未声明 transitions

- **WHEN** schema 不包含 `business.transitions`
- **THEN** 函数 SHALL 返回空数组
- **AND** 不得抛出错误

### Requirement: SDK exposes named query and mutation calls

SDK SHALL expose first-class methods for calling registered named SQL APIs without accepting SQL text from the frontend.

#### Scenario: call named query
- **WHEN** app code calls `client.query(name, params)`
- **THEN** SDK MUST POST params to `/api/queries/:name`

#### Scenario: call named mutation
- **WHEN** app code calls `client.mutate(name, params)`
- **THEN** SDK MUST POST params to `/api/mutations/:name`

### Requirement: SDK keeps resource API compatibility

SDK SHALL keep existing resource API method names while resolving resource operations through backend contract named SQL endpoints.

#### Scenario: existing app calls list
- **WHEN** existing app code calls `client.list(resource)`
- **THEN** SDK MUST preserve existing call shape and return shape
- **AND** the call SHALL resolve through the corresponding `$<resource>.list` named SQL endpoint

### Requirement: client.action legacy helper is unsupported
SDK MAY keep `client.action<T = unknown>(name: string, input?: unknown): Promise<T>` for source compatibility, but it SHALL NOT be documented as a stable recommended backend integration path.

#### Scenario: native app 内调用 action
- **WHEN** 应用运行在 `/serve/alice/leave-form/`
- **AND** 调用 `client.action("leave.approve", { id: 1 })`
- **THEN** SDK MAY 请求 `POST /serve/alice/leave-form/api/actions/leave.approve`
- **AND** 请求体 MUST 为 `{ "input": { "id": 1 } }`

#### Scenario: action disabled response
- **WHEN** server 返回非 2xx 或 `{ success: false, code: "hosted_actions_disabled" }`
- **THEN** `client.action()` MUST 抛出 `LocalAppError`

### Requirement: SDK does not recommend hosted action calls
The SDK and generated app guidance SHALL NOT present hosted action calls as the default stable backend integration path.

#### Scenario: SDK public API documentation
- **WHEN** developers read SDK documentation or generated template guidance
- **THEN** examples MUST use `client.query`, `client.mutate`, transaction mutation helpers, or resource hooks
- **AND** examples MUST NOT recommend hosted action calls for ordinary business logic

#### Scenario: SDK transaction result references
- **WHEN** developers need to pass an earlier transaction step result into a later mutation parameter
- **THEN** the SDK MUST provide a typed helper for constructing supported transaction result references
- **AND** generated guidance MUST show how to reference `lastInsertRowId` for create-then-child-write flows

#### Scenario: action call helper exists from older runtime
- **WHEN** legacy SDK code still exposes an action-call helper
- **THEN** documentation MUST mark it unsupported or experimental
- **AND** runtime errors from disabled action endpoints MUST surface as `LocalAppError` with the stable disabled capability code when available

### Requirement: useAction legacy hook is unsupported
React SDK MAY keep `useAction<TInput, TResult>(name)` Hook for source compatibility, but docs and examples SHALL prefer `useQuery()` and `useMutation()`.

#### Scenario: 调用 action 时 loading
- **WHEN** `run(input)` 正在执行
- **THEN** `loading` MUST 为 `true`

#### Scenario: action 调用完成
- **WHEN** `run(input)` 成功或失败
- **THEN** `loading` MUST 归位为 `false`

#### Scenario: action 调用失败
- **WHEN** action endpoint 返回 `hosted_actions_disabled`
- **THEN** `error` MUST 为 `LocalAppError`
