## Context

当前 Agent SDK 的系统提示词在 `context.ts` 的 `buildSystemPrompt()` 中构建，内容是静态的：
- 固定的角色描述（"你是一个运行在 LocalApp 应用中的 AI 助手"）
- 运行时获取的 schema context（数据结构定义）
- 开发者传入的 `systemHint`

问题：
1. LLM 不知道当前用户是谁，无法自动填写姓名、部门等用户关联字段
2. 工具使用引导过于模糊，LLM 倾向于给文字建议
3. 应用元信息（页面名称、描述）未注入，LLM 不知道自己在什么应用里

关键文件：
- `init-repo/src/lib/localapp/agent/use-agent.ts` — 初始化逻辑
- `init-repo/src/lib/localapp/agent/context.ts` — 系统提示词构建
- `init-repo/src/lib/localapp/client.ts` — `detectBasePath()` 已导出

## Goals / Non-Goals

**Goals:**
- Agent 初始化时自动获取用户身份和页面元信息，注入系统提示词
- 系统提示词分为两层：系统层（平台自动注入）+ 应用层（开发者 `systemHint`）
- 增强工具使用指令，让 LLM 更倾向于调用工具完成操作
- 向后兼容：现有 `useAgent({ systemHint })` 行为不变

**Non-Goals:**
- 不修改 `pi-agent-core` 或 `pi-ai` 等外部依赖
- 不改变 `tools.ts` 中的工具定义结构
- 不涉及 LLM 模型选择或参数调优

## Decisions

### 1. 提示词两层注入策略

**决定**：`buildSystemPrompt` 接收三个参数：`systemContext`（系统层）、`schemaContext`（数据层）、`hint`（应用层），按系统层 → 数据层 → 应用层的顺序拼接。

**理由**：分层可以让系统层提供强约束（工具使用指令），数据层提供上下文（schema），应用层提供灵活性。顺序保证系统层优先级最高，LLM 最先读到。

**替代方案**：将所有内容塞进 `systemHint` — 不可行，因为 `systemHint` 由开发者控制，系统信息不应由开发者手动传递。

### 2. 系统层信息获取方式

**决定**：在 `useAgent` 的 `init()` 函数中并行获取三个信息源：
- `/api/me` — 当前用户（null 如果未登录）
- `api/_schemas`（通过 `detectBasePath`）— 数据结构
- 页面名称从 `window.location.pathname` 中解析（`/serve/{userId}/{name}/` → name）

**理由**：
- 用户信息已在 `client.ts` 的 `createClient().me()` 中实现，复用同一模式
- 页面名称从 URL 解析，无需额外 API 调用
- 与现有 `fetchSchemaContext()` 并行调用，不增加初始化延迟

**替代方案**：新增服务端端点返回完整的 agent 初始化上下文 — 过度设计，当前信息量不大。

### 3. 系统提示词内容结构

**决定**：系统层包含以下段落：

```
你是一个运行在 LocalApp 应用中的 AI 助手。
当前应用: {pageName}
当前用户: {userName || "未登录"}

## 工具使用规则
当用户的需求可以映射到工具操作时，必须调用工具执行，不要仅给文字建议。
信息不完整时，先询问缺失的必填参数，收集完整后立即调用工具。
```

**理由**：
- "当前应用" 和 "当前用户" 让 LLM 立即建立上下文感知
- 工具使用规则以指令形式给出，比建议性的"你可以使用工具"更有效
- 保持简洁，不与 schema context 和 systemHint 内容重叠

## Risks / Trade-offs

- **初始化延迟增加** → 并行获取用户信息和 schema context，实际延迟与之前接近
- **未登录时信息不完整** → 系统层明确标注"未登录"，LLM 可据此询问用户身份
- **页面名称解析依赖 URL 格式** → 使用已有的 `detectBasePath` 正则模式，稳定可靠

## 前置修复

在实施过程中发现以下已有 bug，必须同步修复才能使本次变更生效：

### 4. LLM Adapter 未传递系统提示词和工具定义

**问题**：`llm-adapter.ts` 的 `createStreamFn` 只映射了 `context.messages`，未使用 `context.systemPrompt` 和 `context.tools`。导致系统提示词和工具定义从未发送给 LLM，两层注入形同虚设。

**修复**：
- 从 `context.systemPrompt` 读取系统提示词，作为第一条 system message 注入
- 从 `context.tools` 读取工具定义，转为 OpenAI function calling 格式传递
- 完善 `tool_calls` 流式解析，正确触发 `toolcall_start/delta/end` 事件

### 5. Agent 工具路径硬编码

**问题**：`tools.ts` 中 `queryData` 和 `listSchemas` 使用硬编码的 URL 路径（如 `/api/schemas`），在 iframe 页面级路径下不可达。

**修复**：统一使用 `detectBasePath()` 获取页面级 API 路径，配合 server 端新增的页面级 `_schemas` 端点。
