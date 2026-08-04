## Context

当前用户列表接口 `GET /api/admin/users` 仅限 admin 角色。普通用户的应用无法获知系统中有哪些用户，导致：
1. 无法构建"谁没填表"类应用（需要对比用户列表与数据表记录）
2. 设置 ACL 访问控制时无法选择其他用户（需要 userId 列表）

SDK 的 `useMe()` Hook 通过 `/api/me` 查询当前访客身份（不经过 basePath），新接口可复用此模式。

## Goals / Non-Goals

**Goals:**
- 为已登录用户提供只读用户列表接口
- 返回最少必要信息（id、name、displayName）
- SDK 提供 `useUsers()` Hook，前端零学习成本

**Non-Goals:**
- 不提供分页（用户量 500-2000，全量返回即可）
- 不暴露敏感信息（邮箱、密码、存储用量等）
- 不提供搜索/筛选（用户量小，前端过滤即可）
- 不修改 admin 的 `/api/admin/users` 接口

## Decisions

### Decision 1: 新增独立路由 `GET /api/users`

不走 `/serve/{uid}/{name}/api/` 的 CRUD 路径，而是像 `/api/me` 一样作为独立公共路由。

**理由**: 用户列表是系统级概念，不属于某个应用的数据表。复用 `/api/me` 的模式（独立路由 + Cookie 鉴权）更自然。

**替代方案**: 作为 SDK 保留表 `_users` 走 CRUD 路径 — 需要模拟虚拟数据表，增加不必要的复杂度；且 basePath 依赖应用上下文，用户列表不应依赖某个应用的存在。

### Decision 2: SDK Hook 命名为 `useUsers()`

与 `useMe()` 对称，命名清晰。返回 `{ users, loading, error }`，内部调 `/api/users`（不经过 basePath，与 `useMe()` 一致）。

### Decision 3: 不分页，全量返回

用户量 500-2000，每条记录约 50-100 字节，全量约 100-200KB，一次返回没有性能问题。

## Risks / Trade-offs

- **信息泄露风险** → 只返回 `id`、`name`、`displayName`，不暴露邮箱、密码哈希、角色、存储等敏感信息
- **未登录用户调用** → 返回 401，与 `/api/me` 行为一致
- **未来用户量增长** → 到万级时再加 `?page&limit` 参数，接口向下兼容
