## Purpose

用户面板 UI，扩展 `/profile` SPA 为带 Tab 切换的管理面板，包含个人资料、我的应用、API Key 三个 Tab。

## ADDED Requirements

### Requirement: Tab 布局导航

`/profile` 页面 SHALL 显示 Tab 栏，包含三个选项卡："个人资料"、"我的应用"、"API Key"。默认激活"个人资料" Tab。Tab 切换 SHALL 通过组件状态管理，不使用 URL 路由。

#### Scenario: 默认显示个人资料 Tab
- **WHEN** 用户访问 `/profile`
- **THEN** 页面显示 Tab 栏，"个人资料" Tab 为激活状态，显示个人资料编辑表单

#### Scenario: 切换到我的应用 Tab
- **WHEN** 用户点击"我的应用" Tab
- **THEN** Tab 栏中"我的应用"变为激活状态，页面内容切换为应用列表

#### Scenario: 切换到 API Key Tab
- **WHEN** 用户点击"API Key" Tab
- **THEN** Tab 栏中"API Key"变为激活状态，页面内容切换为 API Key 管理界面

### Requirement: 我的应用列表

"我的应用" Tab SHALL 显示当前用户的所有应用。每个应用条目 MUST 展示应用名称、当前版本号、最后更新时间。列表 SHALL 通过 `GET /api/pages` 获取数据。

#### Scenario: 有应用时显示列表
- **WHEN** 用户点击"我的应用" Tab 且用户有已创建的应用
- **THEN** 页面显示应用卡片/行列表，每个应用展示名称、版本号和更新时间

#### Scenario: 无应用时显示空状态
- **WHEN** 用户点击"我的应用" Tab 且用户没有任何应用
- **THEN** 页面显示空状态提示，告知用户可通过 CLI 创建应用

### Requirement: 删除应用

每个应用条目 SHALL 提供删除按钮。点击删除按钮 MUST 弹出确认对话框。确认后 SHALL 调用 `DELETE /api/pages/:name` 删除应用。删除成功后 MUST 从列表中移除该应用。

#### Scenario: 删除应用成功
- **WHEN** 用户点击某应用的删除按钮并确认
- **THEN** 系统调用 `DELETE /api/pages/:name`，成功后该应用从列表消失，显示成功提示

#### Scenario: 取消删除
- **WHEN** 用户点击某应用的删除按钮但取消确认
- **THEN** 对话框关闭，应用列表无变化

### Requirement: 应用详情展开

点击应用条目 SHALL 展开详情面板，显示应用的完整信息：用户 ID、版本历史列表、创建时间。详情 SHALL 通过 `GET /api/pages/:name` 获取。

#### Scenario: 展开应用详情
- **WHEN** 用户点击某个应用条目
- **THEN** 展开详情面板，显示 userId、版本历史（版本号和创建时间）、创建时间

#### Scenario: 收起应用详情
- **WHEN** 用户再次点击已展开的应用条目
- **THEN** 详情面板收起，恢复为紧凑显示

### Requirement: API Key 列表与展示

"API Key" Tab SHALL 显示当前用户的所有 API Key。每个 Key 条目 MUST 展示完整 Key 字符串、创建时间。列表 SHALL 通过 `GET /api/keys` 获取。

#### Scenario: 有 Key 时显示列表
- **WHEN** 用户点击"API Key" Tab 且用户有已创建的 API Key
- **THEN** 页面显示 Key 列表，每个 Key 展示完整 Key 字符串和创建时间

#### Scenario: 无 Key 时显示空状态
- **WHEN** 用户点击"API Key" Tab 且用户没有 API Key
- **THEN** 页面显示空状态提示

### Requirement: 复制 API Key

每个 Key 条目 SHALL 提供复制按钮。点击后 SHALL 将完整 Key 复制到系统剪贴板，并显示复制成功提示。

#### Scenario: 复制 Key 到剪贴板
- **WHEN** 用户点击某个 Key 条目的复制按钮
- **THEN** 完整 Key 字符串被复制到剪贴板，按钮状态变为"已复制"或显示成功提示

### Requirement: 创建新 API Key

"API Key" Tab SHALL 提供创建按钮。点击后 SHALL 调用 `POST /api/keys` 创建新 Key，创建成功后 MUST 立即将新 Key 显示在列表中。

#### Scenario: 创建新 Key 成功
- **WHEN** 用户点击创建按钮
- **THEN** 系统调用 `POST /api/keys`，成功后新 Key 出现在列表顶部，用户可立即复制

### Requirement: 页面顶部用户信息栏

面板顶部 SHALL 显示当前用户的头像、用户名和角色。未登录时 SHALL 重定向到 `/login?redirect=/profile`。

#### Scenario: 已登录显示用户信息
- **WHEN** 用户已登录并访问 `/profile`
- **THEN** 页面顶部显示用户头像、用户名和角色标签

#### Scenario: 未登录重定向
- **WHEN** 未登录用户访问 `/profile`
- **THEN** 重定向到 `/login?redirect=/profile`
