## 1. ToolCallDisplay 折叠功能

- [x] 1.1 `agent-chat.tsx`: ToolCallDisplay 新增 `expanded` state，默认 `false`；折叠态渲染一行摘要（图标 + 工具名 + 结果摘要 ≤60 字符 + 展开按钮）
- [x] 1.2 `agent-chat.tsx`: 展开态渲染完整 JSON args 和 result（与当前一致），展开按钮变为折叠按钮；整行可点击切换
- [x] 1.3 `agent-chat.tsx`: 工具执行中（result 为 undefined）自动展开显示入参，不渲染折叠/展开按钮

## 2. 构建验证

- [x] 2.1 `npm run build` 在 init-repo 目录编译通过，无 TypeScript 错误
- [x] 2.2 验证: 使用 `localapp init` 创建新应用后，`AgentChat` 工具调用默认折叠，点击可展开
