## ADDED Requirements

### Requirement: SDK 包结构

`packages/client/` SHALL 作为 `@localapp/client` 包纳入 pnpm workspace，包含 `src/client.ts`（底层 HTTP 客户端）、`src/react.ts`（React Hook）、`src/index.ts`（统一导出）、`src/types.ts`（类型定义）。运行时依赖仅 `react`（peerDependency）和浏览器内置 `fetch`。

#### Scenario: 包结构验证
- **WHEN** 查看 `packages/client/` 目录
- **THEN** 包含 `src/client.ts`、`src/react.ts`、`src/index.ts`、`src/types.ts`、`package.json`、`tsconfig.json`

#### Scenario: 零运行时依赖
- **WHEN** 查看 `packages/client/package.json`
- **THEN** `dependencies` 为空，`peerDependencies` 仅包含 `react`

### Requirement: basePath 自动检测

SDK 的 `createClient()` 函数 SHALL 从 `window.location.pathname` 自动检测 API basePath。当应用运行在 `/serve/{userId}/{name}/` 路径下时，basePath SHALL 解析为 `/serve/{userId}/{name}/api`。`/api/me` 路径 SHALL 固定使用 `/api/me`，不依赖 basePath。

#### Scenario: iframe 内自动检测
- **WHEN** 应用在 iframe 中运行，`window.location.pathname` 为 `/serve/alice/my-app/index.html`
- **THEN** `createClient()` 自动设置 basePath 为 `/serve/alice/my-app/api`

#### Scenario: 根路径访问
- **WHEN** 应用直接在根路径运行，`window.location.pathname` 为 `/`
- **THEN** `createClient()` 设置 basePath 为 `/api`

### Requirement: useMe Hook

SDK SHALL 提供 `useMe()` Hook，调用 `GET /api/me` 获取当前访客身份。返回 `{ me: User | null, loading: boolean }`。

#### Scenario: 已登录用户
- **WHEN** 浏览器携带有效 session cookie 调用 `useMe()`
- **THEN** `me` 为 `{ id: "alice", name: "alice" }`，`loading` 最终为 `false`

#### Scenario: 未登录用户
- **WHEN** 浏览器不携带 cookie 调用 `useMe()`
- **THEN** `me` 为 `null`，`loading` 最终为 `false`

### Requirement: useList Hook

SDK SHALL 提供 `useList(resource, options?)` Hook，调用 `GET {basePath}/{resource}` 获取列表数据。返回 `{ rows: T[], pagination: { offset, limit, total }, loading, refresh }`。options 支持 `offset`、`limit`、`sort`、`order`、`filters`。

#### Scenario: 基本列表查询
- **WHEN** 调用 `useList('posts')`
- **THEN** 请求 `GET {basePath}/posts`，返回 `rows` 数组和 `pagination` 对象

#### Scenario: 带筛选条件的查询
- **WHEN** 调用 `useList('posts', { filters: { status: 'published' } })`
- **THEN** 请求 `GET {basePath}/posts?status=published`

#### Scenario: 带分页和排序的查询
- **WHEN** 调用 `useList('posts', { offset: 10, limit: 5, sort: 'created_at', order: 'desc' })`
- **THEN** 请求 `GET {basePath}/posts?offset=10&limit=5&sort=created_at&order=desc`

#### Scenario: 手动刷新
- **WHEN** 调用 `refresh()` 函数
- **THEN** 重新发起请求，更新 `rows` 和 `pagination`

### Requirement: useGet Hook

SDK SHALL 提供 `useGet(resource, id)` Hook，调用 `GET {basePath}/{resource}/{id}` 获取单条记录。返回 `{ row: T | null, loading }`。

#### Scenario: 查询存在的记录
- **WHEN** 调用 `useGet('posts', 1)` 且记录存在
- **THEN** 请求 `GET {basePath}/posts/1`，`row` 为对应记录对象

#### Scenario: 查询不存在的记录
- **WHEN** 调用 `useGet('posts', 999)` 且记录不存在
- **THEN** `row` 为 `null`

### Requirement: useCreate Hook

SDK SHALL 提供 `useCreate(resource)` Hook，返回 `{ create: (data) => Promise<T> }`。调用 `POST {basePath}/{resource}` 创建记录。

#### Scenario: 成功创建
- **WHEN** 调用 `create({ title: 'Hello' })`
- **THEN** 请求 `POST {basePath}/posts`，body 为 `{ title: 'Hello' }`，返回创建的记录

#### Scenario: 创建失败（字段校验）
- **WHEN** 调用 `create({})` 且服务端返回 400
- **THEN** Promise reject，包含服务端错误信息

### Requirement: useUpdate Hook

SDK SHALL 提供 `useUpdate(resource)` Hook，返回 `{ update: (id, data) => Promise<T> }`。调用 `PUT {basePath}/{resource}/{id}` 更新记录。

#### Scenario: 成功更新
- **WHEN** 调用 `update(1, { title: 'Updated' })`
- **THEN** 请求 `PUT {basePath}/posts/1`，body 为 `{ title: 'Updated' }`，返回更新后的记录

### Requirement: useDelete Hook

SDK SHALL 提供 `useDelete(resource)` Hook，返回 `{ remove: (id) => Promise<void> }`。调用 `DELETE {basePath}/{resource}/{id}` 删除记录。

#### Scenario: 成功删除
- **WHEN** 调用 `remove(1)`
- **THEN** 请求 `DELETE {basePath}/posts/1`，Promise resolve

### Requirement: useCount Hook

SDK SHALL 提供 `useCount(resource, filters?)` Hook，调用 `GET {basePath}/{resource}/count` 获取记录数。返回 `{ count: number, loading }`。

#### Scenario: 基本计数
- **WHEN** 调用 `useCount('posts')`
- **THEN** 请求 `GET {basePath}/posts/count`，返回 `{ count: number }`

#### Scenario: 带筛选条件的计数
- **WHEN** 调用 `useCount('posts', { status: 'published' })`
- **THEN** 请求 `GET {basePath}/posts/count?status=published`

### Requirement: SDK 同步脚本

项目根目录 SHALL 提供 `pnpm sync:sdk` 脚本，将 `packages/client/src/` 的内容复制到 `init-repo/src/lib/localapp/`。

#### Scenario: 执行同步脚本
- **WHEN** 在项目根目录执行 `pnpm sync:sdk`
- **THEN** `init-repo/src/lib/localapp/` 下的文件与 `packages/client/src/` 内容一致
