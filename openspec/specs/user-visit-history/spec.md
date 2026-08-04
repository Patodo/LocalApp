## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the user-visit-history capability in LocalApp.

## Requirements

### Requirement: page_views 加 user_id 列

系统 SHALL 在 `page_views` 表中添加 `user_id TEXT` 列（可为 NULL）。记录页面访问时，若请求携带有效 session，SHALL 将 `user_id` 写入该列。无 session 的访问 `user_id` 为 NULL。SHALL 创建 `idx_page_views_user` 索引。

#### Scenario: 已登录用户访问记录含 user_id
- **WHEN** 已登录用户访问 `/testuser/my-app/`
- **THEN** page_views 记录的 `user_id` 为该用户 ID

#### Scenario: 未登录访问记录 user_id 为 NULL
- **WHEN** 未登录访问者浏览页面
- **THEN** page_views 记录的 `user_id` 为 NULL

#### Scenario: 老数据兼容
- **WHEN** 已有的 page_views 记录没有 user_id
- **THEN** 这些记录的 user_id 为 NULL，不影响查询

### Requirement: 用户最近访问 API

`GET /api/me/recent?limit=N` SHALL 返回当前用户最近访问的页面列表。SHALL 按访问时间倒序排列，去重（同一页面只保留最近一次访问）。每条记录 SHALL 包含 `pagePath` 和 `lastVisitedAt`。

#### Scenario: 获取最近访问
- **WHEN** 用户 GET `/api/me/recent?limit=5`，用户最近访问了 3 个不同页面
- **THEN** 返回 3 条记录，每条包含 `pagePath` 和 `lastVisitedAt`，按时间倒序

#### Scenario: 无访问记录
- **WHEN** 用户没有任何访问记录
- **THEN** 返回 `{ success: true, data: [] }`

#### Scenario: 同一页面多次访问去重
- **WHEN** 用户今天和昨天都访问了 "testuser/app-a"
- **THEN** 结果中 "testuser/app-a" 只出现一次，`lastVisitedAt` 为今天的时间

### Requirement: serve 路由写入 user_id

`serve.ts` 中的 `pushPageView` 调用 SHALL 传递当前请求的 `user_id`（从 session 中获取）。`PageViewEntry` 接口 SHALL 新增 `userId?: string | null` 字段。`insertPageViews` 函数 SHALL 将 `user_id` 写入数据库。

#### Scenario: 访问页面时记录 user_id
- **WHEN** 已登录用户 "alice" 访问 `/serve/testuser/my-app/`
- **THEN** `pushPageView` 被调用，参数包含 `userId: "alice"`
