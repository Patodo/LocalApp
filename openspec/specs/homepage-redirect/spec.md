## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the homepage-redirect capability in LocalApp.

## Requirements

### Requirement: 根路径首页渲染

`GET /` SHALL 对已登录和未登录用户都返回首页 HTML。已登录用户 SHALL 渲染首页组件（三模块布局）；未登录用户 SHALL 渲染公开产品首页并在当前页面提供登录模态框入口，不得重定向到 `/login?redirect=/`。

#### Scenario: 已登录用户看到首页
- **WHEN** 携带有效 session cookie 请求 `GET /`
- **THEN** 渲染首页组件，显示"我的应用"、"收藏应用"、"最近访问"三个模块

#### Scenario: 未登录用户访问根路径
- **WHEN** 不携带 session cookie 请求 `GET /`
- **THEN** 返回 HTTP 200 并渲染公开首页
- **AND** 浏览器地址保持 `/`

#### Scenario: 登录后回到首页
- **WHEN** 用户在 `/login` 页面登录成功，redirect 参数为 `/`
- **THEN** 跳转到 `/`，渲染首页内容

### Requirement: 登录页面视觉风格

登录页面（`buildLoginPage()`）SHALL 使用浅色主题，底色 `#f8f9fa`，登录卡片白底圆角 + 微妙阴影，主按钮使用 `#2563eb` 背景。页面 SHALL 引用 shared.css 中定义的 design tokens。

#### Scenario: 登录页面浅色主题
- **WHEN** 用户访问 `/login`
- **THEN** 页面底色为 `#f8f9fa`，登录卡片背景为 `#ffffff`、圆角 `12px`、阴影，按钮背景为 `#2563eb`、hover 为 `#1d4ed8`

#### Scenario: 登录页面表单样式
- **WHEN** 用户查看登录表单
- **THEN** 输入框使用 `8px` 圆角、focus 时有蓝色外发光效果，placeholder 文字为灰色

### Requirement: 强制改密页面视觉风格

强制改密页面（`buildForceChangePasswordPage()`）SHALL 使用与登录页面一致的浅色主题和组件样式。

#### Scenario: 强制改密页面风格一致
- **WHEN** 用户访问 `/force-change-password`
- **THEN** 页面视觉风格与登录页面完全一致

### Requirement: 应用外壳导航栏视觉风格

应用外壳导航栏（`buildPlatformShell()`）SHALL 使用浅色主题，底色 `#ffffff`，文字 `#1a1d23`，链接使用 `var(--primary)` 色。

#### Scenario: 外壳导航栏浅色主题
- **WHEN** 用户访问 `/:userId/:name`
- **THEN** 顶部导航栏底色为 `#ffffff`，页面标题文字为 `#1a1d23`，链接为 `#2563eb`，退出按钮边框为 `var(--primary)`

#### Scenario: 外壳导航栏用户头像
- **WHEN** 已登录用户有头像
- **THEN** 导航栏显示圆形头像，无头像时显示首字母圆形占位，占位符背景为 `var(--primary)`

### Requirement: 404 页面 HTML 渲染

当请求的页面路径不存在时，服务端 SHALL 返回 HTML 格式的 404 页面，而非 JSON。

#### Scenario: 用户应用页面不存在
- **WHEN** 请求 `GET /nonuser/nonapp` 且 readPageMeta 返回 null
- **THEN** 返回 404 状态码和 HTML 内容，页面提示"页面不存在"

#### Scenario: dashboard 子页面不存在
- **WHEN** 已登录用户请求 `GET /my/nonexistent`
- **THEN** 返回 404 状态码和 HTML 内容

### Requirement: 隐藏暗黑模式切换按钮

ThemeToggle 浮动按钮 SHALL 从页面布局中移除，ThemeProvider 保留以维持现有样式。

#### Scenario: 页面无暗黑模式切换按钮
- **WHEN** 用户访问任意页面
- **THEN** 页面右上角不显示暗黑模式切换按钮

### Requirement: UI 文本中文化

所有面向用户的 UI 文本 SHALL 使用中文。

#### Scenario: 侧边栏文本中文
- **WHEN** 检查侧边栏导航项文本
- **THEN** 显示"首页"、"个人资料"、"我的应用"、"API 密钥"、"我的群组"、"我的收藏"、"浏览历史"等中文文本

#### Scenario: 首页文本中文
- **WHEN** 用户访问首页
- **THEN** 显示"欢迎回来"、"工作区一览"、"我的应用"、"收藏"、"浏览历史"、"查看全部"等中文文本

#### Scenario: 导航栏文本中文
- **WHEN** 检查 serve 页面 navbar
- **THEN** 显示"收藏"、"问题"、"登录"、"退出"等中文文本
