## MODIFIED Requirements

### Requirement: admin 面板导航结构

admin 面板侧边栏 SHALL 包含以下导航项：概览（`/admin`）、运营大盘（`/admin/analytics`）、用户（`/admin/users`）、应用（`/admin/pages`）、分组（`/admin/groups`）、配置（`/admin/settings`）。

#### Scenario: 侧边栏显示所有导航项
- **WHEN** 管理员访问 `/admin`
- **THEN** 侧边栏可见概览、运营大盘、用户、应用、分组、配置六个导航项

#### Scenario: 分组导航路由可用
- **WHEN** 管理员访问 `/admin/groups`
- **THEN** 显示群组管理页面而非 404
