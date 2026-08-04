## Purpose

开箱即用的 `<AgentChat />` 对话组件。提供消息列表、输入框、流式消息展示、工具调用状态显示。

## ADDED Requirements

### Requirement: AgentChat 组件

SDK SHALL 提供 `<AgentChat />` React 组件，接收 `agent` 属性（由 useAgent 返回的 Agent 实例），渲染完整的对话界面。

#### Scenario: 渲染空对话界面
- **WHEN** 使用 `<AgentChat agent={agent} />` 且 messages 为空
- **THEN** 显示输入框和欢迎提示，无消息记录

#### Scenario: 发送消息
- **WHEN** 用户在输入框输入文本并点击发送或按 Enter
- **THEN** 调用 agent.send(text)，输入框清空

#### Scenario: Agent 运行中禁用输入
- **WHEN** agent.isRunning 为 true
- **THEN** 输入框和发送按钮显示为禁用状态

### Requirement: 消息展示

AgentChat SHALL 以气泡形式展示对话消息，区分用户消息和 Agent 消息。

#### Scenario: 用户消息展示
- **WHEN** messages 中包含 role 为 "user" 的消息
- **THEN** 以右对齐气泡展示用户消息内容

#### Scenario: Agent 文本消息展示
- **WHEN** messages 中包含 role 为 "assistant" 的消息且内容为纯文本
- **THEN** 以左对齐气泡展示 Agent 回复

#### Scenario: 流式消息实时展示
- **WHEN** Agent 正在接收 LLM 流式响应
- **THEN** 实时展示已接收的文本片段，带光标闪烁效果

### Requirement: 工具调用状态展示

AgentChat SHALL 展示工具调用的执行状态和结果。

#### Scenario: 工具正在执行
- **WHEN** Agent 调用工具且工具尚未返回结果
- **THEN** 显示工具名称和加载状态指示器

#### Scenario: 工具执行完成
- **WHEN** 工具调用完成
- **THEN** 显示工具名称和执行结果摘要（折叠展示，点击展开详情）

### Requirement: 错误展示

AgentChat SHALL 展示 Agent 运行过程中的错误信息。

#### Scenario: Agent 错误展示
- **WHEN** agent.error 不为 null
- **THEN** 在对话区域顶部展示错误提示横幅

#### Scenario: 清除错误后继续对话
- **WHEN** 错误已展示且用户发送新消息
- **THEN** 错误提示消失，Agent 尝试处理新消息
