## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the public-user-list capability in LocalApp.

## Requirements

### Requirement: 公共用户列表 API
系统 SHALL 提供 `GET /api/users` 接口，返回系统中所有用户的基础信息，仅限已登录用户调用。

#### Scenario: 已登录用户获取用户列表
- **GIVEN** 用户已通过 Cookie 或 API Key 认证
- **WHEN** 请求 `GET /api/users`
- **THEN** 返回 status 200，body 为 `{ success: true, data: [{ id, name, displayName }] }`
- **AND** `data` 包含系统中所有用户
- **AND** 每条记录只包含 `id`（string）、`name`（string）、`displayName`（string | null）三个字段

#### Scenario: 未登录用户请求用户列表
- **GIVEN** 请求未携带认证信息
- **WHEN** 请求 `GET /api/users`
- **THEN** 返回 status 401

#### Scenario: 用户列表不包含敏感信息
- **GIVEN** 系统中存在多个用户
- **WHEN** 已登录用户请求 `GET /api/users`
- **THEN** 返回的每条记录不包含 password、provider、role、storageUsed、mustChangePassword、avatarUrl、bio 字段

### Requirement: SDK useUsers Hook
SDK SHALL 提供 `useUsers()` React Hook，封装 `GET /api/users` 接口调用。

#### Scenario: useUsers 返回用户列表
- **GIVEN** 用户已登录
- **WHEN** 组件调用 `useUsers()`
- **THEN** 返回 `{ users: UserBasic[], loading: boolean, error: LocalAppError | null }`
- **AND** `users` 为系统内所有用户的数组
- **AND** `UserBasic` 类型为 `{ id: string; name: string; displayName: string | null }`

#### Scenario: useUsers 未登录时返回错误
- **GIVEN** 用户未登录
- **WHEN** 组件调用 `useUsers()`
- **THEN** `users` 为空数组，`error` 不为 null，`error.status` 为 401
