## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the admin-api capability in LocalApp.

## Requirements

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

### Requirement: 全局页面管理 API
管理员 SHALL 能查看和删除所有用户的所有页面。

#### Scenario: 获取全局页面列表
- **WHEN** admin 发送 `GET /api/admin/pages?userId=&page=1&limit=20`
- **THEN** 返回所有用户的页面列表，每项包含 `name`、`userId`、`description`、`currentVersion`、`totalSize`、`createdAt`、`updatedAt`
- **AND** `userId` 参数可选，用于过滤特定用户

#### Scenario: 获取页面详情
- **WHEN** admin 发送 `GET /api/admin/pages/:userId/:name`
- **THEN** 返回完整页面详情，包含版本历史、schema 信息、存储用量

#### Scenario: 删除页面
- **WHEN** admin 发送 `DELETE /api/admin/pages/:userId/:name`
- **THEN** 删除该页面目录和关联的 meta.json
- **AND** 关闭该页面的数据库连接（如有）

### Requirement: 系统概览统计 API
管理员 SHALL 能查看系统整体统计。

#### Scenario: 获取系统概览
- **WHEN** admin 发送 `GET /api/admin/stats`
- **THEN** 返回 `{ users: { total }, pages: { total, totalSize, totalBytes }, schemas: { total }, recentDeploys: [...] }`
- **AND** `recentDeploys` 返回最近 10 次部署记录

### Requirement: 管理员创建用户

系统 SHALL 提供 `POST /api/admin/users` 端点，仅限 admin 角色调用，接受 `username`。系统 MUST 使用密码学安全随机源生成临时密码和初始 API Key，在同一事务中创建 `role="user"`、`must_change_password=1` 的用户并存储密码与 API Key 的安全哈希。

#### Scenario: 管理员成功创建用户
- **WHEN** admin 角色用户发送 `POST /api/admin/users` 携带 `{ username: "newuser" }`
- **THEN** 原子创建用户、随机临时密码和初始 API Key
- **AND** 返回 `{ success: true, data: { id: "newuser", name: "newuser", role: "user", mustChangePassword: true, credentials: { temporaryPassword, apiKey } } }`

#### Scenario: 用户名已存在
- **WHEN** admin 发送 `POST /api/admin/users` 携带已存在的 `username`
- **THEN** 返回 HTTP 409，`{ success: false, error: "Username already exists" }`
- **AND** 不生成或返回凭据

#### Scenario: 用户名格式不合法
- **WHEN** admin 发送 `POST /api/admin/users` 携带的 username 不匹配 `^[a-zA-Z0-9_-]{2,32}$`
- **THEN** 返回 HTTP 400，`{ success: false, error: "Invalid username format" }`

#### Scenario: 非管理员被拒绝
- **WHEN** 非 admin 角色用户发送 `POST /api/admin/users`
- **THEN** 返回 HTTP 403，`{ success: false, error: "Admin access required" }`

#### Scenario: 未认证被拒绝
- **WHEN** 未携带任何凭证发送 `POST /api/admin/users`
- **THEN** 返回 HTTP 401，`{ success: false, error: "Authentication required" }`
