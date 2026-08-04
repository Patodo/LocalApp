## 1. Tailwind 基础设施

- [x] 1.1 在 init-repo/package.json 添加 `@assistant-ui/react` 到 dependencies，`tailwindcss` 和 `@tailwindcss/postcss` 到 devDependencies
- [x] 1.2 创建 `init-repo/postcss.config.js`，配置 `@tailwindcss/postcss` 插件
- [x] 1.3 创建 `init-repo/src/index.css`，内容为 `@import "tailwindcss";`
- [x] 1.4 修改 `init-repo/src/main.tsx`，顶部添加 `import "./index.css";`
- [x] 1.5 验证：在 init-repo 目录执行 `npm install && npm run build`，确认构建成功

## 2. 消息格式适配器

- [x] 2.1 创建 `init-repo/src/lib/localapp/agent/assistant-ui-adapter.ts`，实现 `convertMessages(msgs: AgentMessage[]): ThreadMessageLike[]`
- [x] 2.2 实现用户消息转换（UserMessage → user ThreadMessageLike）
- [x] 2.3 实现助手消息转换（TextContent → text part, ToolCall → tool-call part）
- [x] 2.4 实现 Tool Result 合并逻辑（ToolResultMessage → 匹配 toolCallId 合并到 assistant 消息的 tool-call part）
- [x] 2.5 编写单元测试验证各种消息组合的转换结果
- [x] 2.6 验证：运行 `npx vitest run` 确认适配器测试通过
- [x] 2.7 提交：`feat(agent): 添加 assistant-ui 消息格式适配器`

## 3. AgentChat 重写

- [x] 3.1 重写 `init-repo/src/lib/localapp/agent/agent-chat.tsx`，使用 `useExternalStoreRuntime` + `<Thread />`
- [x] 3.2 在 AgentChat 中使用 `useMemo` 调用 `convertMessages` 转换消息，传递给 ExternalStoreRuntime
- [x] 3.3 桥接 `onNew` 回调到 `agent.send()`
- [x] 3.4 传递 `isRunning` 和 `error` 状态
- [x] 3.5 验证：执行 `npm run build` 确认 TypeScript 编译通过，无类型错误
- [x] 3.6 提交：`feat(agent): 用 assistant-ui Thread 替换手写 AgentChat`

## 4. 端到端验证

- [x] 4.1 将更新后的 SDK 文件复制到 leave-form 测试 app（`/tmp/localapp-demo/leave-form/src/lib/localapp/agent/`）
- [x] 4.2 在 leave-form 目录安装新依赖（`@assistant-ui/react`、`tailwindcss`、`@tailwindcss/postcss`）
- [x] 4.3 添加 postcss.config.js、index.css、main.tsx import 到 leave-form
- [x] 4.4 构建并上传 leave-form 新版本
- [x] 4.5 用 chrome-devtools MCP 访问 `http://localhost:3000/serve/testuser/leave-form/`，验证：
  - AgentChat 正确渲染（非空白、非报错）
  - 发送消息后流式输出正常
  - 工具调用（fillForm）和结果展示正常
  - 表单提交成功
- [x] 4.6 提交：`test(agent): 端到端验证 assistant-ui AgentChat 集成`
