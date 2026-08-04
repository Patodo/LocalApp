## MODIFIED Requirements

### Requirement: Tab 布局导航

用户面板路由 SHALL 从 `/profile/*` 迁移到 `/my/*`。侧边栏 SHALL 在顶部固定显示 Home 图标链接（指向 `/`），下方按条件显示个人区域（`/my/*`）或管理区域（`/admin/*`）。admin 角色 SHALL 同时看到两个区域。

#### Scenario: 默认显示个人资料页面
- **WHEN** 用户访问 `/my/profile`
- **THEN** 侧边栏 Home 入口可见，"Profile" 导航项为激活状态，显示个人资料编辑表单

#### Scenario: 切换到我的应用
- **WHEN** 用户访问 `/my/apps`
- **THEN** 侧边栏 "My Apps" 导航项为激活状态，页面显示应用列表

#### Scenario: Home 入口始终可见
- **WHEN** 用户在任何 dashboard 页面
- **THEN** 侧边栏顶部显示 Home 图标，点击跳转到 `/`

#### Scenario: admin 用户看到两个区域
- **WHEN** admin 角色用户在 `/my/*` 页面
- **THEN** 侧边栏显示个人区域（Home、Profile、My Apps、API Keys、Groups）和管理区域（Overview、Analytics、Users、Apps、Groups、Settings）

### Requirement: 我的应用列表

"我的应用"页面 SHALL 通过 `GET /api/me/pages` 获取数据（session auth），替代原来的 `GET /api/pages`（API key auth）。每个应用条目 MUST 展示应用名称、当前版本号、最后更新时间。

#### Scenario: 有应用时显示列表
- **WHEN** 用户访问 `/my/apps` 且有已创建的应用
- **THEN** 页面显示应用卡片/行列表，每个应用展示名称、版本号和更新时间

#### Scenario: 无应用时显示空状态
- **WHEN** 用户访问 `/my/apps` 且没有任何应用
- **THEN** 页面显示空状态提示

### Requirement: 删除应用

删除应用 SHALL 调用 `DELETE /api/me/pages/:name`（session auth），替代原来的 API key auth 端点。

#### Scenario: 删除应用成功
- **WHEN** 用户点击某应用的删除按钮并确认
- **THEN** 系统调用 `DELETE /api/me/pages/:name`，成功后该应用从列表消失

### Requirement: 页面顶部用户信息栏

面板顶部 SHALL 显示当前用户的头像、用户名和角色。未登录时 SHALL 重定向到 `/login?redirect=/my/profile`。

#### Scenario: 已登录显示用户信息
- **WHEN** 用户已登录并访问 `/my/profile`
- **THEN** 页面顶部显示用户头像、用户名和角色标签

#### Scenario: 未登录重定向
- **WHEN** 未登录用户访问 `/my/profile`
- **THEN** 重定向到 `/login?redirect=/my/profile`
