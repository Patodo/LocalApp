# platform-data-api Specification

## Purpose
定义统一 Server 的只读平台用户、群组、角色和版本 API，以及 React SDK 在开发与正式部署中的一致访问方式。
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

### Requirement: 开发模式读取项目 Server 的真实平台数据

`localapp dev` SHALL 运行完整统一 Server，所以 `/api/platform/*` SHALL 直接读取该 Server 自己的用户、群组、角色和版本数据。开发模式 SHALL NOT 代理远程平台、缓存远程结果或返回静态 mock。

#### Scenario: 开发应用读取平台用户
- **WHEN** 开发模式应用请求 `/api/platform/users`
- **THEN** Vite SHALL 把请求转发到当前项目 Server
- **AND** Server SHALL 返回自身真实用户数据
- **AND** 请求 SHALL NOT 离开本机

#### Scenario: 项目 Server 不可用
- **WHEN** Vite 页面请求 `/api/platform/users` 但项目 Server 已退出
- **THEN** SDK SHALL 返回可读的连接错误
- **AND** SHALL NOT 静默回退到缓存、mock 或远程 Server

### Requirement: 平台数据 schema 跟随 Server 版本

平台公共数据(users/groups/roles) SHALL 由每个 Server 自己的平台数据库与迁移维护，并跟 Server 版本绑定。应用数据库、应用 migrations 和 `.localapp` 包 SHALL NOT 创建、修改或携带这些平台表。

#### Scenario: 应用尝试创建已存在的平台表
- **WHEN** 应用 migration 或 backend contract 尝试声明保留的平台资源 `users`
- **THEN** `localapp check` 和 Server 包安装 SHALL 拒绝该声明
- **AND** SHALL 提示通过平台只读 API 访问用户数据

#### Scenario: 平台升级时统一迁移
- **WHEN** server 从 1.3 升级到 1.4,新增 `users.bio` 字段
- **THEN** Server 启动时运行自己的平台 migration
- **AND** 该 migration SHALL 只修改 Server 平台数据库
- **AND** 应用开发者无需感知

### Requirement: 平台路由不得落入应用 API

Vite 和 Server SHALL 在应用 `/api/*` 改写之前优先识别 `/api/platform/*`。平台资源 SHALL 始终由 Server 全局只读路由处理，不得被当作应用 Named SQL 名称或静态资源。

#### Scenario: 保留平台资源
- **WHEN** 开发应用请求 `/api/platform/groups`、`/api/platform/roles` 或 `/api/platform/version`
- **THEN** Vite SHALL 保持全局路径并转发到当前 Server
- **AND** Server SHALL 返回标准 `{ success, data }` 或明确认证/404 JSON 错误
