## Purpose

Admin Dashboard 和 Profile 页面的 React SPA 前端应用，提供管理后台和用户个人资料管理功能。

## Requirements

### Requirement: AppShell 布局

应用 SHALL 提供 AppShell 布局组件 (`(dashboard)/layout.tsx`)，包含可折叠侧边栏、顶栏、主内容区。已登录用户 SHALL 自动显示。未登录用户 SHALL 重定向到登录页。AppShell SHALL 在暗色和亮色主题下正常工作。

#### Scenario: 已登录用户看到完整布局
- **WHEN** 已登录用户访问 `/admin` 或 `/profile` 下的任意页面
- **THEN** 显示 AppShell 布局（侧边栏 + 内容区）
- **THEN** 侧边栏包含导航链接

#### Scenario: 未登录用户被重定向
- **WHEN** 未登录用户访问 `/admin`
- **THEN** 重定向到 `/login?redirect=/admin`

#### Scenario: 侧边栏折叠
- **WHEN** 用户点击侧边栏折叠按钮
- **THEN** 侧边栏缩小为仅显示图标
- **THEN** 再次点击恢复文字

### Requirement: Admin Dashboard 页面

`/admin/dashboard` SHALL 显示系统概览：用户总数、应用总数、Schema 总数、存储使用等统计卡片，以及最近部署列表。

#### Scenario: 显示统计卡片
- **WHEN** Admin 用户访问 `/admin/dashboard`
- **THEN** 显示 4 个统计卡片（用户、应用、Schema、存储）
- **THEN** 显示最近 10 次部署记录

### Requirement: Admin Analytics 页面

`/admin/analytics` SHALL 显示运营数据：请求量趋势图、页面浏览趋势图、新用户趋势图、Top 页面排行表。

#### Scenario: 查看 7 天数据趋势
- **WHEN** Admin 用户访问 `/admin/analytics`
- **THEN** 显示最近 7 天的请求量、页面浏览、新用户趋势
- **THEN** 显示 Top 20 热门页面排行

### Requirement: Admin Users 页面

`/admin/users` SHALL 显示用户分页列表。支持删除用户和重置密码操作。

#### Scenario: 用户列表和操作
- **WHEN** Admin 用户访问 `/admin/users`
- **THEN** 显示分页的用户表格
- **THEN** 每行有删除和重置密码按钮
- **THEN** 删除操作需二次确认

### Requirement: Admin Pages 页面

`/admin/pages` SHALL 显示全局应用列表，支持按用户筛选、分页、删除操作。

#### Scenario: 全局应用列表
- **WHEN** Admin 用户访问 `/admin/pages`
- **THEN** 显示所有用户的应用列表
- **THEN** 可按用户筛选
- **THEN** 每行有删除按钮

### Requirement: Admin Groups 页面

`/admin/groups` SHALL 显示系统分组列表，支持创建、编辑、删除分组，管理分组成员（增删成员）。

#### Scenario: 创建分组
- **WHEN** Admin 用户填写分组名和描述并提交
- **THEN** 调用 `POST /api/admin/groups`
- **THEN** 分组列表更新

### Requirement: Admin Settings 页面

`/admin/settings` SHALL 以只读卡片形式显示系统配置信息。

#### Scenario: 显示系统配置
- **WHEN** Admin 用户访问 `/admin/settings`
- **THEN** 显示服务器的各项配置参数（只读）

### Requirement: Profile 个人资料页面

`/profile/info` SHALL 显示个人资料编辑表单：显示名、简介、头像上传、密码修改。

#### Scenario: 编辑个人资料
- **WHEN** 用户修改显示名并保存
- **THEN** 调用 `PUT /api/me/profile`
- **THEN** 保存成功后显示成功提示

#### Scenario: 修改密码
- **WHEN** 用户填写当前密码和新密码
- **THEN** 调用 `PUT /api/me/password`
- **THEN** 成功后显示成功提示

### Requirement: Profile 应用列表页面

`/profile/apps` SHALL 显示当前用户的应用列表，每个应用可展开看版本历史和删除。

#### Scenario: 查看我的应用
- **WHEN** 用户访问 `/profile/apps`
- **THEN** 显示应用卡片列表
- **THEN** 每个应用可展开查看版本历史

### Requirement: Profile API Keys 页面

`/profile/keys` SHALL 显示 API Key 列表，支持创建新 Key 和复制。

#### Scenario: 创建 API Key
- **WHEN** 用户点击创建 API Key 按钮
- **THEN** 调用 `POST /api/keys`
- **THEN** 新 Key 显示在列表中，可一键复制

### Requirement: Profile 分组页面

`/profile/groups` SHALL 显示用户所属的分组列表，支持创建、编辑、删除分组，管理分组成员。

#### Scenario: 管理分组成员
- **WHEN** 用户选择一个分组
- **THEN** 显示分组成员列表
- **THEN** 可添加或移除成员
