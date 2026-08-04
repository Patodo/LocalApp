## ADDED Requirements

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

## MODIFIED Requirements

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
