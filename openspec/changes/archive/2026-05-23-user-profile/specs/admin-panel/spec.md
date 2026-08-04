## MODIFIED Requirements

### Requirement: Admin 侧边栏用户区域

Admin Panel 侧边栏底部 SHALL 显示当前管理员用户的头像和名称，并提供"个人资料"链接跳转到 `/profile`。

#### Scenario: 管理员有头像
- **WHEN** 管理员用户有头像
- **THEN** 侧边栏底部显示头像图片、用户名、"个人资料"链接

#### Scenario: 管理员无头像
- **WHEN** 管理员用户没有头像
- **THEN** 侧边栏底部显示首字母占位头像、用户名、"个人资料"链接

#### Scenario: 跳转到 Profile
- **WHEN** 管理员点击"个人资料"链接
- **THEN** 浏览器跳转到 `/profile`
