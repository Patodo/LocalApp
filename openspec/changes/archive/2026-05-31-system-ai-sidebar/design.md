## Context

当前 AI 能力完全在 iframe 内的应用侧实现：开发者通过 `useAgent()` 创建 Agent 实例、注册工具，再用 `<AgentChat />` 渲染聊天 UI。LLM 请求通过 `/api/llm/chat` 服务端代理转发。

关键约束：
- Platform Shell 和 iframe 是**同源**的（`/serve/:userId/:name/`），postMessage 不需要跨域处理
- `UserToolDef` 的 `execute` 函数操作 iframe 内的 React state，**不能序列化**到 Shell 层
- 系统工具（`getCurrentUser`、`queryData`、`listSchemas`）通过 HTTP API 执行，可在 Shell 层直接调用

```
当前架构：
┌─ Platform Shell ──────────────────────┐
│ Navbar                                │
│ ┌─ iframe ──────────────────────────┐ │
│ │ useAgent() → Agent 实例           │ │
│ │ <AgentChat /> → 聊天 UI          │ │
│ │ /api/llm/chat → LLM 代理         │ │
│ └───────────────────────────────────┘ │
└───────────────────────────────────────┘
```

## Goals / Non-Goals

**Goals:**
- AI 侧边栏成为系统级 UI，开发者只需调用 `useRegisterTools({ tools, systemHint })`
- 侧边栏浮动覆盖 iframe，不影响应用布局
- 保留高阶开发者完全自定义 AI 的能力（Mode B）
- 侧边栏宽度可拖拽、偏好持久化

**Non-Goals:**
- 不改变 `UserToolDef` 类型定义
- 不改变 `/api/llm/chat` 服务端代理的行为
- 不在此变更中实现服务端 AI 配置面板（autoExecute 等参数先硬编码或读 config.toml）
- 不支持跨应用的 Agent 状态持久化（刷新后对话清空）

## Decisions

### Decision 1: Agent 实例创建在 Shell 层

**选择**: Agent (`pi-agent-core`) 在 PlatformShell 组件中创建和管理。

**原因**: Shell 层拥有 AI 侧边栏的 UI 状态和 LLM 连接。Agent 需要 `streamFn`（调用 `/api/llm/chat`），这和当前 iframe 内的调用方式完全一致。

**替代方案**: Agent 仍在 iframe 内创建，通过 postMessage 传递消息流到 Shell 层渲染。缺点是增加了不必要的复杂性，且 Agent 的 LLM 调用和 Shell 的 UI 状态需要双向同步。

### Decision 2: postMessage 作为 Shell-iframe 通信机制

**选择**: 使用 `window.postMessage` 在 Shell 和 iframe 之间传递工具注册、调用和结果。

**协议设计**:

```
iframe → Shell:
  { type: "localapp:register_tools", tools: ToolSchema[], systemHint?: string }
  { type: "localapp:ai_custom_mode" }
  { type: "localapp:tool_result", callId: string, result: unknown, isError?: boolean }

Shell → iframe:
  { type: "localapp:tool_call", callId: string, toolName: string, args: Record<string, unknown> }
  { type: "localapp:toggle_chat" }  // Mode B: 触发应用自定义聊天
```

**原因**: Shell 和 iframe 同源，postMessage 可靠且零依赖。使用 `localapp:` 前缀避免消息冲突。

**替代方案**: SharedWorker / BroadcastChannel。前者浏览器支持不一致，后者不适合同源父子窗口场景。

### Decision 3: 工具注册传输 schema，execute 留在 iframe

**选择**: `useRegisterTools` 只向 Shell 发送工具的 schema（name, description, parameters），不传输 `execute` 函数。execute 保留在 iframe 内的闭包中。

**工具执行流程**:

```
1. Shell Agent 产生 tool_call
2. Shell 通过 postMessage 发送 { type: "localapp:tool_call", callId, toolName, args }
3. iframe SDK 监听消息，查找本地 execute 函数
4. 执行 execute(args)，获得 result
5. iframe 通过 postMessage 发送 { type: "localapp:tool_result", callId, result }
6. Shell 收到 result，Agent 继续对话
```

**原因**: `execute` 函数操作 React state，无法脱离 iframe 上下文运行。

### Decision 4: 两种 AI 模式

**Mode A — 系统AI（默认）**: 应用调用 `useRegisterTools()`，Shell 渲染系统侧边栏。

**Mode B — 自定义AI（高级）**: 应用使用 `useAgent({ shellIntegration: true })` + `<AgentChat />`。Shell 检测到自定义模式后，AI 按钮改为向 iframe 发送 `toggle_chat` 消息，由应用控制聊天 UI。

**检测机制**: Shell 监听 iframe 的 postMessage。收到 `localapp:register_tools` → Mode A；收到 `localapp:ai_custom_mode` → Mode B；两者都没收到 → 不显示 AI 按钮。

### Decision 5: 侧边栏浮动 overlay 实现

**选择**: 侧边栏使用 `position: absolute` 定位在 iframe 容器之上（Shell 内 flex 布局的 `relative` 容器内）。

```
┌─ flex h-screen flex-col ────────────────────────┐
│ Navbar (shrink-0)                                │
│ ┌─ flex-1 relative ──────────────────────────┐  │
│ │ iframe (w-full h-full)                     │  │
│ │                                            │  │
│ │               ┌─ absolute right-0 ────────┐│  │
│ │               │ AI Sidebar (overlay)       ││  │
│ │               │ w-[var(--sidebar-width)]   ││  │
│ │               │ h-full                     ││  │
│ │               └───────────────────────────┘│  │
│ └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**原因**: iframe 保持全宽全高不受影响。侧边栏视觉上覆盖 iframe 右侧区域。

### Decision 6: 宽度拖拽和持久化

**选择**: 使用 CSS 变量 `--ai-sidebar-width` 控制侧边栏宽度。拖拽手柄修改 CSS 变量，`mouseup` 时将宽度值存入 `localStorage`（key: `localapp-ai-sidebar-width`）。组件挂载时读取 localStorage 初始化。

**默认宽度**: 380px。最小 280px，最大 600px。

## Risks / Trade-offs

**[postMessage 异步延迟]** → 工具执行比 iframe 内直接调用多一次 postMessage 往返。对于操作 React state 的工具（如表单填写），延迟通常 < 5ms，用户无感知。对于需要网络请求的工具，LLM 本身的延迟远大于 postMessage 开销。

**[iframe 加载时序]** → Shell 的 Agent 可能在 iframe 注册工具之前就创建了。需要处理 Agent 创建时工具列表为空的情况：Agent 先用系统工具启动，收到 `register_tools` 后动态添加工具到 Agent 的 tool 列表。pi-agent-core 的 `agent.state.tools` 是可变数组，支持动态添加。

**[Mode B 按钮冗余]** → 高阶应用可能同时在 Shell 有 AI 按钮和自己的触发入口。Shell 的 AI 按钮发送 `toggle_chat`，应用自行决定如何响应。如果应用不想要 Shell 按钮，可以在 postMessage 中声明 `hideShellButton: true`。

**[多工具并发调用]** → LLM 可能在一个响应中调用多个工具。每个工具调用有独立的 `callId`，iframe 的 SDK 需要支持并发执行多个工具并独立返回结果。`useRegisterTools` 内部维护一个 `Map<callId, Promise>` 来处理并发。
