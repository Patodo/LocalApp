## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the admin-panel capability in LocalApp.

## Requirements

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
- **AND** 创建成功后用户名清空、创建表单关闭、用户列表刷新
- **AND** 打开一次性凭据对话框，显示用户名、随机临时密码和初始 API Key，并提供复制操作和关闭后不可恢复的提示
- **AND** 创建成功的新用户 `mustChangePassword` 为 true，首次登录进入强制改密流程

#### Scenario: 创建用户 — 用户名格式校验
- **WHEN** admin 提交的用户名不符合格式要求（如包含非法字符或长度不足）
- **THEN** 前端展示服务端返回的错误信息（HTTP 400 "Invalid username format"）

#### Scenario: 创建用户 — 用户名已存在
- **WHEN** admin 提交的用户名已被占用
- **THEN** 前端展示服务端返回的错误信息（HTTP 409 "Username already exists"），弹窗保持打开，用户名不清空

#### Scenario: 用户管理页支持重置随机临时密码
- **WHEN** admin 在 `/my/users` 页面确认某用户的"重置密码"操作
- **THEN** 调用 `POST /api/admin/reset-password`
- **AND** 成功后打开一次性凭据对话框，仅显示本次随机临时密码及复制操作
- **AND** 页面不得显示固定默认密码，不得将临时密码写入 URL 或浏览器持久存储

#### Scenario: 用户管理页支持切换用户角色
- **WHEN** admin 在 `/my/users` 页面查看某行（`id != 'localadmin'`）
- **THEN** 该行操作区显示「切换角色」按钮，按钮文案根据用户当前 role 动态变化：`role='user'` 时显示「提升为管理员」，`role='admin'` 时显示「降级为用户」
- **AND** 点击按钮进入二段式确认（与「重置密码」「删除」一致），显示 `[确认] [取消]`，确认时调用 `PATCH /api/admin/users/:id/role` 请求体 `{ role }`
- **AND** 操作成功后用户列表刷新，toast 提示「已将 {name} 切换为 {role中文}」
- **AND** 服务端返回 400（自我降级、最后 admin、保护账户）或 404 时，前端展示对应错误 toast，列表不刷新

#### Scenario: 用户管理页 localadmin 行受保护
- **WHEN** admin 在 `/my/users` 页面查看 `id='localadmin'` 的行
- **THEN** 该行的「切换角色」「删除」按钮均不渲染
- **AND** 角色列右侧追加锁标识图标（含 `title="系统保护账户，不可降级或删除"`），视觉上明确该用户受特殊保护

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

### Requirement: Admin 侧边栏用户区域

Admin 侧边栏底部 SHALL 显示当前用户头像（或首字母圆形占位）、用户名、个人资料链接和退出按钮，使用浅色主题。

#### Scenario: 侧边栏用户区域浅色主题
- **WHEN** admin 进入管理面板
- **THEN** 用户区域与侧边栏使用统一浅色背景，头像占位符使用 `var(--primary)` 背景，链接使用 `var(--text-muted)` 颜色

#### Scenario: 管理员有头像
- **WHEN** 管理员用户有头像
- **THEN** 侧边栏底部显示头像图片、用户名、"个人资料"链接、退出按钮

#### Scenario: 管理员无头像
- **WHEN** 管理员用户没有头像
- **THEN** 侧边栏底部显示首字母占位头像、用户名、"个人资料"链接、退出按钮

#### Scenario: 跳转到 Profile
- **WHEN** 管理员点击"个人资料"链接
- **THEN** 浏览器跳转到 `/my/info`
