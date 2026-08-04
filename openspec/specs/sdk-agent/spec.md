## Purpose

TBD — `@localapp/sdk-agent` 独立 npm 包，提供 `useAgent` Hook 和 `AgentChat` 聊天 UI 组件，通过 `/api/llm/proxy` 代理 LLM 请求并自动注册系统工具。
## Requirements
### Requirement: 独立 npm 包

`@localapp/sdk-agent` SHALL 作为一个独立的 npm 包存在于 monorepo 的 `packages/sdk-agent/` 目录中。包的 `package.json` SHALL 声明 `"name": "@localapp/sdk-agent"`，`"@localapp/sdk"` 和 `"@localapp/sdk-react"` 和 `"@assistant-ui/react"` 为 peerDependency。

#### Scenario: 包可被 pnpm workspace 引用
- **WHEN** monorepo 中的其他包声明 `"@localapp/sdk-agent": "workspace:*"` 依赖
- **THEN** pnpm 解析到 `packages/sdk-agent/` 的本地包

### Requirement: useAgent Hook

`useAgent(options?)` Hook SHALL 返回 `{ send, messages, isRunning, error, chatOpen }`。Hook SHALL 通过 `/api/llm/chat` 代理 LLM 请求,并自动注册 `getCurrentUser` 一个只读系统工具。**`queryData` 和 `listSchemas` 系统工具 SHALL NOT 注册**(禁止 AI 直接访问数据库)。

当 `options.shellIntegration` 为 `true` 时,SHALL 额外返回 `chatOpen` 状态并声明自定义模式。

应用通过 `useRegisterTools({ tools })` 注册的工具 SHALL 对 LLM 可用,工具实现完全由应用开发者负责(可读、可写、可删,无平台限制)。

#### Scenario: 注册系统工具
- **WHEN** 调用 `useAgent()`
- **THEN** 仅自动注册 `getCurrentUser` 一个只读工具
- **AND** 不注册 `queryData`、`listSchemas`(已废除)

#### Scenario: getCurrentUser 行为
- **WHEN** LLM 调用 `getCurrentUser` 工具
- **THEN** SDK 发起 `GET /api/me` 请求(dev 模式走 mini-server,prod 模式走生产 server)
- **AND** 返回 `{ id, name }`(或 null 表示未登录)
- **AND** 不视为数据库操作(身份查询)

#### Scenario: 注册自定义工具
- **WHEN** 调用 `useAgent({ tools: { fillForm: { description, parameters, execute } } })`
- **THEN** `fillForm` 工具对 LLM 可用
- **THEN** `execute` 函数接收 `args` 参数,返回描述执行结果的字符串

#### Scenario: 发送消息
- **WHEN** 调用 `send("帮我查询所有待办的 Bug")`
- **THEN** LLM 调用应用注册的工具(如 `getTasks`)获取数据
- **THEN** `messages` 数组包含用户消息和助手回复
- **AND** LLM 不能直接查 db(无 queryData 工具),必须通过应用工具

#### Scenario: shellIntegration 模式
- **WHEN** 调用 `useAgent({ shellIntegration: true })`
- **THEN** 向 Shell 声明自定义 AI 模式
- **THEN** 返回 `chatOpen` 状态,由 Shell 的 AI 按钮控制

#### Scenario: 应用未注册工具时 LLM 受限
- **WHEN** 应用不调用 `useRegisterTools` 注册任何工具
- **AND** LLM 被询问 "查询所有任务"
- **THEN** LLM 只能用 `getCurrentUser` 获取身份
- **AND** LLM 不能查询任务数据(无 queryData 工具)
- **AND** LLM 回复 "请应用开发者注册查询工具"

### Requirement: useRegisterTools Hook
`useRegisterTools(options?)` Hook SHALL 允许应用向 Platform Shell 注册工具定义和系统提示词。Hook SHALL 在 native 模式下使用同页 shell registry；在兼容测试环境中可以使用标准消息协议。Hook SHALL 在本地维护工具名到 execute 函数的映射，并在 Shell 调用工具时执行对应函数，将结果返回给 Shell。

#### Scenario: 注册工具到 Shell
- **WHEN** 应用调用 `useRegisterTools({ tools: { fillForm: { description, parameters, execute } }, systemHint: "请假应用" })`
- **THEN** Shell SHALL 收到 `{ name: "fillForm", description, parameters }` 和 systemHint
- **AND** 本地 SHALL 保存 `{ fillForm: execute }` 映射

#### Scenario: 执行工具调用
- **WHEN** Shell 调用 `{ callId: "c1", toolName: "fillForm", args: { field: "name" } }`
- **THEN** SDK SHALL 查找本地 `fillForm` 的 execute 函数
- **AND** SDK SHALL 执行 `execute({ field: "name" })`
- **AND** SDK SHALL 将 result 返回给 Shell

#### Scenario: 未在 Shell 中运行
- **WHEN** 应用未被 LocalApp shell 承载
- **THEN** Hook SHALL 静默跳过 shell 注册

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

### Requirement: AgentChat 组件

`AgentChat` SHALL 是一个基于 `@assistant-ui/react` 的聊天 UI 组件。组件 SHALL 接收一个 `agent` prop（`useAgent` 的返回值）并渲染对话界面。

#### Scenario: 渲染聊天界面
- **WHEN** 使用 `<AgentChat agent={agent} />`
- **THEN** 渲染消息列表和输入框
- **THEN** 用户可输入消息并发送

### Requirement: 后续平台工具扩展机制

平台后续可通过 SDK 更新发布更多系统工具(如 `navigateToPage`、`sendNotification`、`openExternalLink` 等 API 类工具),这些工具 SHALL NOT 直接访问数据库,只通过 server 提供的对应 API 操作。

新增系统工具 SHALL:
1. 在 server-core 实现对应 API 端点
2. SDK 内置工具定义(描述、参数、execute 函数)
3. execute 函数内部调用对应 API
4. 文档更新工具列表

#### Scenario: 平台新增 navigateToPage 工具
- **WHEN** 平台后续版本新增 `navigateToPage` 工具
- **THEN** SDK 升级后,LLM 可调用该工具
- **AND** 工具 execute 函数内部调用 `/api/platform/navigate` API
- **AND** 工具不直接访问 db

### Requirement: platform-runtime 支持 native host
`@localapp/sdk-agent/platform-runtime` SHALL 在 native 页面中通过同页 host 请求平台能力。应用侧 API SHALL 与 dev 和 production 保持一致。

#### Scenario: 同页能力请求
- **WHEN** `window.parent === window` 且应用调用 `platform.copyText("x")`
- **THEN** SDK SHALL 向同页 platform host 发出能力请求
- **AND** SDK SHALL 等待标准响应并 resolve

#### Scenario: 不直接使用浏览器原生 confirm
- **WHEN** 应用调用 `platform.confirm(...)`
- **THEN** SDK SHALL NOT 直接调用 `window.confirm`
- **AND** SDK SHALL 通过 platform host 获取确认结果

### Requirement: 工具注册支持 native registry
`useRegisterTools` SHALL 在 native 模式下向同页 shell registry 注册工具 schema、systemHint 和 execute 映射，不再要求 iframe `window.parent.postMessage`。

#### Scenario: native 注册工具
- **WHEN** native 应用调用 `useRegisterTools({ tools, systemHint })`
- **THEN** SDK SHALL 将工具注册到同页 shell registry
- **AND** 平台 AI SHALL 能调用这些工具并收到结果

