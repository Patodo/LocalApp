## MODIFIED Requirements

### Requirement: 登录页面视觉风格

登录页面（`buildLoginPage()`）SHALL 使用浅色主题，底色 `#f8f9fa`，登录卡片白底圆角 + 微妙阴影，主按钮使用 `#2563eb` 背景。页面 SHALL 引用 shared.css 中定义的 design tokens。

#### Scenario: 登录页面浅色主题
- **WHEN** 用户访问 `/login`
- **THEN** 页面底色为 `#f8f9fa`，登录卡片背景为 `#ffffff`、圆角 `12px`、阴影，按钮背景为 `#2563eb`、hover 为 `#1d4ed8`

#### Scenario: 登录页面表单样式
- **WHEN** 用户查看登录表单
- **THEN** 输入框使用 `8px` 圆角、focus 时有蓝色外发光效果，placeholder 文字为灰色

### Requirement: 注册页面视觉风格

注册页面（`buildRegisterPage()`）SHALL 使用与登录页面一致的浅色主题和组件样式。

#### Scenario: 注册页面风格一致
- **WHEN** 用户访问 `/register`
- **THEN** 页面视觉风格与登录页面完全一致（相同底色、卡片、按钮、输入框样式）

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
