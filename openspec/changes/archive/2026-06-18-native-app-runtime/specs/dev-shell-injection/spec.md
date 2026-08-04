## ADDED Requirements

### Requirement: DevShell 派生自生产 nav-shell
DevShell SHALL 使用生产 nav-shell 的结构和平台能力契约，只在最左侧注入 `DEV` 按钮。`DEV` 下拉 SHALL 包含开发工具和工具面板入口。

#### Scenario: DEV 是唯一额外入口
- **WHEN** dev 模式渲染顶部 shell
- **THEN** 最左侧 SHALL 显示 `DEV` 按钮
- **AND** 其余应用名称、AI、用户入口和平台能力 SHALL 与生产 nav-shell 对齐

#### Scenario: 打开 DEV 下拉
- **WHEN** 用户点击 `DEV`
- **THEN** 下拉 SHALL 显示工具和开发工具入口

### Requirement: DevShell 提供 native platform host
DevShell SHALL 在 dev 模式中作为同页 platform host 响应 SDK 平台能力请求，并使用 mini-server 的 dev-only API 提供身份、时间、数据和诊断工具。

#### Scenario: dev confirm 使用平台弹窗
- **WHEN** dev 应用调用 `platform.confirm(...)`
- **THEN** DevShell SHALL 显示同页确认弹窗
- **AND** SHALL NOT 调用浏览器原生 `window.confirm`

## REMOVED Requirements

### Requirement: DevShell 不复制生产 nav-shell 用户入口
**Reason**: 新决策要求 dev-shell 对齐生产 nav-shell，避免开发者误判发布后 UI。
**Migration**: DevShell SHALL 派生生产 nav-shell，并通过 `DEV` 入口区分开发能力。
