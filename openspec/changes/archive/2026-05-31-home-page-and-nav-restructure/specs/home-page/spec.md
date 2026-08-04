## ADDED Requirements

### Requirement: 首页三模块布局

`/` 路径 SHALL 渲染一个包含三个模块的首页：我的应用（卡片网格）、收藏应用（列表）、最近访问（列表）。已登录用户 SHALL 看到三个模块的实际数据。未登录用户 SHALL 重定向到 `/login?redirect=/`。

#### Scenario: 已登录用户看到完整首页
- **WHEN** 已登录用户访问 `GET /`
- **THEN** 页面渲染三个模块："我的应用"显示最多 8 个应用卡片、"收藏应用"显示最多 5 条收藏列表、"最近访问"显示最多 5 条访问记录
- **THEN** 每个模块标题右侧显示"查看全部"链接

#### Scenario: 未登录用户被重定向
- **WHEN** 未登录用户访问 `GET /`
- **THEN** 页面重定向到 `/login?redirect=/`

### Requirement: 我的应用模块

"我的应用"模块 SHALL 通过 `GET /api/me/pages?limit=8` 获取数据，以卡片网格展示。每个卡片 SHALL 显示应用名称。模块标题旁 SHALL 显示应用总数。

#### Scenario: 有应用时显示卡片网格
- **WHEN** 用户拥有 3 个应用
- **THEN** 显示 3 张应用卡片，每张显示应用名称
- **THEN** "查看全部"链接指向 `/my/apps`

#### Scenario: 无应用时显示空状态
- **WHEN** 用户没有应用
- **THEN** 显示空状态提示文字

### Requirement: 收藏应用模块

"收藏应用"模块 SHALL 通过 `GET /api/me/favorites?limit=5` 获取数据，以列表形式展示。每条记录 SHALL 显示应用名称和收藏时间。

#### Scenario: 有收藏时显示列表
- **WHEN** 用户收藏了 2 个应用
- **THEN** 显示 2 条列表项，每条显示应用名称和相对时间
- **THEN** "查看全部"链接指向 `/my/apps`（收藏 Tab）

#### Scenario: 无收藏时显示空状态
- **WHEN** 用户没有收藏
- **THEN** 显示空状态提示文字

### Requirement: 最近访问模块

"最近访问"模块 SHALL 通过 `GET /api/me/recent?limit=5` 获取数据，以列表形式展示。每条记录 SHALL 显示应用名称和访问时间。

#### Scenario: 有访问记录时显示列表
- **WHEN** 用户最近访问过 4 个应用
- **THEN** 显示 4 条列表项，每条显示应用名称和相对时间，按访问时间倒序排列

#### Scenario: 无访问记录时显示空状态
- **WHEN** 用户没有访问记录
- **THEN** 显示空状态提示文字

### Requirement: 模块独立加载状态

三个模块 SHALL 独立加载。一个模块加载失败 SHALL NOT 影响其他模块的显示。每个模块在数据加载中 SHALL 显示 loading 占位。

#### Scenario: 部分模块加载失败
- **WHEN** 我的应用请求成功但收藏请求失败
- **THEN** 我的应用模块正常显示数据
- **THEN** 收藏模块显示错误提示或空状态
- **THEN** 最近访问模块正常加载不受影响
