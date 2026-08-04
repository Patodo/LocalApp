## MODIFIED Requirements

### Requirement: 用户页面导航栏

系统在用户页面的平台 Shell 导航栏中 SHALL 展示当前用户的头像（如有）和名称，并提供跳转到 `/profile` 的链接。

#### Scenario: 已登录用户有头像
- **WHEN** 已登录用户访问 `/{userId}/{pageName}`，且用户有头像
- **THEN** 导航栏右侧显示头像图片和用户名，点击可跳转 `/profile`

#### Scenario: 已登录用户无头像
- **WHEN** 已登录用户访问 `/{userId}/{pageName}`，且用户没有头像
- **THEN** 导航栏右侧显示用户名首字母占位头像和用户名，点击可跳转 `/profile`

#### Scenario: 未登录用户
- **WHEN** 未登录用户访问 `/{userId}/{pageName}`
- **THEN** 导航栏右侧显示 Login 和 Register 链接（与当前行为一致）
