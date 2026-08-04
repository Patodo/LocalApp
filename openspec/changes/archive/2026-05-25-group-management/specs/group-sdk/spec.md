## ADDED Requirements

### Requirement: useGroups Hook

SDK SHALL 提供 `useGroups()` Hook，返回当前用户所在的所有群组列表。返回格式为 `{ groups: GroupBasic[], loading: boolean, error: LocalAppError | null }`。

#### Scenario: 已登录用户查询群组
- **WHEN** 已登录用户的应用调用 `useGroups()`
- **THEN** 返回 groups 数组，每个元素包含 id、name、description、isCreator，loading 为 false

#### Scenario: 未登录用户查询群组
- **WHEN** 未登录用户的应用调用 `useGroups()`
- **THEN** 返回空数组，error.status 为 401

### Requirement: useGroupMembers Hook

SDK SHALL 提供 `useGroupMembers(groupId: string)` Hook，返回指定群组的成员列表。返回格式为 `{ members: UserBasic[], loading: boolean, error: LocalAppError | null }`。

#### Scenario: 查询群组成员
- **WHEN** 应用调用 `useGroupMembers("group-id")` 且当前用户是该群组成员
- **THEN** 返回 members 数组，每个元素包含 id、name、displayName

#### Scenario: 查询非成员群组
- **WHEN** 应用调用 `useGroupMembers("group-id")` 且当前用户不是该群组成员
- **THEN** 返回 error.status 为 403

### Requirement: GroupBasic 类型

SDK SHALL 导出 `GroupBasic` 类型，包含字段：`id: string`、`name: string`、`description: string | null`、`isCreator: boolean`。

#### Scenario: 类型导出
- **WHEN** 应用从 SDK 导入 `GroupBasic`
- **THEN** 类型可用且包含 id、name、description、isCreator 字段

### Requirement: LocalAppClient 扩展

`LocalAppClient` 接口 SHALL 新增 `groups()` 方法返回 `Promise<GroupBasic[]>`，以及 `groupMembers(groupId: string)` 方法返回 `Promise<UserBasic[]>`。

#### Scenario: 客户端查询群组
- **WHEN** 应用调用 `createClient().groups()`
- **THEN** 返回当前用户的群组列表

#### Scenario: 客户端查询群组成员
- **WHEN** 应用调用 `createClient().groupMembers("group-id")`
- **THEN** 返回该群组的成员列表
