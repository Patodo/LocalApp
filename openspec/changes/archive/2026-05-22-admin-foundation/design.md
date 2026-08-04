## Context

当前 LocalApp 的用户体系没有角色概念——所有注册用户权限相同，且所有 API 按 `req.userId` 隔离数据。`meta.sqlite` 的 `users` 表只有 `id`、`name`、`password`、`provider`、`created_at` 字段。`BOOTSTRAP_API_KEY` 创建的 `user_id='admin'` 只是一个普通用户 ID，没有管理权限。

所有现有 API（`/api/pages`、`/api/schemas` 等）都只能操作当前用户的数据，无法跨用户查看或管理。

## Goals / Non-Goals

**Goals:**
- 建立管理员角色，使 bootstrap 用户成为真正的 admin
- 提供 admin 专用中间件，保护 `/api/admin/*` 路由
- 实现跨用户的用户管理 API（列表、详情、删除）
- 实现跨用户的页面管理 API（全局列表、详情、删除）
- 实现系统概览统计 API（用户数、页面数、存储量）
- CLI 提供 `admin` 子命令组

**Non-Goals:**
- 不做前端管理面板（admin-panel 变更）
- 不做运营分析/数据采集（admin-analytics 变更）
- 不做细粒度权限（如只读 admin、特定模块 admin），只有 admin/user 两种角色
- 不做用户编辑（改密码、改用户名），只做查看和删除
- 不修改现有用户 API 的行为

## Decisions

### D1: users 表新增 role 字段

用 `ALTER TABLE` 添加 `role TEXT NOT NULL DEFAULT 'user'`。使用 SQLite 的 ALTER TABLE ADD COLUMN（向后兼容，不需要迁移）。`adminAuth` 中间件通过查库判断角色，不缓存到 JWT 中（避免角色变更后旧 token 仍有效）。

**Why:** SQLite ALTER TABLE ADD COLUMN 是原子操作且不会锁表，适合当前单进程架构。不把 role 放进 JWT 是因为 admin 角色变更应立即生效。

### D2: adminAuth 中间件复用现有双认证体系

adminAuth 同时检查 `req.visitorId`（JWT cookie）和 `req.userId`（API key），从 `meta.sqlite` 查 `users.role`。任一认证方式只要 role=admin 即放行。

**Why:** CLI 用 API key，浏览器用 JWT cookie，两种方式都应支持 admin 操作。

### D3: 删除用户采用软策略——删除用户数据 + API keys + 用户记录

删除用户时：1) 删除 `data/{userId}/` 整个目录（所有页面和数据库），2) 删除 `api_keys` 表中该用户的所有 key，3) 删除 `users` 表中的记录。不可逆，前端需二次确认。

**Why:** 当前没有外键约束和级联删除，需要手动清理关联数据。不做软删除（is_deleted 标记），因为增加了后续所有查询的复杂度。

### D4: 全局页面列表通过目录遍历实现

`GET /api/admin/pages` 遍历 `data/` 下所有用户目录，读取每个 `meta.json`，支持分页和按 userId 过滤。

**Why:** 当前没有集中索引，数据分布在文件系统中。目录遍历对于 <1000 个页面足够快。如果后续页面数量增长，可引入索引。

### D5: CLI admin 命令输出 JSON

与现有 CLI 命令风格一致，stdout 输出 JSON，stderr 输出进度/错误。`admin users`、`admin pages`、`admin stats` 三个子命令。

## Risks / Trade-offs

| 风险 | 影响 | 缓解 |
|------|------|------|
| admin 角色判断每次查库 | 轻微性能开销 | 单次 SQLite 查询 <1ms，可接受 |
| 删除用户不可逆 | 误操作风险 | CLI 加确认提示，API 文档明确标注 |
| 目录遍历页面列表 | 页面多时变慢 | 加分页限制，返回摘要而非完整 meta |
| 无角色缓存 | 每次请求查库 | 角色变更场景极少，可接受 |
