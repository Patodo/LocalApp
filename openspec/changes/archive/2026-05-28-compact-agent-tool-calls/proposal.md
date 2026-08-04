## Why

`AgentChat` 中的 `ToolCallDisplay` 组件对每个工具调用展开渲染完整 JSON 入参和返回值。在一次典型的 Agent 交互中（如 fillForm × 3 + submitBug），工具调用卡片会占据对话区 50% 以上的可视空间，淹没真正的文本交流内容。终端用户不需要看到 `{"field":"title","value":"..."}` 这种技术细节，他们只关心 Agent 做了什么操作、结果是什么。

## What Changes

- **ToolCallDisplay 默认折叠**：工具调用卡片默认只显示一行摘要（图标 + 工具名 + 结果摘要），点击可展开查看完整 JSON 入参和返回值
- **视觉层次优化**：折叠时用更紧凑的一行布局，展开行为不变（保留完整 JSON 方便调试）
- **对外接口不变**：`AgentChat` 的 props 和行为完全兼容，不需要修改任何应用代码

## Capabilities

### New Capabilities
<!-- None for this change -->

### Modified Capabilities
- `assistant-ui-chat`: ToolCallDisplay 组件的渲染行为从"始终展开 JSON"改为"默认折叠、点击展开"

## Impact

- `init-repo/src/lib/localapp/agent/agent-chat.tsx` — 修改 `ToolCallDisplay` 组件，新增折叠/展开状态管理
- `init-repo/CLAUDE.md` 不受影响（不涉及 AgentChat 使用方式的变更）
- 对所有已部署应用的运行时行为有视觉影响（工具调用默认折叠），但无功能影响
