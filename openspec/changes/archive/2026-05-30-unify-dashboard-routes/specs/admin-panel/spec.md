## MODIFIED Requirements

### Requirement: 管理面板前端应用
管理面板 SHALL 是一个 React SPA，包含 6 个页面，使用 `shared.css` 定义的 design tokens 和组件样式。所有页面使用浅色主题（`var(--bg)` 底色、`var(--surface)` 卡片/侧边栏）。管理面板通过 `/my/dashboard`、`/my/analytics`、`/my/users`、`/my/pages`、`/my/orgs`、`/my/settings` 路径访问。

#### Scenario: Admin 页面使用浅色主题
- **WHEN** admin 访问 `/my/dashboard`
- **THEN** 侧边栏底色为 `var(--surface)`，内容区底色为 `var(--bg)`，卡片底色为 `var(--surface)`，主操作色为 `var(--primary)`

#### Scenario: Dashboard 概览页
- **WHEN** admin 访问 `/my/dashboard`
- **THEN** 展示系统概览卡片（用户数、页面数、存储量）和最近部署列表，卡片使用 `.card` class
- **AND** 数据来自 `GET /api/admin/stats`

#### Scenario: 用户管理页
- **WHEN** admin 访问 `/my/users`
- **THEN** 展示用户表格（ID、名称、角色、页面数、存储用量、注册时间），支持分页，表格使用 `.table` class，搜索和分页使用 `.form-input` 和 `.btn` class

#### Scenario: 应用管理页
- **WHEN** admin 访问 `/my/pages`
- **THEN** 展示全局页面表格（名称、所有者、版本数、存储大小、更新时间），支持分页和按用户过滤

#### Scenario: 系统配置页
- **WHEN** admin 访问 `/my/settings`
- **THEN** 展示系统配置信息（模板仓库 URL、存储限制、最大版本数等），当前为只读展示

#### Scenario: 导航栏
- **WHEN** admin 进入管理面板
- **THEN** 左侧显示浅色导航菜单（概览、运营大盘、用户、应用、分组、配置），激活项使用 `var(--primary)` 文字色 + 浅蓝背景
- **AND** 导航链接指向 `/my/dashboard`、`/my/analytics`、`/my/users`、`/my/pages`、`/my/orgs`、`/my/settings`

### Requirement: Admin 侧边栏用户区域

Admin 侧边栏底部 SHALL 显示当前用户头像（或首字母圆形占位）、用户名、个人资料链接和退出按钮。

#### Scenario: 跳转到 Profile
- **WHEN** 管理员点击"个人资料"链接
- **THEN** 浏览器跳转到 `/my/info`
