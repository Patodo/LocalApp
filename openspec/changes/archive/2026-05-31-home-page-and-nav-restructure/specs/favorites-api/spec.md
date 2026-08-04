## ADDED Requirements

### Requirement: favorites 数据表

系统 SHALL 在 `meta.sqlite` 中创建 `favorites` 表，包含 `id`（自增主键）、`user_id`（TEXT NOT NULL）、`page_path`（TEXT NOT NULL）、`page_name`（TEXT）、`owner_name`（TEXT）、`created_at`（TEXT）。`(user_id, page_path)` 组合 SHALL 为 UNIQUE。

#### Scenario: 创建表和索引
- **WHEN** 系统初始化
- **THEN** `favorites` 表存在且 `user_id + page_path` 为唯一约束
- **THEN** `user_id` 列有索引

### Requirement: 添加收藏

`POST /api/favorites` SHALL 接受 JSON body `{ pagePath, pageName?, ownerName? }`，使用 session 认证的用户 ID 创建收藏记录。SHALL 返回 `{ success: true, data: { favorited: true } }`。重复收藏同一页面 SHALL 返回成功但不创建重复记录。

#### Scenario: 添加收藏成功
- **WHEN** 已登录用户 POST `{ pagePath: "testuser/my-app", pageName: "my-app", ownerName: "testuser" }`
- **THEN** 创建收藏记录，返回 `{ success: true, data: { favorited: true } }`

#### Scenario: 重复收藏幂等
- **WHEN** 用户已收藏 "testuser/my-app"，再次 POST 相同 pagePath
- **THEN** 返回成功，不创建重复记录

#### Scenario: 未登录用户添加收藏
- **WHEN** 未登录用户 POST `/api/favorites`
- **THEN** 返回 401 错误

### Requirement: 删除收藏

`DELETE /api/favorites/:pagePath` SHALL 删除当前用户对指定页面的收藏。SHALL 返回 `{ success: true, data: { favorited: false } }`。收藏不存在时 SHALL 仍返回成功。

#### Scenario: 删除收藏成功
- **WHEN** 已登录用户 DELETE `/api/favorites/testuser%2Fmy-app`
- **THEN** 删除收藏记录，返回 `{ success: true, data: { favorited: false } }`

#### Scenario: 收藏不存在
- **WHEN** 已登录用户 DELETE 不存在的 pagePath
- **THEN** 返回成功

### Requirement: 检查收藏状态

`GET /api/favorites/check?pagePath=...` SHALL 返回当前用户是否已收藏指定页面。SHALL 返回 `{ success: true, data: { favorited: boolean } }`。

#### Scenario: 已收藏
- **WHEN** 用户已收藏 "testuser/my-app"
- **THEN** 返回 `{ success: true, data: { favorited: true } }`

#### Scenario: 未收藏
- **WHEN** 用户未收藏该页面
- **THEN** 返回 `{ success: true, data: { favorited: false } }`

#### Scenario: 未登录用户检查
- **WHEN** 未登录用户访问
- **THEN** 返回 `{ success: true, data: { favorited: false } }`

### Requirement: 收藏计数

`GET /api/favorites/count?pagePath=...` SHALL 返回指定页面被所有用户收藏的总数。SHALL 返回 `{ success: true, data: { count: number } }`。

#### Scenario: 有收藏计数
- **WHEN** 页面 "testuser/my-app" 被 3 个用户收藏
- **THEN** 返回 `{ success: true, data: { count: 3 } }`

#### Scenario: 无收藏
- **WHEN** 页面没有被任何用户收藏
- **THEN** 返回 `{ success: true, data: { count: 0 } }`

### Requirement: 用户收藏列表

`GET /api/me/favorites?limit=N` SHALL 返回当前用户的收藏列表，按收藏时间倒序。每条记录 SHALL 包含 `pagePath`、`pageName`、`ownerName`、`createdAt`。

#### Scenario: 获取收藏列表
- **WHEN** 用户 GET `/api/me/favorites?limit=5`
- **THEN** 返回最多 5 条收藏记录，按 `createdAt` 倒序

#### Scenario: 无收藏
- **WHEN** 用户没有任何收藏
- **THEN** 返回 `{ success: true, data: [] }`
