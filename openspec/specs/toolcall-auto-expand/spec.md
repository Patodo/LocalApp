## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the toolcall-auto-expand capability in LocalApp.
## Requirements

### Requirement: Agent 运行期间工具调用保持展开

`ToolCallDisplay` 组件 SHALL 接收 `isRunning` 属性。当 Agent 正在运行（`isRunning === true`）时，即使工具调用已收到结果，也不自动折叠。Agent 完成运行后（`isRunning` 从 `true` 变为 `false`），所有已完成的工具调用统一折叠为一行摘要。

#### Scenario: Agent 运行中工具结果到达后保持展开
- **WHEN** Agent 正在运行（`isRunning === true`）且一条工具调用收到结果（`result` 从 `undefined` 变为有值）
- **THEN** 该工具调用保持展开状态，不自动折叠

#### Scenario: Agent 运行时所有工具可见
- **WHEN** Agent 正在运行且已完成多个工具调用
- **THEN** 所有工具调用保持展开，用户可看到完整的工具调用历史和结果

#### Scenario: Agent 完成后所有工具折叠
- **WHEN** Agent 完成运行（`isRunning` 从 `true` 变为 `false`）
- **THEN** 所有已完成的工具调用折叠为一行摘要

#### Scenario: 用户手动展开不被覆盖
- **WHEN** 用户手动点击展开某个已折叠的工具调用
- **THEN** 该工具调用保持展开，不受自动折叠逻辑影响
