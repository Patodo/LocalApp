## Purpose

基于 pi-agent-core 的浏览器端 Agent 运行时。封装 Agent 循环、消息管理、schema 上下文自动注入，通过 `useAgent()` Hook 暴露给应用创建者。

## ADDED Requirements

### Requirement: useAgent Hook

SDK SHALL 提供 `useAgent(options?)` React Hook，返回 Agent 实例和对话状态。options 包含 `tools`（用户自定义工具）、`systemHint`（额外系统提示）。

#### Scenario: 基本初始化
- **WHEN** 组件调用 `useAgent()`
- **THEN** 返回 `{ send, messages, isRunning, error }`，messages 初始为空数组，isRunning 为 false

#### Scenario: 带自定义工具初始化
- **WHEN** 组件调用 `useAgent({ tools: { createTodo: { ... } } })`
- **THEN** Agent 注册系统级只读工具 + 用户自定义工具

#### Scenario: 带系统提示初始化
- **WHEN** 组件调用 `useAgent({ systemHint: "这是一个请假管理应用" })`
- **THEN** 系统提示中包含用户提供的额外描述

### Requirement: Agent 消息循环

Agent SHALL 在用户发送消息后启动 Agent 循环：发送消息 → 接收 LLM 响应 → 解析工具调用 → 执行工具 → 将结果反馈给 LLM → 直到 LLM 不再调用工具。

#### Scenario: 纯文本回复
- **WHEN** 用户发送 "你好" 且 LLM 不需要调用工具
- **THEN** messages 更新为 [userMessage, assistantMessage]，isRunning 变为 false

#### Scenario: 触发工具调用
- **WHEN** 用户发送 "帮我查看所有待办事项" 且 LLM 调用 queryData 工具
- **THEN** Agent 执行 queryData 工具，将结果反馈给 LLM，messages 更新包含工具调用记录和最终回复

#### Scenario: 多轮工具调用
- **WHEN** LLM 需要连续调用多个工具
- **THEN** Agent 依次执行每个工具调用，将结果逐一反馈，直到 LLM 不再调用工具

#### Scenario: Agent 正在运行时发送消息
- **WHEN** isRunning 为 true 时用户调用 send
- **THEN** 忽略该请求，不发送新消息

### Requirement: Schema 上下文自动注入

useAgent 初始化时 SHALL 自动获取当前页面的所有数据 schema，格式化为自然语言描述，注入 Agent 的系统提示中。

#### Scenario: 页面有 schema
- **WHEN** 页面定义了 `todos` schema（含 title: string, done: boolean）
- **THEN** Agent 系统提示包含 schema 描述，LLM 能理解数据结构

#### Scenario: 页面无 schema
- **WHEN** 页面未定义任何 schema
- **THEN** 系统提示中不包含 schema 信息，Agent 仍可正常工作

### Requirement: LLM 调用适配

Agent SHALL 通过 pi-ai 的 callLLM 接口与 LLM 通信，底层调用 `POST /api/llm/chat`，使用 SSE 解析流式响应。

#### Scenario: 正常调用
- **WHEN** Agent 调用 callLLM
- **THEN** 请求发送至 `/api/llm/chat`，携带 cookie 自动鉴权，响应通过 SSE 解析

#### Scenario: LLM 调用失败
- **WHEN** `/api/llm/chat` 返回错误
- **THEN** Agent 设置 error 状态，isRunning 变为 false
