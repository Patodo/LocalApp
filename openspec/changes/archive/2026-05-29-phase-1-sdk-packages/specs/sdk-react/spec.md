## ADDED Requirements

### Requirement: 独立 npm 包

`@localapp/sdk-react` SHALL 作为一个独立的 npm 包存在于 monorepo 的 `packages/sdk-react/` 目录中。包的 `package.json` SHALL 声明 `"name": "@localapp/sdk-react"`，`"@localapp/sdk"` 为 peerDependency，`"react"` 为 peerDependency。

#### Scenario: 包可被 pnpm workspace 引用
- **WHEN** monorepo 中的其他包声明 `"@localapp/sdk-react": "workspace:*"` 依赖
- **THEN** pnpm 解析到 `packages/sdk-react/` 的本地包

### Requirement: useList Hook

`useList<T>(resource, options?)` Hook SHALL 返回 `{ rows, pagination, loading, error, refresh }`。首次渲染时自动发起请求，`options` 变更时自动重新请求。`refresh()` 方法 SHALL 手动触发重新请求。

#### Scenario: 首次加载
- **WHEN** 组件首次渲染并调用 `useList("todos")`
- **THEN** `loading` 为 true，`rows` 为空数组
- **THEN** 请求完成后 `loading` 为 false，`rows` 包含返回数据

#### Scenario: 手动刷新
- **WHEN** 调用 `refresh()` 方法
- **THEN** 重新发起 GET 请求，`loading` 再次变为 true，数据更新

### Requirement: useGet Hook

`useGet<T>(resource, id)` Hook SHALL 返回 `{ row, loading, error }`。当 `id` 为 `null` 时不发起请求，`id` 变更时自动重新请求。

#### Scenario: id 为 null 时跳过
- **WHEN** 调用 `useGet("todos", null)`
- **THEN** `loading` 为 false，`row` 为 null，不发起网络请求

#### Scenario: id 有效时获取数据
- **WHEN** 调用 `useGet("todos", 42)`
- **THEN** 发起 GET 请求到 `${basePath}/todos/42`
- **THEN** `row` 包含返回的记录

### Requirement: useCreate / useUpdate / useDelete Hooks

- `useCreate<T>(resource)` SHALL 返回 `{ create }`。`create(data)` 方法 SHALL 发送 POST 请求并返回创建后的记录。
- `useUpdate<T>(resource)` SHALL 返回 `{ update }`。`update(id, data)` 方法 SHALL 发送 PUT 请求并返回更新后的记录。
- `useDelete(resource)` SHALL 返回 `{ remove }`。`remove(id)` 方法 SHALL 发送 DELETE 请求。

三个方法 SHALL 通过 `useCallback` 稳定引用，不依赖 data/id 参数。

#### Scenario: 创建记录后获取完整数据
- **WHEN** 调用 `create({ title: "New task" })`
- **THEN** 发送 POST 请求到 `${basePath}/todos`
- **THEN** 返回服务器创建的完整记录

### Requirement: useMe / useUsers / useGroups / useGroupMembers Hooks

- `useMe()` SHALL 返回 `{ me, loading, error }`
- `useUsers()` SHALL 返回 `{ users, loading, error }`
- `useGroups()` SHALL 返回 `{ groups, loading, error }`
- `useGroupMembers(groupId)` SHALL 返回 `{ members, loading, error }`

#### Scenario: useMe 获取当前用户
- **WHEN** 用户已登录，组件调用 `useMe()`
- **THEN** `me` 为 `{ id: string, name: string }`，`loading` 为 false

### Requirement: useUpload Hook

`useUpload()` SHALL 返回 `{ upload, loading, error }`。`upload(file)` 方法 SHALL 发送 multipart POST 请求并返回 `{ key, url }`。

#### Scenario: 上传文件
- **WHEN** 调用 `upload(imageFile)`
- **THEN** 返回 `{ key: string, url: string }`

### Requirement: useExec Hook

`useExec()` SHALL 返回 `{ exec, loading }`。`exec(sql, params?)` 方法 SHALL 发送 POST 请求到 `${basePath}/db/exec`。

#### Scenario: 执行原始 SQL
- **WHEN** 调用 `exec("SELECT * FROM todos WHERE status = ?", ["done"])`
- **THEN** 返回 `{ columns: [...], rows: [...] }`

### Requirement: useCount Hook

`useCount(resource, filters?)` Hook SHALL 返回 `{ count, loading, error }`。当 `filters` 变更时自动重新请求。

#### Scenario: 按条件计数
- **WHEN** 调用 `useCount("todos", { status: "done" })`
- **THEN** 发起 GET 请求到 `${basePath}/todos/count?status=done`
- **THEN** `count` 为符合条件的记录数
