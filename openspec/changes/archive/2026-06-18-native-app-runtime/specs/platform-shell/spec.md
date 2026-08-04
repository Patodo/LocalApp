## ADDED Requirements

### Requirement: PlatformShell 作为 native 应用宿主
`PlatformShell` SHALL 渲染平台 nav-shell、平台能力 host 和 native app mount container。应用 SHALL 在该 container 内运行，平台 shell SHALL NOT 使用 iframe 作为默认承载方式。

#### Scenario: 渲染 native shell
- **WHEN** 用户访问生产应用页面
- **THEN** `PlatformShell` SHALL 显示应用名称、Issue 入口、AI 入口和用户入口
- **AND** `PlatformShell` SHALL 显示 native app mount container
- **AND** `PlatformShell` SHALL NOT 渲染应用 iframe

### Requirement: PlatformShell 提供同页能力响应
`PlatformShell` SHALL 在同页处理 SDK 平台能力请求，包括 `getCurrentUser`、`getServerTime`、`copyText`、`downloadFile`、`confirm`、`openRoute` 和 `ai.*`。

#### Scenario: 同页确认弹窗
- **WHEN** native 应用请求 `confirm`
- **THEN** `PlatformShell` SHALL 展示平台确认弹窗
- **AND** 用户选择结果 SHALL 返回给应用 SDK

#### Scenario: 同页 AI 切换
- **WHEN** native 应用请求 `ai.open`
- **THEN** `PlatformShell` SHALL 打开平台 AI 侧栏

## REMOVED Requirements

### Requirement: PlatformShell 组件
**Reason**: PlatformShell 不再是 iframe 外壳；生产应用改为 native mount。
**Migration**: 使用 `PlatformShell` 的 native app mount container 和同页 platform host。

### Requirement: Mode B 自定义模式转发
**Reason**: Mode B 不再需要向 iframe 转发 `toggle_chat` 消息。
**Migration**: SDK 工具注册和 AI 控制改为同页 host/registry 机制。
