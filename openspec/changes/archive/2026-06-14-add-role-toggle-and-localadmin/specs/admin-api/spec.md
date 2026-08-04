## MODIFIED Requirements

### Requirement: 用户管理 API
管理员 SHALL 能通过 API 查看和管理所有用户。

#### Scenario: 获取用户列表
- **WHEN** admin 发送 `GET /api/admin/users?page=1&limit=20`
- **THEN** 返回所有用户列表，每项包含 `id`、`name`、`role`、`createdAt`、`pages`（页面数）、`storageUsed`（存储用量字符串）
- **AND** 支持分页（`page`、`limit`、`total`）

#### Scenario: 获取用户详情
- **WHEN** admin 发送 `GET /api/admin/users/:id`
- **THEN** 返回用户详情，包含基本信息和关联的页面列表摘要

#### Scenario: 删除用户
- **WHEN** admin 发送 `DELETE /api/admin/users/:id`
- **THEN** 删除该用户的所有数据（`data/{userId}/` 目录）、API keys、用户记录
- **AND** 返回 `{ success: true, data: { deleted: true, id } }`
- **AND** 不能删除自己（admin 不能删除自己），返回 400

#### Scenario: 删除系统保护账户被拒绝
- **WHEN** admin 发送 `DELETE /api/admin/users/localadmin`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Cannot delete protected user" }`
- **AND** 用户记录、API keys、数据目录均不变

## ADDED Requirements

### Requirement: 管理员修改用户角色

系统 SHALL 提供 `PATCH /api/admin/users/:id/role` 端点，仅限 admin 角色调用，请求体 `{ role: "admin" | "user" }`。该端点 SHALL 在以下条件全部满足时执行更新：目标用户存在、role 值合法、操作未违反保护约束。

#### Scenario: 成功将普通用户提升为管理员
- **WHEN** admin 发送 `PATCH /api/admin/users/alice/role` 携带 `{ role: "admin" }`
- **THEN** 更新 `users.role='admin'` WHERE id='alice'
- **AND** 返回 `{ success: true, data: { id: "alice", role: "admin" } }`

#### Scenario: 成功将管理员降级为普通用户
- **WHEN** admin 发送 `PATCH /api/admin/users/bob/role` 携带 `{ role: "user" }`
- **AND** 当前系统中有至少 2 个 admin
- **AND** `bob` 不是当前登录的 admin 自己
- **AND** `bob` 不是系统保护账户
- **THEN** 更新 `users.role='user'` WHERE id='bob'
- **AND** 返回 `{ success: true, data: { id: "bob", role: "user" } }`

#### Scenario: 非法 role 值被拒绝
- **WHEN** admin 发送 `PATCH /api/admin/users/alice/role` 携带 `{ role: "superadmin" }`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid role" }`
- **AND** 用户记录不变

#### Scenario: 目标用户不存在
- **WHEN** admin 发送 `PATCH /api/admin/users/ghost/role` 携带 `{ role: "admin" }`
- **AND** `ghost` 不在 users 表中
- **THEN** 返回 HTTP 404，`{ success: false, error: "User not found" }`

#### Scenario: 系统保护账户不可降级
- **WHEN** admin 发送 `PATCH /api/admin/users/localadmin/role` 携带 `{ role: "user" }`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Cannot demote protected user" }`
- **AND** localadmin 的 role 仍为 `admin`

#### Scenario: 不能降级自己
- **WHEN** admin（id='alice'）发送 `PATCH /api/admin/users/alice/role` 携带 `{ role: "user" }`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Cannot demote yourself" }`
- **AND** alice 的 role 仍为 `admin`

#### Scenario: 不能降级最后一个 admin
- **WHEN** admin 发送 `PATCH /api/admin/users/bob/role` 携带 `{ role: "user" }`
- **AND** 当前 `users.role='admin'` 的行数为 1（即 bob 自己）
- **THEN** 返回 HTTP 400，`{ success: false, error: "Cannot demote the last admin" }`
- **AND** bob 的 role 仍为 `admin`

#### Scenario: 非管理员被拒绝
- **WHEN** 非 admin 角色用户发送 `PATCH /api/admin/users/alice/role`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Admin access required" }`

#### Scenario: 未认证被拒绝
- **WHEN** 未携带任何凭证发送 `PATCH /api/admin/users/alice/role`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`
