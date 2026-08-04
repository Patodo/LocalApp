## Purpose

TBD — `@localapp/sdk` 核心 SDK 包，提供 `createClient()` 工厂函数、CRUD 操作、用户/组查询、文件上传、原始 SQL 执行和登录重定向功能，零运行时依赖。

## Requirements

### Requirement: 独立 npm 包

`@localapp/sdk` SHALL 作为一个独立的 npm 包存在于 monorepo 的 `packages/sdk-core/` 目录中。包的 `package.json` SHALL 声明 `"name": "@localapp/sdk"` 且无任何运行时依赖。包 SHALL 提供完整的 TypeScript 类型导出。

#### Scenario: 包可被 pnpm workspace 引用
- **WHEN** monorepo 中的其他包声明 `"@localapp/sdk": "workspace:*"` 依赖
- **THEN** pnpm 解析到 `packages/sdk-core/` 的本地包

#### Scenario: 包无运行时依赖
- **WHEN** 检查 `@localapp/sdk` 的 `package.json`
- **THEN** `dependencies` 字段为空或不存在

### Requirement: createClient 工厂函数

`@localapp/sdk` SHALL 导出 `createClient()` 工厂函数，返回 `LocalAppClient` 实例。客户端 SHALL 通过 `detectBasePath()` 自动检测当前页面的 API 路径。

#### Scenario: 在应用 native app 中自动检测 basePath
- **WHEN** 页面 URL 为 `/serve/user123/my-app/`
- **THEN** `detectBasePath()` 返回 `/serve/user123/my-app/api`

#### Scenario: 非应用页面中使用默认 basePath
- **WHEN** 页面 URL 不匹配 `/serve/` 模式
- **THEN** `detectBasePath()` 返回 `/api`

### Requirement: CRUD 操作

`LocalAppClient` SHALL 提供以下方法用于数据操作：

- `list(resource, options?)` — 分页查询，返回 `{ rows, pagination }`
- `get(resource, id)` — 按 ID 获取单条
- `create(resource, data)` — 创建新记录
- `update(resource, id, data)` — 更新记录
- `delete(resource, id)` — 删除记录
- `count(resource, filters?)` — 计数

所有方法 SHALL 在服务器返回非 2xx 时抛出 `LocalAppError`。

#### Scenario: 列出资源
- **WHEN** 调用 `client.list("todos", { offset: 0, limit: 10, sort: "created_at", order: "desc" })`
- **THEN** 向 `${basePath}/todos?offset=0&limit=10&sort=created_at&order=desc` 发送 GET 请求
- **THEN** 返回 `{ rows: [...], pagination: { offset, limit, total } }`

#### Scenario: 创建记录
- **WHEN** 调用 `client.create("todos", { title: "Buy milk" })`
- **THEN** 向 `${basePath}/todos` 发送 POST 请求，body 为 `{"title":"Buy milk"}`
- **THEN** 返回服务器创建后的完整记录（包含 id、created_at、updated_at）

#### Scenario: 请求失败时抛出错误
- **WHEN** 服务器返回 HTTP 400 及 `{ success: false, error: "Validation failed" }`
- **THEN** 抛出 `LocalAppError`，其 `message` 为 "Validation failed"，`status` 为 400

### Requirement: 用户和组查询

`LocalAppClient` SHALL 提供以下身份查询方法：

- `me()` — 当前登录用户信息
- `users()` — 平台用户列表
- `groups()` — 用户组列表
- `groupMembers(groupId)` — 组成员列表

#### Scenario: 未登录时 me 返回 null
- **WHEN** 当前访问者未登录
- **THEN** `client.me()` 返回 `null`

#### Scenario: 已登录时 me 返回用户信息
- **WHEN** 当前访问者已登录
- **THEN** `client.me()` 返回 `{ id: string, name: string }`

### Requirement: 文件上传

`LocalAppClient` SHALL 提供 `upload(file)` 方法用于文件上传。上传路径 SHALL 为 `${basePath}/content/upload`。

#### Scenario: 上传图片文件
- **WHEN** 调用 `client.upload(imageFile)`
- **THEN** 向 `${basePath}/content/upload` 发送 multipart POST 请求
- **THEN** 返回 `{ key: string, url: string }`

### Requirement: 原始 SQL 执行

`LocalAppClient` SHALL 提供 `exec(sql, params?)` 方法用于原始 SQL 执行（仅在 sql 模式页面可用）。

#### Scenario: 执行查询 SQL
- **WHEN** 调用 `client.exec("SELECT * FROM todos WHERE status = ?", ["done"])`
- **THEN** 向 `${basePath}/db/exec` 发送 POST 请求，body 为 `{ sql, params }`
- **THEN** 返回 `{ columns: [...], rows: [...] }`

### Requirement: 登录重定向

`@localapp/sdk` SHALL 导出 `redirectToLogin()` 函数。该函数 SHALL 请求当前 same-page shell 原地打开平台登录框；登录成功后 SHALL 继续访问调用时的同源应用路径。没有 Shell 处理请求时 SHALL 回退到平台首页。

#### Scenario: 在 native app 中调用登录重定向
- **WHEN** 页面运行在 native app 中，调用 `redirectToLogin()`
- **THEN** 当前 Shell 打开登录框且页面不离开应用
- **AND** 登录成功后重新访问当前应用 URL
