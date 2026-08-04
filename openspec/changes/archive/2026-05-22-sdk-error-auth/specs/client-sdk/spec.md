## MODIFIED Requirements

### Requirement: SDK 包结构

`packages/client/` SHALL 作为 `@localapp/client` 包纳入 pnpm workspace，包含 `src/client.ts`（底层 HTTP 客户端）、`src/react.ts`（React Hook）、`src/index.ts`（统一导出）、`src/types.ts`（类型定义）。运行时依赖仅 `react`（peerDependency）和浏览器内置 `fetch`。

`client.ts` SHALL 定义 `LocalAppError` 类继承 `Error`，携带 `status: number` 字段。`request()` 函数在非 2xx 响应时 SHALL 抛出 `LocalAppError` 而非 `Error`。

`index.ts` SHALL 额外导出 `LocalAppError` 类和 `redirectToLogin` 函数。

#### Scenario: 包结构验证
- **WHEN** 查看 `packages/client/` 目录
- **THEN** 包含 `src/client.ts`、`src/react.ts`、`src/index.ts`、`src/types.ts`、`package.json`、`tsconfig.json`

#### Scenario: 零运行时依赖
- **WHEN** 查看 `packages/client/package.json`
- **THEN** `dependencies` 为空，`peerDependencies` 仅包含 `react`

#### Scenario: LocalAppError 导出
- **WHEN** 从 `@localapp/client` 导入 `LocalAppError`
- **THEN** `LocalAppError` 是 `Error` 的子类，构造函数接受 `message: string` 和 `status: number`

#### Scenario: redirectToLogin 导出
- **WHEN** 从 `@localapp/client` 导入 `redirectToLogin`
- **THEN** 它是一个无参数函数，调用后将外层窗口跳转到 `/login?redirect=...`

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

SDK SHALL 提供 `useList(resource, options?)` Hook，调用 `GET {basePath}/{resource}` 获取列表数据。返回 `{ rows: T[], pagination: { offset, limit, total }, loading, error, refresh }`。请求失败时 `loading` SHALL 归位为 `false`，`error` SHALL 为错误对象。请求成功时 `error` SHALL 为 `null`。

#### Scenario: 基本列表查询
- **WHEN** 调用 `useList('posts')`
- **THEN** 请求 `GET {basePath}/posts`，返回 `rows` 数组和 `pagination` 对象，`error` 为 `null`

#### Scenario: 带筛选条件的查询
- **WHEN** 调用 `useList('posts', { filters: { status: 'published' } })`
- **THEN** 请求 `GET {basePath}/posts?status=published`

#### Scenario: 带分页和排序的查询
- **WHEN** 调用 `useList('posts', { offset: 10, limit: 5, sort: 'created_at', order: 'desc' })`
- **THEN** 请求 `GET {basePath}/posts?offset=10&limit=5&sort=created_at&order=desc`

#### Scenario: 手动刷新
- **WHEN** 调用 `refresh()` 函数
- **THEN** 重新发起请求，更新 `rows` 和 `pagination`

#### Scenario: 请求被 401 拒绝
- **WHEN** 服务端返回 401（需要认证）
- **THEN** `rows` 为空数组，`loading` 为 `false`，`error` 为 `LocalAppError` 且 `status === 401`

#### Scenario: 请求被 403 拒绝
- **WHEN** 服务端返回 403（无权限）
- **THEN** `rows` 为空数组，`loading` 为 `false`，`error` 为 `LocalAppError` 且 `status === 403`

### Requirement: useGet Hook

SDK SHALL 提供 `useGet(resource, id)` Hook，调用 `GET {basePath}/{resource}/{id}` 获取单条记录。返回 `{ row: T | null, loading: boolean, error: LocalAppError | null }`。请求失败时 `loading` SHALL 归位为 `false`，`error` SHALL 为错误对象。

#### Scenario: 查询存在的记录
- **WHEN** 调用 `useGet('posts', 1)` 且记录存在
- **THEN** 请求 `GET {basePath}/posts/1`，`row` 为对应记录对象，`error` 为 `null`

#### Scenario: 查询不存在的记录
- **WHEN** 调用 `useGet('posts', 999)` 且记录不存在
- **THEN** `row` 为 `null`

#### Scenario: 请求失败
- **WHEN** 服务端返回 401
- **THEN** `row` 为 `null`，`loading` 为 `false`，`error` 为 `LocalAppError` 且 `status === 401`

### Requirement: useCount Hook

SDK SHALL 提供 `useCount(resource, filters?)` Hook，调用 `GET {basePath}/{resource}/count` 获取记录数。返回 `{ count: number, loading: boolean, error: LocalAppError | null }`。请求失败时 `loading` SHALL 归位为 `false`，`error` SHALL 为错误对象。

#### Scenario: 基本计数
- **WHEN** 调用 `useCount('posts')`
- **THEN** 请求 `GET {basePath}/posts/count`，返回 `{ count: number }`，`error` 为 `null`

#### Scenario: 带筛选条件的计数
- **WHEN** 调用 `useCount('posts', { status: 'published' })`
- **THEN** 请求 `GET {basePath}/posts/count?status=published`

#### Scenario: 请求失败
- **WHEN** 服务端返回 401
- **THEN** `count` 为 `0`，`loading` 为 `false`，`error` 为 `LocalAppError` 且 `status === 401`

## ADDED Requirements

### Requirement: LocalAppError 错误类

SDK SHALL 提供 `LocalAppError` 类，继承 `Error`，额外携带 `status: number` 字段表示 HTTP 状态码。`client.ts` 的 `request()` 函数在响应非 2xx 时 SHALL 抛出 `LocalAppError`，message 为服务端返回的 error 字段或 `HTTP {status}`。

#### Scenario: 401 错误
- **WHEN** API 返回 `{ success: false, error: "Authentication required" }` 且 HTTP 状态码为 401
- **THEN** `request()` 抛出 `LocalAppError`，`message` 为 `"Authentication required"`，`status` 为 `401`

#### Scenario: 非 LocalAppError 的异常
- **WHEN** fetch 本身抛出异常（如网络断开）
- **THEN** hooks 内部将非 `LocalAppError` 异常包装为 `LocalAppError`，`status` 为 `0`

### Requirement: redirectToLogin 工具函数

SDK SHALL 提供 `redirectToLogin()` 函数，无参数。调用时 SHALL 将 `window.parent`（若存在）或 `window` 的 `location.href` 设置为 `/login?redirect=<当前页面 URL>`。redirect 参数 SHALL 使用 `encodeURIComponent` 编码。

#### Scenario: iframe 内调用
- **WHEN** 应用在 iframe 中运行，`window.parent !== window`
- **THEN** `window.parent.location.href` 被设置为 `/login?redirect=...`，外层 shell 跳转到登录页

#### Scenario: 非 iframe 环境调用
- **WHEN** 应用不在 iframe 中，`window.parent === window`
- **THEN** `window.location.href` 被设置为 `/login?redirect=...`
