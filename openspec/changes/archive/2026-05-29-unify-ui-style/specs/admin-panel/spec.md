## MODIFIED Requirements

### Requirement: 管理面板前端应用

管理面板 SHALL 是一个 React SPA，包含 6 个页面，使用 `shared.css` 定义的 design tokens 和组件样式。所有页面使用浅色主题（`var(--bg)` 底色、`var(--surface)` 卡片/侧边栏）。

#### Scenario: Admin 页面使用浅色主题
- **WHEN** admin 访问 `/admin`
- **THEN** 侧边栏底色为 `var(--surface)`，内容区底色为 `var(--bg)`，卡片底色为 `var(--surface)`，主操作色为 `var(--primary)`

#### Scenario: Admin 页面使用语义化 CSS class
- **WHEN** 检查 Admin SPA 的 TSX 源码
- **THEN** 不包含任何 Tailwind utility class，改为使用 `shared.css` 定义的组件 class

#### Scenario: Dashboard 概览页
- **WHEN** admin 访问 `/admin`
- **THEN** 展示系统概览卡片（用户数、页面数、存储量）和最近部署列表，卡片使用 `.card` class
- **AND** 数据来自 `GET /api/admin/stats`

#### Scenario: 用户管理页
- **WHEN** admin 访问 `/admin/users`
- **THEN** 展示用户表格使用 `.table` class，搜索和分页使用 `.form-input` 和 `.btn` class

#### Scenario: 应用管理页
- **WHEN** admin 访问 `/admin/pages`
- **THEN** 展示全局页面表格使用 `.table` class

#### Scenario: 系统配置页
- **WHEN** admin 访问 `/admin/settings`
- **THEN** 展示系统配置信息使用 `.card` class

#### Scenario: 导航栏
- **WHEN** admin 进入管理面板
- **THEN** 左侧显示浅色导航菜单，激活项使用 `var(--primary)` 文字色 + 浅蓝背景

### Requirement: Admin 侧边栏用户区域

Admin 侧边栏底部 SHALL 显示当前用户头像（或首字母圆形占位）、用户名、个人资料链接和退出按钮，使用浅色主题。

#### Scenario: 侧边栏用户区域浅色主题
- **WHEN** admin 进入管理面板
- **THEN** 用户区域与侧边栏使用统一浅色背景，头像占位符使用 `var(--primary)` 背景，链接使用 `var(--text-muted)` 颜色
