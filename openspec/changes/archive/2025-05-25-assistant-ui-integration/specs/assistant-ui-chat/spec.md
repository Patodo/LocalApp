## ADDED Requirements

### Requirement: AgentChat 使用 assistant-ui Thread 组件渲染

`AgentChat` 组件 SHALL 基于 `@assistant-ui/react` 的 `useExternalStoreRuntime` 和 `<Thread />` 实现，替换手写的 inline-style 聊天 UI。

#### Scenario: AgentChat 正确导入和使用 assistant-ui
- **WHEN** 应用代码使用 `<AgentChat agent={agent} />`
- **THEN** 组件内部使用 `useExternalStoreRuntime` 创建 runtime，并渲染 `<Thread />` 组件

#### Scenario: 对外接口不变
- **WHEN** 应用代码从 `./lib/localapp` 导入 `useAgent` 和 `AgentChat`
- **THEN** 导出和使用方式与变更前完全一致，无需修改应用代码

### Requirement: 消息格式转换适配器

SHALL 提供 `convertMessages()` 函数，将 pi-agent-core 的 `AgentMessage[]` 转换为 assistant-ui 的 `ThreadMessageLike[]`。转换规则：

1. `UserMessage` → `{ role: "user", content: text }`
2. `AssistantMessage` 的 `TextContent` → `{ type: "text", text }`
3. `AssistantMessage` 的 `ToolCall` → `{ type: "tool-call", toolCallId, toolName, args, argsText }`
4. `ToolResultMessage` SHALL 合并回对应 `AssistantMessage` 中匹配 `toolCallId` 的 tool-call part 的 `result` 字段
5. `ToolResultMessage` 自身不产生独立消息

#### Scenario: 用户消息转换
- **WHEN** `AgentMessage` 为 `{ role: "user", content: "你好" }`
- **THEN** 转换结果为 `{ role: "user", content: "你好" }`

#### Scenario: 助手消息含文本和工具调用
- **WHEN** `AgentMessage` 为 `{ role: "assistant", content: [{ type: "text", text: "好的" }, { type: "toolCall", id: "call_1", name: "fillForm", arguments: { field: "name", value: "张三" } }] }`
- **THEN** 转换结果为 `{ role: "assistant", content: [{ type: "text", text: "好的" }, { type: "tool-call", toolCallId: "call_1", toolName: "fillForm", args: { field: "name", value: "张三" }, argsText: '{"field":"name","value":"张三"}' }] }`

#### Scenario: Tool Result 合并回 Assistant Message
- **WHEN** 消息序列为 `[AssistantMsg(toolCall id:"c1"), ToolResultMsg(toolCallId:"c1", content: [{ type: "text", text: '"已填写"' }])]`
- **THEN** 转换结果只有一条 assistant 消息，其中 tool-call part 的 `result` 为 `"已填写"`

#### Scenario: 多条 tool result 合并到同一条 assistant 消息
- **WHEN** 一条 assistant 消息包含两个 toolCall（id: "c1", "c2"），后有两条 tool result（toolCallId: "c1", "c2"）
- **THEN** 转换结果中该 assistant 消息的两个 tool-call part 各自包含对应的 result

### Requirement: 发送消息桥接

`AgentChat` SHALL 将 assistant-ui 的 `onNew` 回调桥接到 `useAgent` 的 `send()` 函数。

#### Scenario: 用户在 assistant-ui 输入框发送消息
- **WHEN** 用户在 Thread 组件的输入框中输入文字并按发送
- **THEN** 文字内容通过 `agent.send(text)` 传递给 pi-agent-core Agent

### Requirement: 流式状态传递

`AgentChat` SHALL 将 `useAgent` 的 `isRunning` 状态传递给 `useExternalStoreRuntime`，确保 assistant-ui 正确显示加载状态和流式动画。

#### Scenario: Agent 处理中显示加载状态
- **WHEN** `agent.isRunning` 为 `true`
- **THEN** assistant-ui Thread 组件显示加载指示器（如输入框禁用、停止按钮）

#### Scenario: Agent 完成后恢复输入
- **WHEN** `agent.isRunning` 从 `true` 变为 `false`
- **THEN** 输入框恢复可用状态

### Requirement: 错误状态展示

`AgentChat` SHALL 展示 `useAgent` 返回的 `error` 状态。

#### Scenario: Agent 报错时显示错误信息
- **WHEN** `agent.error` 为非 null 字符串
- **THEN** UI 中展示错误信息给用户
