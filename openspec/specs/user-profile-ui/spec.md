## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the user-profile-ui capability in LocalApp.

## Requirements

### Requirement: Profile 页面访问

系统 SHALL 在 `/profile` 路径提供个人资料 SPA 页面，任何已登录用户均可访问。

#### Scenario: 已登录用户访问 Profile
- **WHEN** 已登录用户请求 `GET /profile`
- **THEN** 返回 Profile SPA 的 index.html，注入 `window.__USER__` 包含用户信息

#### Scenario: 未登录用户访问 Profile
- **WHEN** 未登录用户请求 `GET /profile`
- **THEN** 重定向到 `/login?redirect=/profile`

#### Scenario: Profile 静态资源
- **WHEN** 请求 `GET /profile/assets/*`
- **THEN** 返回对应的静态文件（JS/CSS/图片）

### Requirement: profile 页面 tab 结构

profile 页面 tab 栏 SHALL 包含以下选项卡：个人资料、我的应用、API Key、分组。Tab 栏使用浅色主题样式，激活 tab 使用 `var(--primary)` 下划线标识。

#### Scenario: tab 栏显示分组选项
- **WHEN** 用户访问 `/profile`
- **THEN** tab 栏可见个人资料、我的应用、API Key、分组四个选项卡

#### Scenario: Tab 栏浅色主题
- **WHEN** 用户访问 `/profile`
- **THEN** tab 栏底色为 `var(--surface)`，激活 tab 底部边框为 `var(--primary)`，非激活 tab 文字为 `var(--text-muted)`

### Requirement: Profile 页面功能

Profile SPA SHALL 展示和编辑当前用户的个人资料，包含以下区域，使用 `shared.css` 定义的 design tokens 和组件样式：

- 头像上传区域：圆形头像 + hover 覆盖层
- 只读字段：用户名、角色
- 可编辑字段：昵称、简介
- 密码修改区域：当前密码、新密码、确认密码
- 所有页面使用浅色主题（`var(--bg)` 底色、`var(--surface)` 卡片）

#### Scenario: Profile 页面使用浅色主题
- **WHEN** 已登录用户访问 `/profile`
- **THEN** 页面底色为 `#f8f9fa`，卡片/表单底色为 `#ffffff`，主操作按钮为 `#2563eb`

#### Scenario: Profile 页面使用语义化 CSS class
- **WHEN** 检查 Profile SPA 的 TSX 源码
- **THEN** 不包含任何 Tailwind utility class（如 `bg-gray-`、`text-sm`、`px-4`），改为使用 `shared.css` 定义的组件 class

#### Scenario: 查看个人资料
- **WHEN** 用户打开 Profile 页面
- **THEN** 显示当前用户的头像、用户名（只读）、角色（只读）、昵称（可编辑）、简介（可编辑）

#### Scenario: 编辑昵称和简介
- **WHEN** 用户修改昵称或简介后点击保存
- **THEN** 调用 `PUT /api/me/profile`，成功后显示成功提示

#### Scenario: 上传头像
- **WHEN** 用户点击头像区域选择新图片
- **THEN** 调用 `POST /api/me/avatar` 上传，成功后更新页面上显示的头像

#### Scenario: 修改密码
- **WHEN** 用户填写当前密码和新密码后点击修改
- **THEN** 调用 `PUT /api/me/password`，成功后显示成功提示

#### Scenario: 头像展示
- **WHEN** 用户有头像
- **THEN** 头像区域显示 `GET /api/me/avatar` 返回的图片

#### Scenario: 默认头像
- **WHEN** 用户没有设置头像
- **THEN** 显示用户名首字母生成的占位头像

### Requirement: Profile 页面 tab 切换行为

Profile SPA 的 TabLayout 顶部栏 SHALL 显示用户头像（或首字母圆形占位）和用户名，使用浅色主题。顶部栏 SHALL 包含退出登录链接。

#### Scenario: 顶部栏浅色主题
- **WHEN** 用户访问 `/profile`
- **THEN** 顶部栏底色为 `var(--surface)`，文字为 `var(--text)`，头像占位符背景为 `var(--primary)`

### Requirement: Profile SPA 独立包

Profile SPA SHALL 作为独立包存在于 `packages/profile/`，使用 React + Vite + shared.css 构建。

#### Scenario: 构建输出
- **WHEN** 在 `packages/profile/` 执行构建
- **THEN** 产物输出到 `packages/server/static/profile/`

#### Scenario: 技术栈
- **WHEN** Profile 页面加载
- **THEN** 使用 React、Vite、shared.css，与 Admin Panel 一致的技术栈
