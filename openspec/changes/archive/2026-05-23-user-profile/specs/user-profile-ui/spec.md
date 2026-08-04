## ADDED Requirements

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

### Requirement: Profile 页面功能

Profile SPA SHALL 展示和编辑当前用户的个人资料，包含以下区域：

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

### Requirement: Profile SPA 独立包

Profile SPA SHALL 作为独立包存在于 `packages/profile/`，使用 React + Vite + Tailwind 构建。

#### Scenario: 构建输出
- **WHEN** 在 `packages/profile/` 执行构建
- **THEN** 产物输出到 `packages/server/static/profile/`

#### Scenario: 技术栈
- **WHEN** Profile 页面加载
- **THEN** 使用 React、Vite、Tailwind CSS，与 Admin Panel 一致的技术栈
