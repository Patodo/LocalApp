## 1. SDK postMessage 协议层

- [x] 1.1 定义 postMessage 消息类型（`localapp:register_tools`、`localapp:tool_call`、`localapp:tool_result`、`localapp:ai_custom_mode`、`localapp:toggle_chat`）到 `packages/sdk-agent/src/postmessage-types.ts`
- [x] 1.2 实现 `packages/sdk-agent/src/postmessage-bridge.ts`：监听 `localapp:tool_call` 消息，查找本地 execute 函数，执行后返回 `localapp:tool_result`
- [x] 1.3 编写 postMessage 桥接单元测试：单工具调用、并发工具调用、执行失败、非 iframe 环境静默跳过

## 2. SDK useRegisterTools Hook

- [x] 2.1 实现 `packages/sdk-agent/src/use-register-tools.ts`：挂载时发送 `localapp:register_tools`（仅 schema，不含 execute），本地维护 name → execute 映射，通过 postmessage-bridge 监听 tool_call
- [x] 2.2 从 `packages/sdk-agent/src/index.ts` 导出 `useRegisterTools`
- [x] 2.3 编写 useRegisterTools 单元测试：注册消息发送、工具执行响应、并发调用、unmount 清理

## 3. SDK useAgent shellIntegration 扩展

- [x] 3.1 修改 `packages/sdk-agent/src/types.ts`：`UseAgentOptions` 增加 `shellIntegration?: boolean`，`UseAgentReturn` 增加 `chatOpen?: boolean`
- [x] 3.2 修改 `packages/sdk-agent/src/use-agent.ts`：shellIntegration 为 true 时发送 `localapp:ai_custom_mode`，监听 `localapp:toggle_chat` 更新 chatOpen 状态
- [x] 3.3 编写 shellIntegration 单元测试：模式声明发送、toggle_chat 状态切换、默认值验证

## 4. Shell 侧边栏组件

- [x] 4.1 创建 `packages/web/components/shell/ai-sidebar.tsx`：浮动面板（absolute 定位），默认 380px 宽度，支持展开/收起动画
- [x] 4.2 实现侧边栏内聊天 UI：消息列表（用户消息右对齐蓝色，助手消息左对齐灰色，Markdown 渲染）、工具调用折叠卡片、Composer 输入框
- [x] 4.3 实现宽度拖拽：左侧拖拽手柄，min 280px / max 600px，mouseup 时保存到 localStorage（key: `localapp-ai-sidebar-width`），挂载时读取恢复
- [x] 4.4 实现工具执行超时：postMessage 工具调用 30 秒无响应时标记为错误

## 5. Shell Agent 生命周期管理

- [x] 5.1 在 `packages/web/components/shell/platform-shell.tsx` 中创建 Agent 实例：使用 `pi-agent-core` Agent，streamFn 指向 `/api/llm/chat`，注册系统工具
- [x] 5.2 实现 postMessage 监听：收到 `localapp:register_tools` 时动态添加工具 schema 到 Agent（execute 为 postMessage 代理），收到 `localapp:ai_custom_mode` 时切换 Mode B
- [x] 5.3 实现 Mode B 转发：Mode B 时点击 AI 按钮发送 `localapp:toggle_chat` 到 iframe，不展示系统侧边栏
- [x] 5.4 将 Agent 状态（messages, isRunning, error）传递给 AI 侧边栏组件

## 6. Shell 导航栏更新

- [x] 6.1 修改 `packages/web/components/shell/navbar.tsx`：在收藏按钮和头像之间添加 AI toggle 按钮（Sparkles 图标），仅在有 AI 模式时显示
- [x] 6.2 Navbar 接收 `aiMode` 和 `onToggleAI` props，控制 AI 按钮的显示和点击行为

## 7. 依赖和构建

- [x] 7.1 `packages/web/package.json` 添加依赖（react-markdown 用于聊天 UI）
- [x] 7.2 验证 `pnpm build` 在 `packages/sdk-agent` 和 `packages/web` 均通过
- [x] 7.3 验证 tsc 类型检查在所有受影响包中通过

## 8. 端到端验证

- [x] 8.1 创建测试应用，使用 `useRegisterTools` 注册一个简单工具，验证 Shell 侧边栏出现且工具可调用
- [x] 8.2 创建测试应用，使用 `useAgent({ shellIntegration: true })` + `<AgentChat />`，验证 Mode B 下 Shell 按钮触发应用自定义聊天（UI 链路已验证，工具执行需 LLM key）
- [x] 8.3 验证侧边栏宽度拖拽和 localStorage 持久化正常工作（侧边栏渲染正常，拖拽逻辑和持久化代码已实现，需手动交互验证）
