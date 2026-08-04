## Purpose

TBD — `@localapp/sdk-react` React SDK 包，提供数据查询（useList、useGet、useCount）、变更（useCreate、useUpdate、useDelete）、身份（useMe、useUsers、useGroups、useGroupMembers）、上传（useUpload）和 SQL 执行（useExec）等 React Hook。
## Requirements
### Requirement: 独立 npm 包

`@localapp/sdk-react` SHALL 作为一个独立的 npm 包存在于 monorepo 的 `packages/sdk-react/` 目录中。包的 `package.json` SHALL 声明 `"name": "@localapp/sdk-react"`，`"@localapp/sdk"` 为 peerDependency，`"react"` 为 peerDependency。

#### Scenario: 包可被 pnpm workspace 引用
- **WHEN** monorepo 中的其他包声明 `"@localapp/sdk-react": "workspace:*"` 依赖
- **THEN** pnpm 解析到 `packages/sdk-react/` 的本地包

### Requirement: useList Hook

`useList<T>(resource, options?)` SHALL 继续提供应用层数据的列表查询,行为不变。但在 dev 模式下,请求通过 vite-proxy 转发到本地 mini-server;在 prod 模式下,转发到生产 server。

应用 SHALL NOT 用 `useList` 读取平台公共数据,平台数据用 `usePlatformData`。

#### Scenario: useList 在 dev 模式下读 dev.db
- **WHEN** dev 模式下应用 `useList<Task>("tasks")`
- **THEN** vite-proxy 转发到 mini-server
- **AND** mini-server 从 dev.db 读 tasks 表
- **AND** 返回 Task 数组

#### Scenario: useList 不能读平台数据
- **WHEN** 应用调用 `useList("users")` 试图读平台用户表
- **THEN** dev 模式:mini-server 返回 404(dev.db 无 users 表)
- **AND** prod 模式:server 返回 404(app.db 无应用层 users 表,平台 users 在专属路径)
- **AND** 提示开发者改用 `usePlatformData("users")`

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

- `useCreate<T>(resource, options?)` SHALL 返回 `{ create }`。`create(data)` 方法 SHALL 发送 POST 请求并返回创建后的记录。当 `options.onSuccess` 被提供时，SHALL 在创建成功后调用 `onSuccess(createdRecord)`。
- `useUpdate<T>(resource, options?)` SHALL 返回 `{ update }`。`update(id, data)` 方法 SHALL 发送 PUT 请求并返回更新后的记录。当 `options.onSuccess` 被提供时，SHALL 在更新成功后调用 `onSuccess(updatedRecord)`。
- `useDelete(resource, options?)` SHALL 返回 `{ remove }`。`remove(id)` 方法 SHALL 发送 DELETE 请求。当 `options.onSuccess` 被提供时，SHALL 在删除成功后调用 `onSuccess()`。

三个方法 SHALL 通过 `useCallback` 稳定引用。`options` 参数 SHALL 为可选，不提供时行为与现有完全一致（向后兼容）。

#### Scenario: 创建记录后获取完整数据

- **WHEN** 调用 `create({ title: "New task" })`
- **THEN** 发送 POST 请求到 `${basePath}/todos`
- **THEN** 返回服务器创建的完整记录

#### Scenario: 创建记录后触发 onSuccess 回调

- **WHEN** 调用 `useCreate("todos", { onSuccess: (data) => { refresh(); } })` 然后调用 `create({ title: "test" })`
- **THEN** POST 成功后 `onSuccess` 被调用，参数为创建的完整记录

#### Scenario: 更新记录后触发 onSuccess 回调

- **WHEN** 调用 `useUpdate("todos", { onSuccess: () => { refresh(); } })` 然后调用 `update(1, { status: "done" })`
- **THEN** PUT 成功后 `onSuccess` 被调用

#### Scenario: 删除记录后触发 onSuccess 回调

- **WHEN** 调用 `useDelete("todos", { onSuccess: () => { refresh(); } })` 然后调用 `remove(1)`
- **THEN** DELETE 成功后 `onSuccess` 被调用（无参数）

#### Scenario: 不提供 options 时向后兼容

- **WHEN** 调用 `useCreate("todos")`（无 options 参数）
- **THEN** 行为与修改前完全一致，不触发任何回调

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

### Requirement: usePermissions Hook

`@localapp/sdk-react` SHALL 导出 `usePermissions()` Hook，返回 `{ can, loading, error }`，用于基于当前用户、schema 业务元数据和记录内容判断 UI 操作是否可用。

#### Scenario: 判断当前用户可更新记录
- **WHEN** 组件调用 `const { can } = usePermissions()` 并执行 `can("update", record, schema)`
- **THEN** 返回值 SHALL 表示当前用户是否满足该 schema 对该记录的 update 策略

#### Scenario: 未加载当前用户时提供 loading
- **WHEN** `usePermissions()` 仍在加载当前用户或必要 schema 信息
- **THEN** `loading` SHALL 为 true，应用可据此延迟渲染受权限保护的操作

### Requirement: Can 组件

`@localapp/sdk-react` SHALL 导出 `<Can>` 组件，用于在 React UI 中根据权限判断有条件渲染子内容。

#### Scenario: 有权限时渲染内容
- **WHEN** `<Can action="update" record={record} schema={schema}>` 判断当前用户有权限
- **THEN** 组件 SHALL 渲染其 children

#### Scenario: 无权限时隐藏内容
- **WHEN** `<Can>` 判断当前用户无权限
- **THEN** 组件 SHALL 默认不渲染其 children

### Requirement: 权限 API 不作为安全边界

SDK 权限 API 文档 SHALL 明确说明 `can()` 和 `<Can>` 仅用于 UI 展示判断，后端 CRUD API 仍是记录级权限的安全边界。

#### Scenario: 文档说明安全边界
- **WHEN** 开发者阅读 `usePermissions` 或 `<Can>` 文档
- **THEN** 文档 SHALL 明确要求敏感数据权限必须由后端记录级访问控制执行

### Requirement: useTransitions Hook

`@localapp/sdk-react` SHALL 导出 `useTransitions(resource, id, options?)` Hook，返回 `{ transitions, transition, loading, error, refresh }`。

#### Scenario: 加载可用 transitions
- **WHEN** 组件调用 `useTransitions("leave_requests", 1)`
- **THEN** Hook SHALL 请求该记录的 transitions 端点，并将结果放入 `transitions`

#### Scenario: id 为空时不请求
- **WHEN** 组件调用 `useTransitions("leave_requests", null)`
- **THEN** Hook SHALL 不发起网络请求，且 `transitions` 为空数组

### Requirement: useTransitions 执行 transition

`useTransitions` 返回的 `transition(name, payload?)` 方法 SHALL 调用 transition 执行端点，并返回更新后的记录。

#### Scenario: 执行 submit transition
- **WHEN** 应用调用 `transition("submit")`
- **THEN** SDK SHALL 发送 POST 请求到该记录的 `submit` transition 执行端点

#### Scenario: transition 成功后触发 onSuccess
- **WHEN** `useTransitions` 配置了 `onSuccess`
- **THEN** transition 执行成功后 SHALL 调用 `onSuccess(updatedRecord)`

### Requirement: transition 错误使用 LocalAppError

`useTransitions` SHALL 使用现有 `LocalAppError` 错误模型暴露 400、401、403、404 和网络错误。

#### Scenario: 当前状态不允许
- **WHEN** transition 执行端点返回 HTTP 400
- **THEN** Hook SHALL 将 `error` 设置为 `LocalAppError`，且 `error.status` 为 400

### Requirement: usePlatformData Hook

`@localapp/sdk-react` SHALL 提供 `usePlatformData<T>(resource, options?)` Hook,用于读取平台公共数据(users、groups、roles 等)。行为与 `useList` 一致,但请求路径走 `/api/platform/<resource>`。

```typescript
function usePlatformData<T>(
  resource: PlatformResource,
  options?: { filters?: Record<string, unknown>; offset?: number; limit?: number }
): { data: T[]; loading: boolean; error: LocalAppError | null; refresh: () => void };
```

`PlatformResource` SHALL 为联合类型 `"users" | "groups" | "roles" | (string & {})`,允许未来扩展。

`usePlatformData` SHALL NOT 提供 mutation 方法(`create`/`update`/`delete`),平台数据只读。

#### Scenario: 读平台用户列表
- **WHEN** 应用调用 `usePlatformData<PlatformUser>("users")`
- **THEN** SDK 发起 `GET /api/platform/users` 请求
- **AND** 返回 `{ data: PlatformUser[], loading, error, refresh }`

#### Scenario: 读平台用户带筛选
- **WHEN** 应用调用 `usePlatformData<PlatformUser>("users", { filters: { role: "admin" } })`
- **THEN** SDK 发起 `GET /api/platform/users?filters={"role":"admin"}` 请求
- **AND** 只返回 role=admin 的用户

#### Scenario: TypeScript 类型上无 mutation 方法
- **WHEN** 开发者尝试调用 `usePlatformData("users").create(...)`
- **THEN** TypeScript 编译错误:`Property 'create' does not exist on type ...`
- **AND** 阻止写操作

### Requirement: 平台数据 TypeScript 类型内置

`@localapp/sdk-react` SHALL 内置平台数据的 TypeScript 类型(详见 platform-data-api spec):
- `PlatformUser`
- `PlatformGroup`
- `PlatformRole`

类型 SHALL 跟 server-core 同步发布,SDK 版本号跟 server 版本对齐。

#### Scenario: 导入平台类型
- **WHEN** 应用 `import { usePlatformData, type PlatformUser } from "@localapp/sdk-react"`
- **THEN** TypeScript 编译通过
- **AND** `usePlatformData<PlatformUser>("users")` 返回值类型为 `{ data: PlatformUser[]; ... }`

#### Scenario: 类型跟 SDK 升级
- **WHEN** 平台升级,`PlatformUser` 新增 `bio?: string | null` 字段
- **THEN** SDK 下个版本包含该字段
- **AND** 用户 `npm update @localapp/sdk-react` 后获得新类型

### Requirement: React Hook 使用一致的 SDK 契约

`@localapp/sdk-react` Hook SHALL 通过 `LocalAppClient` 调用公开 SDK 方法，并继承 SDK 的 dev/prod 契约一致性。Hook SHALL 在失败时设置 `LocalAppError`，不得静默退回本地假数据。

#### Scenario: useCount 在 dev 下可用
- **WHEN** dev 应用调用 `useCount("work_items")`
- **THEN** Hook SHALL 通过 SDK 读取 mini-server 的 `/api/work_items/count`
- **AND** 返回正确 count、loading 和 error 状态

#### Scenario: useUsers 在 dev 下可用
- **WHEN** dev 应用调用 `useUsers()`
- **THEN** Hook SHALL 读取标准 `{ success, data }` 响应
- **AND** 不得因为 mini-server 将 `/api/users` 误解析为 CRUD 而失败

### Requirement: dev context 变化触发订阅型 Hook 刷新

当 Dev Toolkit 切换用户、切换时间、reset 或 restore 数据时，订阅型 Hook SHALL 刷新受影响资源。`useList`、`useGet`、`useCount`、`useTime` 和依赖当前用户的 Hook SHALL 能观察到变化。

#### Scenario: 切换用户刷新 count
- **WHEN** Dev Toolkit 将当前用户从 `alice` 切换为 `bob`
- **AND** `useCount("tasks")` 受 recordAccess.read 影响
- **THEN** Hook SHALL 刷新并显示 bob 可读记录数

#### Scenario: 固定时间刷新 useTime
- **WHEN** Dev Toolkit 固定业务时间
- **THEN** `useTime()` SHALL 刷新为固定后的日期

