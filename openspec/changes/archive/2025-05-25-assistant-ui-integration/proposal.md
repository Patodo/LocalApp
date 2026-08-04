## Why

当前 AgentChat 组件（`init-repo/src/lib/localapp/agent/agent-chat.tsx`）是约 170 行手写代码，全部使用 inline style，视觉质量差（用户反馈"有点丑"）。缺少 Markdown 渲染、专业工具调用展示、无障碍支持。引入 `@assistant-ui/react` 可以获得专业级聊天 UI，包括 Tailwind 驱动的样式系统、内置工具渲染、流式输出动画和 Radix 无障碍原语。

## What Changes

- 引入 `@assistant-ui/react`（v0.14.x）作为 AgentChat 的 UI 层
- 引入 Tailwind CSS（v4）到 init-repo 模板（PostCSS + `@import "tailwindcss"`）
- 新增 `assistant-ui-adapter.ts`：将 pi-agent-core 的 `AgentMessage[]` 转换为 assistant-ui 的 `ThreadMessageLike[]`
- 重写 `agent-chat.tsx`：使用 `useExternalStoreRuntime` + `<Thread />` 替换手写实现
- 对外接口（`useAgent` + `AgentChat` 的导出和用法）不变，应用代码零改动

## Capabilities

### New Capabilities

- `assistant-ui-chat`: 基于 assistant-ui 的 Agent 聊天 UI，包括消息渲染、工具调用展示、流式动画、输入组件

### Modified Capabilities

- `init-template`: init-repo 模板新增 Tailwind CSS 构建基础设施（postcss.config.js、index.css）

## Impact

- **依赖变更**: init-repo/package.json 新增 `@assistant-ui/react`、`tailwindcss`、`@tailwindcss/postcss`
- **文件变更**: 新增 `postcss.config.js`、`src/index.css`、`assistant-ui-adapter.ts`；重写 `agent-chat.tsx`；修改 `main.tsx`（加 CSS import）
- **构建链**: init-repo 模板新增 PostCSS 处理步骤，每个新建 app 将包含 Tailwind
- **包体积**: 新增 assistant-ui（含 radix primitives）和 Tailwind 运行时，具体增量待构建验证
- **现有 app**: 不受影响（各自有 SDK 副本），仅新建 app 使用新版模板
