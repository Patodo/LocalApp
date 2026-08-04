## ADDED Requirements

### Requirement: Agent 运行期间工具调用保持展开

`ToolCallDisplay` 组件 SHALL 接收 `isRunning` 属性。`AgentChat` 通过 `AssistantMessage` 将 `isRunning` 传递给每个 `ToolCallDisplay`。当 `isRunning === true` 时，组件 SHALL 在接收到结果后不触发自动折叠。

#### Scenario: isRunning 传递链路
- **WHEN** `AgentChat` 渲染 `AssistantMessage`
- **THEN** `isRunning` 通过 props 传递，`AssistantMessage` 再将其传递给 `ToolCallDisplay`

#### Scenario: Agent 运行中结果到达后保持展开
- **WHEN** `isRunning === true` 且 `result` 从 `undefined` 变为有值
- **THEN** `useEffect` 不调用 `setExpanded(false)`，工具保持展开

#### Scenario: Agent 完成后自动折叠
- **WHEN** `isRunning` 从 `true` 变为 `false`
- **THEN** `useEffect` 检测到 `hasResult && !isRunning` 为 `true`，调用 `setExpanded(false)` 折叠工具
