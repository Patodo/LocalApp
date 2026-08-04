## Context

当前 LocalApp 平台支持用户构建纯静态页面 + 数据 CRUD 的应用。用户希望通过在页面中嵌入 AI 助手，让终端用户能用自然语言操作页面数据（如"帮我填一下请假表"）。

Agent SDK 的核心思路是在浏览器端运行 pi-agent-core 的 Agent 循环，通过服务端 LLM 代理端点调用大模型，工具定义分为系统级（自动暴露）和用户自定义两类。

技术栈依赖：
- **pi-ai**：统一 LLM API 层，支持 callLLM 函数
- **pi-agent-core**：Agent 循环引擎，管理消息历史、工具调用、响应解析

init-repo 模板预装 SDK 源码（`src/lib/localapp/`），新增的 agent 相关代码放在 `src/lib/localapp/agent/` 下。

## Goals / Non-Goals

**Goals:**

- 服务端提供 LLM 代理端点，基于当前用户身份鉴权，服务端管理 API Key
- 提供 `useAgent()` Hook，封装 Agent 循环，自动注入 schema 上下文和系统级工具
- 提供 `<AgentChat />` 开箱即用的对话组件
- 系统级只读工具（getCurrentUser、queryData、listSchemas）自动暴露
- 用户自定义写操作工具通过 `useAgent({ tools })` 传入
- SSE 流式响应支持

**Non-Goals:**

- 不做多轮对话持久化（对话历史仅存于内存，刷新即丢失）
- 不做 Agent 权限隔离（Agent 以当前登录用户身份操作，受相同 ACL 约束）
- 不做多模型选择（服务端配置单一模型）
- 不做工具执行沙箱（工具在浏览器主线程执行，与页面共享 DOM/JS 上下文）
- 不做 Agent 多实例（一个页面只能有一个 Agent 实例）

## Decisions

### 1. LLM 代理模式：服务端转发

**选择**：服务端提供 `POST /api/llm/chat` 端点，验证用户身份后转发 LLM 请求，API Key 仅存服务端。

**理由**：避免在前端暴露 LLM API Key。前端通过 cookie/JWT 自动鉴权，无需额外配置。

**备选方案**：前端直连 LLM API → 需要将 API Key 暴露给前端，不安全。

### 2. Agent 运行在浏览器主线程

**选择**：Agent 循环在浏览器主线程运行，使用 pi-agent-core 库。

**理由**：Agent 需要直接调用页面 SDK（useCreate、useUpdate 等）和操作 DOM，主线程访问最直接。pi-agent-core 是纯 JS 库，无需 Worker 通信开销。

**备选方案**：Web Worker 运行 → 工具调用需要 postMessage 桥接，复杂度高且无法直接操作 DOM。

### 3. pi-ai 适配：callLLM 指向代理端点

**选择**：适配 pi-ai 的 callLLM 函数，底层调用 `POST /api/llm/chat`，解析 SSE 流。

**理由**：pi-ai 提供统一的 LLM 调用抽象，适配后可直接使用 pi-agent-core 的 Agent 循环。

### 4. 工具分两层：系统级 + 用户自定义

**选择**：系统级只读工具（getCurrentUser、queryData、listSchemas）由 SDK 自动注册。写操作工具（如 createRecord、updateRecord）由应用创建者通过 `useAgent({ tools })` 传入。

**理由**：读操作安全无副作用，自动暴露降低接入成本。写操作可能产生数据变更，需应用创建者显式授权。

### 5. Schema 上下文自动注入

**选择**：`useAgent()` 初始化时自动获取当前页面的所有 schema，格式化为自然语言描述注入 Agent 系统提示。

**理由**：LLM 需要理解页面数据结构才能正确使用工具。自动注入免除用户手动维护。

### 6. 组件设计：AgentChat 单组件

**选择**：提供 `<AgentChat />` 单一组件，包含消息列表、输入框、发送按钮、工具调用状态展示。

**理由**：开箱即用，降低接入成本。高级用户可自行基于 useAgent 构建自定义 UI。

## Risks / Trade-offs

- **[LLM 调用成本]** → 每次用户对话都会产生 LLM API 调用费用。缓解：服务端可配置速率限制，前端可限制消息频率。
- **[浏览器性能]** → Agent 循环和 SSE 解析在主线程运行，大量消息时可能影响 UI 响应。缓解：实际场景中对话频率低，pi-agent-core 的循环是异步的。
- **[工具执行安全]** → Agent 可调用用户定义的任意工具。缓解：Agent 以当前用户身份运行，受 ACL 约束，且写工具需显式定义。
- **[pi-ai/pi-agent-core 依赖]** → 引入外部依赖可能带来版本兼容问题。缓解：锁定版本，按需升级。
