## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the group-crud capability in LocalApp.

## Requirements

### Requirement: 群组数据模型

系统 SHALL 在 meta.sqlite 中维护 `groups` 表，包含字段：`id TEXT PRIMARY KEY`（nanoid 生成）、`name TEXT NOT NULL UNIQUE`、`description TEXT`、`creator_id TEXT NOT NULL`、`system INTEGER NOT NULL DEFAULT 0`、`created_at TEXT NOT NULL DEFAULT (datetime('now'))`。

#### Scenario: 群组表结构
- **WHEN** 系统初始化 meta.sqlite
- **THEN** `groups` 表存在且包含 id、name、description、creator_id、system、created_at 字段，name 字段具有 UNIQUE 约束

### Requirement: 创建用户群组

已登录用户 SHALL 能通过 `POST /api/groups` 创建群组，请求体包含 `name`（必填）和 `description`（可选）。创建者自动成为群组成员。系统群组标记 `system` 为 0。

#### Scenario: 成功创建群组
- **WHEN** 已登录用户发送 `POST /api/groups` 携带 `{ name: "tech-team", description: "技术部" }`
- **THEN** 返回 201，群组创建成功，creator_id 为当前用户 ID，创建者自动加入 group_members，system 为 0

#### Scenario: 未登录用户创建群组
- **WHEN** 未登录用户发送 `POST /api/groups`
- **THEN** 返回 401

#### Scenario: 群组名重复
- **WHEN** 已登录用户发送 `POST /api/groups` 携带已存在的 name
- **THEN** 返回 409 Conflict

#### Scenario: 群组名缺失
- **WHEN** 已登录用户发送 `POST /api/groups` 不包含 name 字段
- **THEN** 返回 400

### Requirement: 查询群组列表

已登录用户 SHALL 能通过 `GET /api/groups` 查询群组列表。返回包含两类群组：当前用户创建的群组 + 当前用户所在（作为成员）的群组。

#### Scenario: 查询群组列表
- **WHEN** 已登录用户发送 `GET /api/groups`
- **THEN** 返回 200，data 为群组数组，每个群组包含 id、name、description、creatorId、system、createdAt、memberCount

#### Scenario: 未登录用户查询群组
- **WHEN** 未登录用户发送 `GET /api/groups`
- **THEN** 返回 401

### Requirement: 查询群组详情

已登录用户 SHALL 能通过 `GET /api/groups/:id` 查询群组详情，包含成员列表。仅创建者和群组成员可查看。

#### Scenario: 创建者查看群组详情
- **WHEN** 群组创建者发送 `GET /api/groups/:id`
- **THEN** 返回 200，data 包含群组信息和成员列表

#### Scenario: 成员查看群组详情
- **WHEN** 群组成员（非创建者）发送 `GET /api/groups/:id`
- **THEN** 返回 200，data 包含群组信息和成员列表

#### Scenario: 非成员查看群组详情
- **WHEN** 非群组成员用户发送 `GET /api/groups/:id`
- **THEN** 返回 403

### Requirement: 修改群组信息

群组创建者 SHALL 能通过 `PUT /api/groups/:id` 修改群组的 name 和 description。系统群组只有管理员可修改。

#### Scenario: 创建者修改群组
- **WHEN** 群组创建者发送 `PUT /api/groups/:id` 携带 `{ description: "新描述" }`
- **THEN** 返回 200，群组信息更新成功

#### Scenario: 管理员修改系统群组
- **WHEN** 管理员发送 `PUT /api/groups/:id` 修改 system=1 的群组
- **THEN** 返回 200，系统群组信息更新成功

#### Scenario: 非创建者修改群组
- **WHEN** 非创建者且非管理员发送 `PUT /api/groups/:id`
- **THEN** 返回 403

#### Scenario: 修改群组名为已存在的名称
- **WHEN** 创建者发送 `PUT /api/groups/:id` 携带已存在的 name
- **THEN** 返回 409 Conflict

### Requirement: 删除群组

群组创建者 SHALL 能通过 `DELETE /api/groups/:id` 解散群组，同时删除所有成员记录。系统群组不可删除。

#### Scenario: 创建者删除用户群组
- **WHEN** 群组创建者发送 `DELETE /api/groups/:id` 且群组 system=0
- **THEN** 返回 200，群组及所有成员记录被删除

#### Scenario: 删除系统群组
- **WHEN** 任何人发送 `DELETE /api/groups/:id` 且群组 system=1
- **THEN** 返回 403

#### Scenario: 非创建者删除群组
- **WHEN** 非创建者发送 `DELETE /api/groups/:id`
- **THEN** 返回 403

### Requirement: 系统默认群组

系统初始化时 SHALL 自动创建 `everyone` 系统群组（system=1，creator_id='admin'）。所有现有和新建用户自动成为 `everyone` 群组成员。

#### Scenario: 系统启动时创建 everyone 群组
- **WHEN** 系统初始化 meta.sqlite 且 bootstrapKey 不为空
- **THEN** `everyone` 群组存在，system=1，所有现有用户均为其成员

#### Scenario: 新供应用户自动加入 everyone
- **WHEN** 管理员成功供应新用户
- **THEN** 该用户自动成为 `everyone` 群组成员
