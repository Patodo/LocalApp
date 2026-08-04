## ADDED Requirements

### Requirement: 工具调用默认折叠展示

`ToolCallDisplay` 组件 SHALL 默认以折叠形式渲染工具调用，仅显示一行摘要（图标 + 工具名 + 结果摘要），点击可展开查看完整 JSON 入参和返回值。

#### Scenario: 折叠态显示一行摘要
- **WHEN** 工具调用有结果（`result` 非 undefined）
- **THEN** 默认渲染一行摘要：`✓` 图标 + 工具名 + 结果摘要（首行，不超过 60 字符），末尾有展开按钮

#### Scenario: 点击展开显示完整 JSON
- **WHEN** 用户点击折叠态的摘要行或展开按钮
- **THEN** 展开显示完整的 JSON 入参（`args`）和返回值（`result`），格式与当前展开态一致，展开按钮变为折叠按钮

#### Scenario: 点击折叠恢复摘要
- **WHEN** 用户点击已展开状态的折叠按钮
- **THEN** 恢复为一行摘要显示

#### Scenario: 工具执行中自动展开
- **WHEN** 工具调用尚无结果（`result` 为 undefined，执行中）
- **THEN** 自动展开显示入参 JSON，图标为 `⏳`，无折叠按钮

#### Scenario: 无入参工具调用
- **WHEN** 工具调用无入参（`args` 为空或仅含 `{}`)
- **THEN** 折叠态只显示 `✓ toolName 结果摘要`，展开后不显示 args 部分

#### Scenario: 对外接口不变
- **WHEN** 应用代码使用 `<AgentChat agent={agent} />`
- **THEN** 行为与变更前完全一致，无需修改应用代码或工具定义
