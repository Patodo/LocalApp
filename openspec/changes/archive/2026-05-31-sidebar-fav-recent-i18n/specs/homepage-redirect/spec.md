## ADDED Requirements

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
- **THEN** 显示"收藏"、"问题"、"登录"、"注册"、"退出"等中文文本
