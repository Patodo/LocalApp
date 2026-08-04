## ADDED Requirements

### Requirement: 群组成员数据模型

系统 SHALL 在 meta.sqlite 中维护 `group_members` 表，包含字段：`group_id TEXT NOT NULL`、`user_id TEXT NOT NULL`、`joined_at TEXT NOT NULL DEFAULT (datetime('now'))`，PRIMARY KEY 为 (group_id, user_id)。

#### Scenario: 成员表结构
- **WHEN** 系统初始化 meta.sqlite
- **THEN** `group_members` 表存在且以 (group_id, user_id) 为主键

### Requirement: 批量添加群组成员

群组创建者 SHALL 能通过 `POST /api/groups/:id/members` 批量添加成员。请求体包含 `userIds: string[]`。已存在的成员跳过（幂等）。系统群组只有管理员可操作。

#### Scenario: 创建者批量添加成员
- **WHEN** 群组创建者发送 `POST /api/groups/:id/members` 携带 `{ userIds: ["userA", "userB"] }`
- **THEN** 返回 200，指定用户成为群组成员

#### Scenario: 添加已存在的成员（幂等）
- **WHEN** 创建者发送 `POST /api/groups/:id/members` 携带已在群组中的 userId
- **THEN** 返回 200，已存在的成员跳过，不报错

#### Scenario: 添加不存在的用户
- **WHEN** 创建者发送 `POST /api/groups/:id/members` 携带系统中不存在的 userId
- **THEN** 仍然添加成功（不校验用户存在性，与 ACL 设计一致）

#### Scenario: 非创建者添加成员
- **WHEN** 非创建者发送 `POST /api/groups/:id/members`
- **THEN** 返回 403

#### Scenario: 管理员操作系统群组成员
- **WHEN** 管理员发送 `POST /api/groups/:id/members` 且群组 system=1
- **THEN** 返回 200，成员添加成功

### Requirement: 批量移除群组成员

群组创建者 SHALL 能通过 `POST /api/groups/:id/members/remove` 批量移除成员。请求体包含 `userIds: string[]`。不存在的成员跳过（幂等）。创建者不能移除自己。

#### Scenario: 创建者批量移除成员
- **WHEN** 群组创建者发送 `POST /api/groups/:id/members/remove` 携带 `{ userIds: ["userA"] }`
- **THEN** 返回 200，指定用户从群组中移除

#### Scenario: 移除不存在的成员（幂等）
- **WHEN** 创建者发送 `POST /api/groups/:id/members/remove` 携带不在群组中的 userId
- **THEN** 返回 200，跳过不报错

#### Scenario: 创建者不能移除自己
- **WHEN** 群组创建者发送 `POST /api/groups/:id/members/remove` 携带自己的 userId
- **THEN** 返回 400，创建者不能退出自己创建的群组

### Requirement: 查询群组成员列表

群组详情接口 SHALL 在返回中包含成员列表，每个成员包含 id、name、displayName。通过 `GET /api/groups/:id` 获取。

#### Scenario: 查询群组成员
- **WHEN** 群组成员发送 `GET /api/groups/:id`
- **THEN** 返回 200，data.members 为成员数组，每个元素包含 id、name、displayName

### Requirement: 查询用户所属群组

`GET /api/groups` 返回结果 SHALL 标识用户在每个群组中的角色（是否为创建者）。

#### Scenario: 群组列表标识创建者身份
- **WHEN** 用户查询群组列表
- **THEN** 每个群组包含 `isCreator: boolean` 字段标识当前用户是否为创建者
