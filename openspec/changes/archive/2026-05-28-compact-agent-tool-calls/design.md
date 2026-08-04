## Context

当前 `agent-chat.tsx` 中的 `ToolCallDisplay`（第 114-133 行）始终展开渲染工具调用的完整 JSON 入参和返回值。在一次典型的 Agent 交互中（如先 fillForm 多次再 submitBug），这些蓝色卡片会占据大量对话空间，增加用户的阅读负担。

目标：默认折叠工具调用细节，用户只需看到 Agent 做了什么操作和结果，技术细节（完整 JSON）按需点击展开。

## Goals / Non-Goals

**Goals:**
- ToolCallDisplay 默认只显示一行摘要（图标 + 工具名 + 结果摘要）
- 点击摘要行可展开/折叠完整 JSON
- 展开时行为与当前完全一致（显示 args JSON + result）
- 对外接口不变（`AgentChat` props、`ToolCallDisplay` props 签名不变）

**Non-Goals:**
- 不添加 prop 控制折叠行为（保持简单）
- 不修改消息格式转换、发送桥接等其他 AgentChat 功能
- 不改变工具调用的数据结构或 `assistant-ui-adapter.ts`

## Decisions

### Decision 1: 使用 React useState 控制折叠状态

`ToolCallDisplay` 内部新增 `const [expanded, setExpanded] = useState(false)` 控制展开/折叠。

- 折叠态（默认）：一行 flex 布局，`✓ toolName` + 结果摘要（截断到 ~60 字符）+ `[展开]` 按钮
- 展开态：与当前完全一致的预格式化 JSON 展示 + `[折叠]` 按钮

**实现方式**：
```
折叠:
┌──────────────────────────────────────────────┐
│ ✓ fillForm  title → 已填写 title: 登录... [>] │
└──────────────────────────────────────────────┘

展开 (点击后):
┌──────────────────────────────────────────────┐
│ ✓ fillForm                            [v]    │
│ ┌──────────────────────────────────────┐     │
│ │ { "field": "title",                  │     │
│ │   "value": "登录页面提交按钮无响应" } │     │
│ ├──────────────────────────────────────┤     │
│ │ "已填写 title: 登录页面提交按钮无响应" │     │
│ └──────────────────────────────────────┘     │
└──────────────────────────────────────────────┘
```

**备选方案**：
- 用 CSS `details`/`summary` 元素 → 放弃。样式控制有限，在 inline-style 环境中不够灵活。
- 用 `AgentChat` prop 控制 → 放弃。增加 API 复杂度，YAGNI。默认折叠适合所有场景。

### Decision 2: 结果摘要截断策略

从 `result` 字符串中取前 ~60 字符，去除 JSON 引号和换行，生成可读的一行摘要。具体规则：
- `result` 为 string 时：取 `result.slice(0, 60)`，追加 `...` 如果超过 60 字符
- `result` 为 object 时：用 `JSON.stringify(result)` 后再截断
- `result` 为 undefined 时（工具执行中）：显示 `⏳` + 工具名，无摘要

## Risks / Trade-offs

- **风险**: 折叠态摘要可能截断不自然 → **缓解**: 60 字符截断是合理的，摘要只用于快速扫描，详细信息可展开查看
- **风险**: `[展开]` 按钮过小，移动端点击困难 → **缓解**: 整个摘要行可点击，不只是按钮文字。实际部署在 iframe 中，视口通常 > 800px 宽
- **风险**: 工具执行中（无 result）的过渡态显示不够清晰 → **缓解**: 保持当前 `⏳` 图标，执行中自动展开（`isRunning` 时默认展开）

## Open Questions

- 工具执行中（`hasResult === false`）时是否默认展开？建议：执行中自动展开（让用户看到进度），执行完成后折叠。可在实现时验证体验。
