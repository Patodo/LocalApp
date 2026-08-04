## Purpose

用户面板 UI，通过 `/my/*` 独立路由提供用户个人页面，包含个人资料、我的应用、API Key、我的群组等功能。Admin 用户额外可见系统管理页面。

## Requirements

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

### Requirement: 应用详情展开

点击应用条目 SHALL 展开详情面板，显示应用的完整信息：用户 ID、版本历史列表、创建时间。详情 SHALL 通过 `GET /api/pages/:name` 获取。

#### Scenario: 展开应用详情
- **WHEN** 用户点击某个应用条目
- **THEN** 展开详情面板，显示 userId、版本历史（版本号和创建时间）、创建时间

#### Scenario: 收起应用详情
- **WHEN** 用户再次点击已展开的应用条目
- **THEN** 详情面板收起，恢复为紧凑显示

### Requirement: API Key 列表与展示

`/my/keys` 页面 SHALL 显示当前用户的所有 API Key。每个 Key 条目 MUST 展示完整 Key 字符串、创建时间。列表 SHALL 通过 `GET /api/keys` 获取。

#### Scenario: 有 Key 时显示列表
- **WHEN** 用户访问 `/my/keys` 且用户有已创建的 API Key
- **THEN** 页面显示 Key 列表，每个 Key 展示完整 Key 字符串和创建时间

#### Scenario: 无 Key 时显示空状态
- **WHEN** 用户访问 `/my/keys` 且用户没有 API Key
- **THEN** 页面显示空状态提示

### Requirement: 复制 API Key

每个 Key 条目 SHALL 提供复制按钮。点击后 SHALL 将完整 Key 复制到系统剪贴板，并显示复制成功提示。

#### Scenario: 复制 Key 到剪贴板
- **WHEN** 用户点击某个 Key 条目的复制按钮
- **THEN** 完整 Key 字符串被复制到剪贴板，按钮状态变为"已复制"或显示成功提示

### Requirement: 创建新 API Key

`/my/keys` 页面 SHALL 提供创建按钮。点击后 SHALL 调用 `POST /api/keys` 创建新 Key，创建成功后 MUST 立即将新 Key 显示在列表中。

#### Scenario: 创建新 Key 成功
- **WHEN** 用户点击创建按钮
- **THEN** 系统调用 `POST /api/keys`，成功后新 Key 出现在列表顶部，用户可立即复制

### Requirement: 页面顶部用户信息栏

面板顶部 SHALL 显示当前用户的头像、用户名和角色。未登录时 SHALL 重定向到 `/login?redirect=/my/profile`。

#### Scenario: 已登录显示用户信息
- **WHEN** 用户已登录并访问 `/my/profile`
- **THEN** 页面顶部显示用户头像、用户名和角色标签

#### Scenario: 未登录重定向
- **WHEN** 未登录用户访问 `/my/profile`
- **THEN** 重定向到 `/login?redirect=/my/profile`

### Requirement: 首页 Favorites 链接修复

首页 Favorites 模块的"查看全部"链接 SHALL 指向 `/my/favorites`。

#### Scenario: 点击 Favorites 查看全部
- **WHEN** 用户点击首页 Favorites 模块的"查看全部"链接
- **THEN** 浏览器跳转到 `/my/favorites`

### Requirement: 首页 Recent 查看全部链接

首页 Recent 模块 SHALL 提供"查看全部"链接，指向 `/my/recent`。

#### Scenario: 点击 Recent 查看全部
- **WHEN** 用户点击首页 Recent 模块的"查看全部"链接
- **THEN** 浏览器跳转到 `/my/recent`

### Requirement: 登录后 CLI 获取说明

登录后的用户面板 SHALL 提供 CLI 获取和配置说明入口。该入口 MUST 说明 CLI 需要登录态或 API Key 配置，并提供用户可执行的下一步，例如查看 API Key、运行登录命令或执行更新命令。

#### Scenario: 用户在面板中看到 CLI 获取方式

- **WHEN** 已登录用户访问包含 CLI 说明的用户面板页面
- **THEN** 页面显示 CLI 的用途说明
- **THEN** 页面显示与当前用户相关的配置下一步，例如 API Key 页面、`localapp login` 或 `localapp update`
- **THEN** 页面不得要求用户复制 server 内部 release 目录

#### Scenario: 未登录用户不能访问 CLI 获取说明

- **WHEN** 未登录用户访问 CLI 获取说明所在的 `/my/*` 页面
- **THEN** 页面重定向到登录页

### Requirement: 公开首页到登录后能力的转接

公开首页提到 CLI、API Key 或上传能力时，SHALL 将这些能力描述为登录后可用，不得在公开首页提供需要鉴权的直接操作。

#### Scenario: 公开首页引导登录后获取 CLI

- **WHEN** 未登录用户在公开首页看到 CLI 相关文案
- **THEN** 文案明确说明需要登录后获取或配置
- **THEN** 点击主要入口会在首页打开登录模态框
