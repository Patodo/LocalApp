## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the group-acl capability in LocalApp.

## Requirements

### Requirement: ACL 支持群组引用

ACL 数组中的字符串 SHALL 支持两种格式：纯用户 ID（如 `"userA"`）和群组引用（如 `"group:tech-team"`）。`group:` 前缀的条目视为群组引用，系统通过群组名查找成员关系。

#### Scenario: ACL 包含群组引用且用户是群组成员
- **WHEN** 页面的 pageAccess 为 `{ level: "acl", acl: ["group:tech-team"] }` 且当前用户是 tech-team 群组成员
- **THEN** 访问被允许

#### Scenario: ACL 包含群组引用但用户不是成员
- **WHEN** 页面的 pageAccess 为 `{ level: "acl", acl: ["group:tech-team"] }` 且当前用户不是 tech-team 群组成员
- **THEN** 返回 HTTP 403

#### Scenario: ACL 混用用户 ID 和群组引用
- **WHEN** 页面的 pageAccess 为 `{ level: "acl", acl: ["userA", "group:tech-team"] }` 且当前用户 ID 为 "userA"
- **THEN** 访问被允许（用户 ID 直接匹配）

#### Scenario: ACL 混用且通过群组匹配
- **WHEN** 页面的 pageAccess 为 `{ level: "acl", acl: ["userA", "group:tech-team"] }` 且当前用户是 tech-team 成员但 ID 不是 "userA"
- **THEN** 访问被允许（群组匹配）

#### Scenario: ACL 引用不存在的群组
- **WHEN** 页面的 pageAccess 为 `{ level: "acl", acl: ["group:nonexistent"] }` 且该群组不存在
- **THEN** 群组引用视为不匹配，不影响其他条目的判断。若所有条目均不匹配，返回 403

### Requirement: checkAccess 改造支持群组解析

`checkAccess` 函数遇到 `group:` 前缀的 ACL 条目时 SHALL 查询 `group_members` 表判断当前用户是否为该群组成员。遇到无效群组引用（群组不存在）时 SHALL 视为不匹配而非报错。

#### Scenario: 纯用户 ID 的 ACL 行为不变
- **WHEN** ACL 为 `["userA", "userB"]`（无 group: 前缀）
- **THEN** 行为与改造前完全一致，不查询群组表

#### Scenario: group:everyone 等同于 authenticated
- **WHEN** ACL 为 `["group:everyone"]` 且用户已登录
- **THEN** 访问被允许（所有登录用户均在 everyone 群组中）

### Requirement: 路由级 ACL 同样支持群组引用

DataSchema 的 `routeAccess.acl` SHALL 与页面级 `pageAccess.acl` 使用相同的群组解析逻辑。

#### Scenario: 路由级 ACL 群组引用
- **WHEN** Schema 的 routeAccess 为 `{ read: "acl", acl: ["group:sales"] }` 且当前用户是 sales 群组成员
- **THEN** 读取操作被允许

#### Scenario: 路由级 ACL 群组不匹配
- **WHEN** Schema 的 routeAccess 为 `{ create: "acl", acl: ["group:sales"] }` 且当前用户不是 sales 群组成员
- **THEN** 创建操作返回 403
