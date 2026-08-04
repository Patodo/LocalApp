## MODIFIED Requirements

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

### Requirement: profile 页面 tab 结构

profile 页面 tab 栏 SHALL 包含以下选项卡：个人资料、我的应用、API Key、分组。Tab 栏使用浅色主题样式，激活 tab 使用 `var(--primary)` 下划线标识。

#### Scenario: Tab 栏浅色主题
- **WHEN** 用户访问 `/profile`
- **THEN** tab 栏底色为 `var(--surface)`，激活 tab 底部边框为 `var(--primary)`，非激活 tab 文字为 `var(--text-muted)`

### Requirement: Profile 页面 tab 切换行为

Profile SPA 的 TabLayout 顶部栏 SHALL 显示用户头像（或首字母圆形占位）和用户名，使用浅色主题。顶部栏 SHALL 包含退出登录链接。

#### Scenario: 顶部栏浅色主题
- **WHEN** 用户访问 `/profile`
- **THEN** 顶部栏底色为 `var(--surface)`，文字为 `var(--text)`，头像占位符背景为 `var(--primary)`
