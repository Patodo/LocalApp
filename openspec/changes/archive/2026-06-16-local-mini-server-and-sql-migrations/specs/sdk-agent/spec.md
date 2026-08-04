## MODIFIED Requirements

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

## ADDED Requirements

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
