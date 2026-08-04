## Why

LocalApp 用户目前只能构建纯静态页面 + 数据 CRUD 的应用。随着 AI Agent 能力的成熟，用户希望在自己的页面中嵌入 AI 助手，让终端用户能用自然语言操作页面数据（如"帮我填一下请假表"）。平台需要提供 Agent SDK，让应用创建者能以最小成本在页面中集成 AI 能力。

## What Changes

- 新增服务端 LLM 代理端点 `POST /api/llm/chat`，基于当前登录用户的 cookie/JWT 鉴权，服务端管理 LLM API Key，向前端提供 SSE 流式响应
- 新增 `useAgent()` React Hook，封装 pi-agent-core 的 Agent 循环，自动注入 schema 上下文和系统级工具
- 新增 `<AgentChat />` UI 组件，提供开箱即用的对话界面
- SDK 自动暴露系统级只读工具（getCurrentUser、queryData、listSchemas），写操作工具由应用创建者显式定义
- 引入 `pi-ai` 和 `pi-agent-core` npm 依赖，适配 pi-ai 的 callLLM 指向服务端代理端点

## Capabilities

### New Capabilities

- `llm-proxy`: 服务端 LLM 代理端点，验证用户身份后转发 LLM 请求，支持 SSE 流式响应
- `agent-runtime`: 基于 pi-agent-core 的浏览器端 Agent 运行时，包含 Agent 循环、工具调用、schema 上下文自动注入
- `agent-tools`: 工具定义框架，包含系统级只读工具（自动暴露）和用户自定义写操作工具
- `agent-ui`: 开箱即用的 `<AgentChat />` 对话组件，支持流式消息展示、工具调用状态显示

### Modified Capabilities

（无现有规格需要修改）

## Impact

- **packages/server**: 新增 `src/routes/llm.ts` 路由，新增 LLM 配置项（apiKey、model、baseUrl）
- **init-repo/**: 新增 `pi-ai` 和 `pi-agent-core` npm 依赖，新增 `useAgent` Hook、`AgentChat` 组件、agent 工具类型定义
- **packages/server/src/lib/config.ts**: 新增 LLM 相关配置字段（llmApiKey、llmModel、llmBaseUrl）
- **packages/server/src/index.ts**: 注册 llm 路由
- **init-repo/CLAUDE.md**: 新增 useAgent 和 AgentChat 文档
