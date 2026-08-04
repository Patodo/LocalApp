## MODIFIED Requirements

### Requirement: SDK 源码预装

模板的 `src/lib/localapp/` 目录 SHALL 包含完整的 SDK 源码（`client.ts`、`react.ts`、`index.ts`、`types.ts`），通过 `pnpm sync:sdk` 从 `packages/client/src/` 同步。`agent/context.ts` SHALL 导出 `buildSystemPrompt` 函数，接受三个参数：`systemContext`（系统层上下文）、`schemaContext`（数据层上下文）、`hint`（应用层提示）。`client.ts` SHALL 导出 `detectBasePath` 函数。

#### Scenario: SDK 源码可用
- **WHEN** 在模板的 `App.tsx` 中 import `{ useList, useMe }` from `'./lib/localapp'`
- **THEN** TypeScript 编译通过，Vite 构建成功

#### Scenario: buildSystemPrompt 三参数接口
- **WHEN** 从 `./lib/localapp/agent/context` 导入 `buildSystemPrompt`
- **THEN** 函数签名为 `(systemContext: string, schemaContext: string, hint?: string) => string`

#### Scenario: detectBasePath 导出
- **WHEN** 从 `./lib/localapp` 导入 `detectBasePath`
- **THEN** 它是一个无参数函数，返回当前页面的 API basePath 字符串

### Requirement: LLM Adapter 传递系统提示词和工具定义

`agent/llm-adapter.ts` 的 `createStreamFn` SHALL 将 `context.systemPrompt` 作为第一条 system message 传递给 LLM API，并将 `context.tools` 转为 OpenAI function calling 格式传递。

#### Scenario: 系统提示词传递给 LLM
- **WHEN** Agent 的 `context.systemPrompt` 为非空字符串
- **THEN** 发送给 `/api/llm/chat` 的请求体 `messages` 数组中第一条为 `{ role: "system", content: systemPrompt }`

#### Scenario: 工具定义传递给 LLM
- **WHEN** Agent 的 `context.tools` 包含工具定义
- **THEN** 发送给 `/api/llm/chat` 的请求体包含 `tools` 字段，格式为 OpenAI function calling 的 `tools` 数组

#### Scenario: 无工具定义时不传 tools 字段
- **WHEN** Agent 的 `context.tools` 为 undefined 或空数组
- **THEN** 发送给 `/api/llm/chat` 的请求体中 `tools` 字段为 undefined

### Requirement: Agent 系统工具使用页面级 API 路径

`agent/tools.ts` 中的 `queryData` 和 `listSchemas` 工具 SHALL 使用 `detectBasePath()` 构建 API URL，确保在 iframe 页面级路径下正确访问端点。

#### Scenario: queryData 使用 detectBasePath
- **WHEN** 应用运行在 `/serve/testuser/leave-form/` 路径下
- **AND** `queryData` 工具查询 `leave_requests` 资源
- **THEN** 请求 URL 为 `/serve/testuser/leave-form/api/leave_requests`

#### Scenario: listSchemas 使用 detectBasePath
- **WHEN** 应用运行在 `/serve/testuser/leave-form/` 路径下
- **AND** `listSchemas` 工具执行
- **THEN** 请求 URL 为 `/serve/testuser/leave-form/api/_schemas`
