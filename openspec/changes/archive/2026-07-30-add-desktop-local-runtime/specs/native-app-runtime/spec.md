## ADDED Requirements

### Requirement: 本地应用使用正式 native Shell

Local Runtime SHALL 使用与生产应用一致的同页 native app host 契约承载应用。Local Platform Shell SHALL 拥有导航、确认弹窗和平台 overlay，应用 SHALL 只拥有 app container；Desktop 和用户 SHALL NOT 使用 raw asset route 作为正式入口。

#### Scenario: 本地正式入口包含 Shell
- **WHEN** 用户从 Desktop 打开已安装应用
- **THEN** 浏览器 SHALL 渲染 Local Platform Shell 和 native app mount container
- **AND** 页面 SHALL NOT 使用 iframe
- **AND** 应用 SDK SHALL 无需判断 local 或 hosted 运行模式
