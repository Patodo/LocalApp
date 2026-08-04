## Context

当前 `init-repo/src/lib/localapp/agent/agent-chat.tsx` 是一个约 170 行的手写聊天组件，使用纯 inline style 渲染。它处理用户消息气泡、助手文本块、工具调用/结果展示和流式动画。但视觉质量差（用户原话"有点丑"），缺少 Markdown 渲染、专业工具调用 UI 和无障碍支持。

init-repo 模板目前**没有任何 CSS 框架**——零 Tailwind、零 PostCSS、零 CSS 文件。所有样式都是 inline style。

pi-agent-core 的 Agent 类管理完整的 LLM 循环（流式输出、工具执行、消息状态），通过事件回调通知 React 层。`useAgent` hook 将这些事件转换为 React 状态（`messages: AgentMessage[]`、`isRunning: boolean`）。

assistant-ui 提供 `useExternalStoreRuntime`，专门用于"自带状态管理，只用 UI 渲染"的场景。

## Goals / Non-Goals

**Goals:**

- 用 assistant-ui 的 `<Thread />` 替换手写 AgentChat，获得专业级聊天 UI
- 引入 Tailwind CSS 到 init-repo 模板，作为所有新建 app 的样式基础设施
- 保持 `useAgent` + `AgentChat` 的对外接口不变，应用代码零改动
- 正确映射 pi-agent-core 消息格式到 assistant-ui 消息格式（处理 tool result 合并）
- 保持流式输出的实时性和用户体验

**Non-Goals:**

- 不修改 pi-agent-core 或 pi-ai 的消息模型
- 不改变 `useAgent` hook 的 API
- 不改造现有已部署 app 的 AgentChat（它们有独立 SDK 副本）
- 不使用 assistant-ui 的 Toolkit/tools 系统（工具执行仍由 pi-agent-core 管理）
- 不引入 assistant-ui 的 thread 管理（多轮对话历史）

## Decisions

### 1. 使用 ExternalStoreRuntime 而非 LocalRuntime

**选择**: `useExternalStoreRuntime`，保持 pi-agent-core 管理完整 Agent 循环。

**原因**: LocalRuntime 要求用 assistant-ui 的 runtime 驱动 LLM 调用循环，这意味着要重写 streamFn、tool execution 等核心逻辑。ExternalStoreRuntime 只做 UI 渲染，我们继续用 pi-agent-core 管理状态，通过 adapter 桥接。

**替代方案**: LocalRuntime — 工作量大，且 pi-agent-core 的 Agent 类有丰富的生命周期管理（steering、followUp、beforeToolCall 等），不值得替换。

### 2. Tool Result 合并策略

**选择**: 在 `convertMessages()` 中预处理，将 `ToolResultMessage` 合并回对应 `AssistantMessage` 的 `tool-call` part 的 `result` 字段。

**原因**: pi-agent-core 中 tool result 是独立消息（`role: "toolResult"`，通过 `toolCallId` 关联），而 assistant-ui 期望 tool result 是 tool-call part 的内嵌 `result` 字段。

```
pi-agent-core:
  [UserMsg, AssistantMsg(toolCall(id:abc)), ToolResultMsg(toolCallId:abc)]

assistant-ui:
  [UserMsg, AssistantMsg(tool-call(id:abc, result:{...}))]
```

### 3. Tailwind v4 + PostCSS

**选择**: Tailwind CSS v4（`@tailwindcss/postcss`）+ PostCSS。

**原因**: v4 配置最简（`@import "tailwindcss"` 一行 CSS，无需 tailwind.config.js），与 Vite 6 兼容良好。每个新建 app 自动获得 Tailwind 支持，开发者也可以用它写自己的样式。

### 4. 不使用 shadcn 拷贝模式

**选择**: 直接 `import { Thread } from "@assistant-ui/react"`。

**原因**: assistant-ui 推荐把组件源码拷贝进项目以定制，但我们是 SDK，需要保持封装。app 开发者如果需要深度定制，可以不使用 `<AgentChat />` 而直接用 assistant-ui 的 primitives。

### 5. Streaming 状态处理

**选择**: `isRunning: true` + messages 数组中包含 partial assistant message。

**原因**: pi-agent-core 的 `message_update` 事件不断更新 `streamingMessage`，useAgent hook 通过 `setMessages([...agent.state.messages])` 保持 React 状态同步。assistant-ui 的 ExternalStoreRuntime 检测到 `isRunning: true` 且最后一条是 assistant 消息时，会渲染该消息的内容（含流式动画），不会额外添加乐观更新消息。

## Risks / Trade-offs

- **Tailwind 被强加给所有 app** → 缓解：Tailwind 是纯 CSS 工具链，不影响 JS 逻辑。app 开发者可以选择不用 Tailwind class，但构建链中包含 PostCSS 步骤。实际包体积增量来自 assistant-ui 而非 Tailwind（Tailwind 在构建时被处理为普通 CSS）
- **assistant-ui 版本锁定** → 缓解：ExternalStoreRuntime API 相对稳定，且 adapter 层隔离了 assistant-ui 和 pi-agent-core
- **包体积增大** → 缓解：Vite tree-shaking。实际增量待构建后测量
- **assistant-ui 对 isRunning + partial message 的行为可能不符合预期** → 缓解：端到端验证时重点测试流式场景
