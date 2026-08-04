## MODIFIED Requirements

### Requirement: Sidebar 布局导航

Dashboard 侧边栏 SHALL 提供以下导航链接：
- `/my/info` — 个人资料
- `/my/apps` — 我的应用
- `/my/keys` — API 密钥
- `/my/groups` — 我的群组
- `/my/favorites` — 我的收藏
- `/my/recent` — 浏览历史

Admin 用户额外可见 Admin 分区（链接不变）。

#### Scenario: 侧边栏包含收藏和历史入口
- **WHEN** 用户查看侧边栏 Personal 分区
- **THEN** 显示"我的收藏"（`/my/favorites`）和"浏览历史"（`/my/recent`）两个导航项

## ADDED Requirements

### Requirement: 首页 Favorites 链接修复

首页 Favorites 模块的"查看全部"链接 SHALL 指向 `/my/favorites`。

#### Scenario: 点击 Favorites 查看全部
- **WHEN** 用户点击首页 Favorites 模块的"查看全部"链接
- **THEN** 浏览器跳转到 `/my/favorites`

### Requirement: 首页 Recent 查看全部链接

首页 Recent 模块 SHALL 提供"查看全部"链接，指向 `/my/recent`。

#### Scenario: 点击 Recent 查看全部
- **WHEN** 用户点击首页 Recent 模块的"查看全部"链接
- **THEN** 浏览器跳转到 `/my/recent`
