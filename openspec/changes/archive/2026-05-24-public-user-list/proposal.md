## Why

普通用户创建的应用（如"谁没填表"、"内部投票"）需要知道系统里有哪些用户，但目前只有 admin 才能通过 `/api/admin/users` 查询用户列表。用户在设置应用 ACL 访问控制时，也无法通过 UI 选择其他用户（因为拿不到用户列表）。需要为已登录用户提供一个只读的用户列表接口。

## What Changes

- 新增 `GET /api/users` 公共接口，返回系统中所有用户的基础信息（`id`、`name`、`displayName`），仅限已登录用户调用
- 在 SDK（`@localapp/client`）中新增 `useUsers()` Hook，封装该接口调用
- init-repo 模板中集成 `useUsers` 的类型导出

## Capabilities

### New Capabilities
- `public-user-list`: 公共用户列表只读 API + SDK Hook，供普通用户查询系统内所有用户基础信息

### Modified Capabilities
- `client-sdk`: 新增 `useUsers()` Hook

## Impact

- **Server**: `packages/server/src/routes/` 新增公共用户列表路由
- **SDK**: `packages/client/` 和 `init-repo/src/lib/localapp/` 新增 useUsers Hook
- **测试**: 新增 API 测试和 SDK Hook 测试
