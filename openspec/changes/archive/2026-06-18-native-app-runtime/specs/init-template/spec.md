## ADDED Requirements

### Requirement: init-repo 示例遵守 native 边界
init-repo 示例应用 SHALL 遵守 native app container 边界，不实现自己的平台导航栏，不仿冒平台登录入口，不直接操作平台 shell DOM。

#### Scenario: 示例应用不包含平台导航
- **WHEN** 检查 init-repo 示例源码
- **THEN** 示例应用 SHALL NOT 渲染替代平台 nav-shell 的顶部导航
- **AND** 示例应用 SHALL 依赖平台 shell 提供用户入口和 AI 入口

### Requirement: init-repo skills 使用 native 指南
init-repo skills SHALL 指导 Agent 生成 native 友好的应用：平台能力走 SDK、样式限制在应用容器内、数据访问走 backend contract 和 Named SQL。

#### Scenario: skills 不提 iframe 限制
- **WHEN** 检查 init-repo skills
- **THEN** skills SHALL NOT 建议使用 `window.parent`、iframe postMessage 或 sandbox workaround
- **AND** skills SHALL 建议使用 SDK 平台能力
