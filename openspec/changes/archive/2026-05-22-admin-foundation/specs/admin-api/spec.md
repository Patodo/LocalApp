## NEW Requirements

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
