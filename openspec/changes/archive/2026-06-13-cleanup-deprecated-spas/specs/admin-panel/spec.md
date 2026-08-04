## MODIFIED Requirements

### Requirement: 管理面板前端应用

管理面板 SHALL 是一个 Next.js App Router 应用，包含 6 个页面，使用 `shared.css` 定义的 design tokens 和组件样式。所有页面使用浅色主题（`var(--bg)` 底色、`var(--surface)` 卡片/侧边栏）。管理面板通过 `/my/dashboard`、`/my/analytics`、`/my/users`、`/my/pages`、`/my/orgs`、`/my/settings` 路径访问。

#### Scenario: Admin 页面使用浅色主题
- **WHEN** admin 访问 `/my/dashboard`
- **THEN** 侧边栏底色为 `var(--surface)`，内容区底色为 `var(--bg)`，卡片底色为 `var(--surface)`，主操作色为 `var(--primary)`

#### Scenario: Admin 页面使用语义化 CSS class
- **WHEN** 检查 Admin 的 TSX 源码
- **THEN** 不包含任何 Tailwind utility class，改为使用 `shared.css` 定义的组件 class

#### Scenario: Dashboard 概览页
- **WHEN** admin 访问 `/my/dashboard`
- **THEN** 展示系统概览卡片（用户数、页面数、存储量）和最近部署列表，卡片使用 `.card` class
- **AND** 数据来自 `GET /api/admin/stats`

#### Scenario: 用户管理页
- **WHEN** admin 访问 `/my/users`
- **THEN** 展示用户表格（ID、名称、角色、页面数、存储用量、注册时间），支持分页，表格使用 `.table` class，搜索和分页使用 `.form-input` 和 `.btn` class
- **AND** 每行有"删除"按钮，点击弹出确认对话框
- **AND** 每行有"重置密码"按钮，点击后该用户的 `mustChangePassword` 标记被置为 true

#### Scenario: 用户管理页支持创建用户
- **WHEN** admin 在 `/my/users` 页面点击"创建用户"按钮
- **THEN** 弹出表单（用户名输入框 + 提交/取消按钮），提交时调用 `POST /api/admin/users` 请求体 `{ username }`
- **AND** 创建成功后用户名清空、弹窗关闭、用户列表刷新，并显示 toast 提示"用户 {username} 已创建，默认密码 localapp"
- **AND** 创建成功的新用户 `mustChangePassword` 为 true，首次登录会进入强制改密流程

#### Scenario: 创建用户 — 用户名格式校验
- **WHEN** admin 提交的用户名不符合格式要求（如包含非法字符或长度不足）
- **THEN** 前端展示服务端返回的错误信息（HTTP 400 "Invalid username format"）

#### Scenario: 创建用户 — 用户名已存在
- **WHEN** admin 提交的用户名已被占用
- **THEN** 前端展示服务端返回的错误信息（HTTP 409 "Username already exists"），弹窗保持打开，用户名不清空

#### Scenario: 应用管理页
- **WHEN** admin 访问 `/my/pages`
- **THEN** 展示全局页面表格（名称、所有者、版本数、存储大小、更新时间），支持分页和按用户过滤，表格使用 `.table` class
- **AND** 每行有"删除"按钮

#### Scenario: 系统配置页
- **WHEN** admin 访问 `/my/settings`
- **THEN** 展示系统配置信息（模板仓库 URL、存储限制、最大版本数等），当前为只读展示，使用 `.card` class

#### Scenario: 导航栏
- **WHEN** admin 进入管理面板
- **THEN** 左侧显示浅色导航菜单（概览、运营大盘、用户、应用、分组、配置），激活项使用 `var(--primary)` 文字色 + 浅蓝背景
- **AND** 导航链接指向 `/my/dashboard`、`/my/analytics`、`/my/users`、`/my/pages`、`/my/orgs`、`/my/settings`
