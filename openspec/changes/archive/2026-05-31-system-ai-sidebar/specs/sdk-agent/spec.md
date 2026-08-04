## ADDED Requirements

### Requirement: useRegisterTools Hook

`useRegisterTools(options?)` Hook SHALL 允许应用向 Platform Shell 注册工具定义和系统提示词。Hook SHALL 在挂载时通过 `window.parent.postMessage` 发送工具 schema（不含 execute 函数）和 systemHint。Hook SHALL 在本地维护工具名到 execute 函数的映射，监听来自 Shell 的 `localapp:tool_call` 消息并执行对应的函数，将结果通过 postMessage 返回。

#### Scenario: 注册工具到 Shell
- **WHEN** 应用调用 `useRegisterTools({ tools: { fillForm: { description, parameters, execute } }, systemHint: "请假应用" })`
- **THEN** 向 parent window 发送 `{ type: "localapp:register_tools", tools: [{ name: "fillForm", description, parameters }], systemHint: "请假应用" }`
- **THEN** 本地保存 `{ fillForm: execute }` 映射

#### Scenario: 执行工具调用
- **WHEN** Shell 发送 `{ type: "localapp:tool_call", callId: "c1", toolName: "fillForm", args: { field: "name" } }`
- **THEN** 查找本地 `fillForm` 的 execute 函数
- **THEN** 执行 `execute({ field: "name" })`
- **THEN** 向 parent 发送 `{ type: "localapp:tool_result", callId: "c1", result }`

#### Scenario: 工具执行失败
- **WHEN** execute 函数抛出异常
- **THEN** 向 parent 发送 `{ type: "localapp:tool_result", callId: "c1", result: error.message, isError: true }`

#### Scenario: 未在 Shell 中运行
- **WHEN** `window.parent === window`（非 iframe 环境）
- **THEN** Hook 不发送 postMessage，静默跳过

#### Scenario: 并发工具调用
- **WHEN** Shell 同时发送多个 tool_call 消息（callId 分别为 "c1", "c2"）
- **THEN** 两个工具独立并发执行
- **THEN** 分别返回各自的 tool_result 消息

### Requirement: useAgent 增加 shellIntegration 选项

`useAgent` Hook SHALL 支持 `shellIntegration?: boolean` 选项。当 `shellIntegration` 为 `true` 时，Hook SHALL 在初始化时向 Shell 发送 `{ type: "localapp:ai_custom_mode" }` 消息声明自定义模式。Hook SHALL 监听来自 Shell 的 `{ type: "localapp:toggle_chat" }` 消息，并通过返回值暴露 `chatOpen` 状态。

#### Scenario: 声明自定义模式
- **WHEN** 应用调用 `useAgent({ tools: {...}, shellIntegration: true })`
- **THEN** 向 parent window 发送 `{ type: "localapp:ai_custom_mode" }`

#### Scenario: 接收 Shell 的 toggle_chat 消息
- **WHEN** Shell 发送 `{ type: "localapp:toggle_chat" }`
- **THEN** `chatOpen` 状态切换（true ↔ false）

#### Scenario: shellIntegration 返回值
- **WHEN** 使用 `shellIntegration: true` 调用 `useAgent`
- **THEN** 返回值中包含 `chatOpen: boolean` 字段

#### Scenario: shellIntegration 默认值
- **WHEN** 调用 `useAgent()` 不传 `shellIntegration`
- **THEN** `shellIntegration` 默认为 `false`
- **THEN** 不发送自定义模式声明，不监听 toggle_chat 消息

## MODIFIED Requirements

### Requirement: useAgent Hook

`useAgent(options?)` Hook SHALL 返回 `{ send, messages, isRunning, error, chatOpen }`。Hook SHALL 通过 `/api/llm/chat` 代理 LLM 请求，并自动注册三个只读系统工具。当 `options.shellIntegration` 为 `true` 时，SHALL 额外返回 `chatOpen` 状态并声明自定义模式。

#### Scenario: 注册系统工具
- **WHEN** 调用 `useAgent()`
- **THEN** 自动注册 `getCurrentUser`、`queryData`、`listSchemas` 三个只读工具

#### Scenario: 注册自定义工具
- **WHEN** 调用 `useAgent({ tools: { fillForm: { description, parameters, execute } } })`
- **THEN** `fillForm` 工具对 LLM 可用
- **THEN** `execute` 函数接收 `args` 参数，返回描述执行结果的字符串

#### Scenario: 发送消息
- **WHEN** 调用 `send("帮我查询所有待办的 Bug")`
- **THEN** LLM 可调用系统工具获取数据
- **THEN** `messages` 数组包含用户消息和助手回复

#### Scenario: shellIntegration 模式
- **WHEN** 调用 `useAgent({ shellIntegration: true })`
- **THEN** 向 Shell 声明自定义 AI 模式
- **THEN** 返回 `chatOpen` 状态，由 Shell 的 AI 按钮控制
