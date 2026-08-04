## NEW Requirements

### Requirement: 管理面板前端应用
管理面板 SHALL 是一个 React SPA，包含 4 个页面。

#### Scenario: Dashboard 概览页
- **WHEN** admin 访问 `/admin`
- **THEN** 展示系统概览卡片（用户数、页面数、存储量）和最近部署列表
- **AND** 数据来自 `GET /api/admin/stats`

#### Scenario: 用户管理页
- **WHEN** admin 访问 `/admin/users`
- **THEN** 展示用户表格（ID、名称、角色、页面数、存储用量、注册时间），支持分页
- **AND** 每行有"删除"按钮，点击弹出确认对话框

#### Scenario: 应用管理页
- **WHEN** admin 访问 `/admin/pages`
- **THEN** 展示全局页面表格（名称、所有者、版本数、存储大小、更新时间），支持分页和按用户过滤
- **AND** 每行有"删除"按钮

#### Scenario: 系统配置页
- **WHEN** admin 访问 `/admin/settings`
- **THEN** 展示系统配置信息（模板仓库 URL、存储限制、最大版本数等），当前为只读展示

#### Scenario: 导航栏
- **WHEN** admin 进入管理面板
- **THEN** 左侧显示导航菜单（概览、用户、应用、配置），右上角显示 admin 用户名和退出按钮
