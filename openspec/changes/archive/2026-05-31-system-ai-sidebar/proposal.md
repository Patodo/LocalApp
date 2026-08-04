## Why

当前 AI 能力是应用内部的可选功能——开发者在 iframe 中通过 `useAgent` + `AgentChat` 自行构建对话 UI。这意味着每个应用都要重复实现聊天界面，且 AI 入口不可预测（不同应用的触发方式可能不同）。将 AI 升级为系统能力后，所有应用自动获得一致的 AI 对话入口（Shell 导航栏），开发者只需定义工具和行为，不再关心聊天 UI 的渲染。同时保留高阶自定义能力，允许应用完全接管 AI 交互。

## What Changes

- Platform Shell 导航栏新增 AI 侧边栏切换按钮（头像左侧）
- 新增浮动 AI 侧边栏组件，覆盖在 iframe 之上，不影响应用布局
- 侧边栏宽度可拖拽调整，宽度偏好通过浏览器 localStorage 持久化
- SDK 新增 `useRegisterTools` hook，应用通过 postMessage 向 Shell 注册工具
- Shell 层创建并管理 Agent 实例，通过 postMessage 与 iframe 通信执行工具
- 系统级行为配置（如自动执行工具）从系统侧提供，不侵入工具定义
- 保留现有 `useAgent` + `AgentChat` 模式作为高阶自定义模式（Mode B）

## Capabilities

### New Capabilities
- `system-ai-sidebar`: 系统级 AI 侧边栏，包含浮动面板、聊天 UI、工具调用可视化、可拖拽宽度持久化、与 iframe 的 postMessage 工具执行桥接

### Modified Capabilities
- `platform-shell`: 导航栏新增 AI toggle 按钮，PlatformShell 组件管理 Agent 生命周期和侧边栏状态
- `sdk-agent`: 新增 `useRegisterTools` hook 和 postMessage 协议层，`useAgent` 增加 `shellIntegration` 选项支持自定义模式声明

## Impact

- **packages/web**: PlatformShell 组件大幅扩展（Agent 管理、侧边栏渲染、postMessage 通信）
- **packages/sdk-agent**: 新增 `useRegisterTools` hook、postMessage 协议模块；`useAgent` 增加模式声明
- **packages/server**: 可能需要新增系统级 AI 配置端点（autoExecute 等参数）
- **API 兼容**: `UserToolDef` 类型不变，现有应用无需修改即可继续使用 Mode B
- **依赖**: Shell 层需要引入 `pi-agent-core` 和 assistant-ui（当前仅在 sdk-agent 中）
