# platform-data-api Specification

## Purpose
TBD - created by archiving change local-mini-server-and-sql-migrations. Update Purpose after archive.
## Requirements
### Requirement: 平台公共数据只读 API

server SHALL 暴露 `/api/platform/<resource>` 路径前缀的只读端点,提供平台维护的共享数据。当前 SHALL 至少包含:

- `GET /api/platform/users` — 所有用户列表
- `GET /api/platform/users/:id` — 单个用户详情
- `GET /api/platform/groups` — 用户群组列表
- `GET /api/platform/groups/:id` — 单个群组详情
- `GET /api/platform/roles` — 系统角色定义

所有 `/api/platform/*` 端点 SHALL 只接受 GET 请求,POST/PUT/PATCH/DELETE SHALL 返回 405 Method Not Allowed。

返回字段 SHALL 由 server 端权限管控决定,如果能访问就有完整权限看到该字段。

#### Scenario: 读取所有用户
- **WHEN** 应用通过 `usePlatformData("users")` 请求 `/api/platform/users`
- **AND** 请求附带有效 API key
- **THEN** server 返回 `{ success: true, data: [{ id, name, displayName, ... }, ...] }`
- **AND** 字段范围由后端权限管控决定

#### Scenario: 平台 API 拒绝写操作
- **WHEN** 客户端尝试 `POST /api/platform/users`(任何写操作)
- **THEN** server 返回 HTTP 405 Method Not Allowed
- **AND** 响应体 `{ success: false, error: "Platform data is read-only" }`

#### Scenario: 平台 API 鉴权失败
- **WHEN** 客户端请求 `/api/platform/users` 但未携带有效 API key
- **THEN** server 返回 HTTP 401
- **AND** 响应体 `{ success: false, error: "Authentication required" }`

### Requirement: SDK usePlatformData Hook

`@localapp/sdk-react` SHALL 提供 `usePlatformData<T>(resource)` Hook,行为与 `useList` 一致,但内部请求路径走 `/api/platform/<resource>` 而非 `/api/<resource>`。

```tsx
const { data, loading, error, refresh } = usePlatformData<PlatformUser>("users");
```

#### Scenario: usePlatformData 读平台用户
- **WHEN** 应用调用 `usePlatformData("users")`
- **THEN** SDK 发起 `GET /api/platform/users` 请求
- **AND** 返回 `{ data, loading, error, refresh }`,行为与 useList 一致

#### Scenario: usePlatformData 不支持 mutation
- **WHEN** 开发者尝试调用 `usePlatformData` 返回值的 create/update/delete 方法
- **THEN** SDK 不提供这些方法(平台数据只读)
- **AND** TypeScript 类型上也不暴露 mutation 字段

### Requirement: SDK 内置平台数据类型

`@localapp/sdk-react` SHALL 内置平台数据的 TypeScript 类型,跟随 server-core 同步:

```typescript
export interface PlatformUser {
  id: string;
  name: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role: string;
}

export interface PlatformGroup {
  id: string;
  name: string;
  description?: string;
  memberCount: number;
}

export interface PlatformRole {
  id: string;
  name: string;
  permissions: string[];
}
```

#### Scenario: SDK 导出平台类型
- **WHEN** 应用 `import { usePlatformData, type PlatformUser } from "@localapp/sdk-react"`
- **THEN** TypeScript 编译通过
- **AND** `usePlatformData<PlatformUser>("users")` 返回值类型正确

#### Scenario: SDK 类型跟 server 升级同步
- **WHEN** 平台升级新增字段(如 `PlatformUser.bio`)
- **THEN** server-core 更新类型定义
- **AND** SDK 下个版本发布包含新字段
- **AND** 应用通过 `npm update @localapp/sdk-react` 获得新类型

### Requirement: mini-server 转发平台数据请求(带 TTL 缓存)

mini-server SHALL 在 dev 模式下转发 `/api/platform/*` 请求到生产 server。同一资源的请求 SHALL 缓存 5 分钟,减少远程调用。

#### Scenario: 首次请求转发到生产
- **WHEN** dev 模式下应用请求 `/api/platform/users`
- **THEN** mini-server 转发请求到生产 server
- **AND** 返回结果给客户端
- **AND** 缓存结果(以 URL + 查询参数为 key),TTL 5 分钟

#### Scenario: 缓存命中直接返回
- **WHEN** 5 分钟内再次请求 `/api/platform/users`
- **THEN** mini-server 直接返回缓存结果
- **AND** 不再打远程

#### Scenario: 缓存过期后重新拉取
- **WHEN** 缓存超过 5 分钟,再次请求
- **THEN** mini-server 重新转发到生产 server
- **AND** 更新缓存

#### Scenario: 不同查询参数独立缓存
- **WHEN** 请求 `/api/platform/users?role=admin` 和 `/api/platform/users?role=user`
- **THEN** mini-server 把它们作为独立 key 缓存
- **AND** 互不影响

### Requirement: 平台数据 schema 跟随 server 版本

平台公共数据(users/groups/roles)的表 schema SHALL 由 server 维护,跟 server 版本绑定。平台升级时 SHALL 运行统一迁移脚本(`platform-migrations/*.sql`)应用到所有 app.db 中相应的平台表。

应用开发者 SHALL NOT 在自己的 `migrations/` 目录里 ALTER 平台表(尝试时 validate 报错,因为 prod app.db 的平台表已存在,CREATE 会冲突)。

#### Scenario: 应用尝试创建已存在的平台表
- **WHEN** 应用 migrations/001.sql 包含 `CREATE TABLE users (...)`
- **AND** server 已维护 users 平台表
- **THEN** `localapp db validate` 时该 migration 在 prod-snapshot.db 上失败
- **AND** 错误 "table users already exists"
- **AND** 提示用户从 migration 中移除 CREATE TABLE users

#### Scenario: 平台升级时统一迁移
- **WHEN** server 从 1.3 升级到 1.4,新增 `users.bio` 字段
- **THEN** server 启动时运行 `platform-migrations/014_add_user_bio.sql`
- **AND** 该 migration 应用到所有 app.db 的 users 表
- **AND** 应用开发者无需感知

### Requirement: 开发态平台数据 API 明确代理或 mock

在 `localapp dev` 下，`/api/platform/*` SHALL 由 mini-server 处理。mini-server SHALL 优先代理配置的生产 server 并注入 API Key；当代理不可用或未配置时，mini-server SHALL 返回稳定 mock 数据或明确错误，不得落入应用 CRUD。

#### Scenario: 代理平台用户
- **WHEN** dev 应用请求 `GET /api/platform/users`
- **AND** dev-config 中配置了可用 serverUrl 和 apiKey
- **THEN** mini-server SHALL 代理到生产 server
- **AND** 缓存成功响应

#### Scenario: 平台代理不可用
- **WHEN** dev 应用请求 `GET /api/platform/users`
- **AND** 生产 server 不可达
- **THEN** mini-server SHALL 返回稳定 mock 数据或明确 JSON 错误
- **AND** 不得将 `platform` 当作应用资源

#### Scenario: 未配置 API key 时不访问远端平台
- **WHEN** dev 应用请求 `GET /api/platform/users`
- **AND** dev-config 中 `apiKey` 为空
- **THEN** mini-server SHALL 直接返回本地 mock 用户列表
- **AND** SHALL NOT 请求 `serverUrl`

#### Scenario: 保留平台资源
- **WHEN** dev 应用请求 `/api/platform/groups`、`/api/platform/roles` 或 `/api/platform/version`
- **THEN** mini-server SHALL 使用平台数据处理路径
- **AND** 返回与生产平台数据 API 同构的 `{ success, data }`
