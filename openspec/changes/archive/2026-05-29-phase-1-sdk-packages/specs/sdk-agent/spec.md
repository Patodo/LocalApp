## ADDED Requirements

### Requirement: 独立 npm 包

`@localapp/sdk-agent` SHALL 作为一个独立的 npm 包存在于 monorepo 的 `packages/sdk-agent/` 目录中。包的 `package.json` SHALL 声明 `"name": "@localapp/sdk-agent"`，`"@localapp/sdk"` 和 `"@localapp/sdk-react"` 和 `"@assistant-ui/react"` 为 peerDependency。

#### Scenario: 包可被 pnpm workspace 引用
- **WHEN** monorepo 中的其他包声明 `"@localapp/sdk-agent": "workspace:*"` 依赖
- **THEN** pnpm 解析到 `packages/sdk-agent/` 的本地包

### Requirement: useAgent Hook

`useAgent(options?)` Hook SHALL 返回 `{ send, messages, isRunning, error }`。Hook SHALL 通过 `/api/llm/proxy` 代理 LLM 请求，并自动注册三个只读系统工具。

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

### Requirement: AgentChat 组件

`AgentChat` SHALL 是一个基于 `@assistant-ui/react` 的聊天 UI 组件。组件 SHALL 接收一个 `agent` prop（`useAgent` 的返回值）并渲染对话界面。

#### Scenario: 渲染聊天界面
- **WHEN** 使用 `<AgentChat agent={agent} />`
- **THEN** 渲染消息列表和输入框
- **THEN** 用户可输入消息并发送
