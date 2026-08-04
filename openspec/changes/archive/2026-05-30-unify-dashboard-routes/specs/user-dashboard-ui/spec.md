## MODIFIED Requirements

### Requirement: Tab 布局导航

Dashboard 页面通过 `/my/*` 独立路由访问，每个功能是独立页面而非 Tab。Sidebar 导航 SHALL 提供以下链接：
- `/my/info` — 个人资料
- `/my/apps` — 我的应用
- `/my/keys` — API Key
- `/my/groups` — 我的群组

Admin 用户额外可见：
- `/my/dashboard` — 系统概览
- `/my/analytics` — 运营大盘
- `/my/users` — 用户管理
- `/my/pages` — 应用管理
- `/my/orgs` — 群组管理
- `/my/settings` — 系统配置

#### Scenario: 普通用户 sidebar
- **WHEN** 普通用户（role=user）登录后查看 sidebar
- **THEN** Sidebar 显示 Personal 分区（info、apps、keys、groups），不显示 Admin 分区

#### Scenario: Admin 用户 sidebar
- **WHEN** admin 用户登录后查看 sidebar
- **THEN** Sidebar 显示 Personal 分区和 Admin 分区，Admin 分区包含 dashboard、analytics、users、pages、orgs、settings

#### Scenario: Sidebar 链接指向 /my/*
- **WHEN** 检查 sidebar 中所有导航链接的 href
- **THEN** 所有链接以 `/my/` 开头，不包含 `/admin/` 或 `/profile/` 路径
