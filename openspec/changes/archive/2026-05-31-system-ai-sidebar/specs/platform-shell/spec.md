## ADDED Requirements

### Requirement: AI toggle 按钮

导航栏右侧 SHALL 在收藏按钮和头像之间显示 AI 切换按钮（Sparkles 图标）。点击 SHALL 切换 AI 侧边栏的展开/收起状态。按钮 SHALL 仅在应用注册了工具（Mode A）或声明了自定义模式（Mode B）时显示。

#### Scenario: 显示 AI 按钮（Mode A）
- **WHEN** Shell 收到 iframe 的 `localapp:register_tools` 消息
- **THEN** 导航栏显示 AI 切换按钮（Sparkles 图标）

#### Scenario: 显示 AI 按钮（Mode B）
- **WHEN** Shell 收到 iframe 的 `localapp:ai_custom_mode` 消息
- **THEN** 导航栏显示 AI 切换按钮

#### Scenario: 未注册工具时隐藏 AI 按钮
- **WHEN** iframe 加载完成后 Shell 未收到任何 AI 模式声明
- **THEN** 导航栏不显示 AI 按钮

#### Scenario: 点击切换侧边栏
- **WHEN** 用户点击 AI 按钮
- **THEN** 侧边栏在展开和收起状态之间切换

### Requirement: Agent 生命周期管理

PlatformShell 组件 SHALL 在 iframe 加载后创建 Agent 实例。Agent SHALL 使用 Shell 层的 `/api/llm/chat` 端点进行 LLM 通信。Agent SHALL 自动注册系统工具。当 iframe 发送 `localapp:register_tools` 消息时，SHALL 动态将注册的工具 schema 添加到 Agent 的工具列表。

#### Scenario: Agent 初始化
- **WHEN** PlatformShell 组件挂载
- **THEN** 创建 Agent 实例，注册系统工具（getCurrentUser, queryData, listSchemas）
- **THEN** Agent 的 streamFn 指向 `/api/llm/chat`

#### Scenario: 动态添加应用工具
- **WHEN** Shell 收到 `{ type: "localapp:register_tools", tools: [...], systemHint: "..." }`
- **THEN** 将 tools 的 schema 添加到 Agent 的工具列表
- **THEN** 注册工具的 execute 为 postMessage 桥接代理
- **THEN** systemHint 合并到 Agent 的系统提示词中

#### Scenario: 工具执行桥接
- **WHEN** Agent 调用一个通过 register_tools 注册的工具
- **THEN** Shell 通过 postMessage 向 iframe 发送 `{ type: "localapp:tool_call", callId, toolName, args }`
- **THEN** 等待 iframe 返回 `{ type: "localapp:tool_result", callId, result }`
- **THEN** 将 result 传递给 Agent

### Requirement: Mode B 自定义模式转发

当 Shell 检测到 Mode B（收到 `localapp:ai_custom_mode` 消息）时，SHALL 不创建系统侧边栏。点击 AI 按钮 SHALL 向 iframe 发送 `{ type: "localapp:toggle_chat" }` 消息。

#### Scenario: Mode B 点击 AI 按钮
- **WHEN** 应用声明了自定义模式且用户点击 AI 按钮
- **THEN** Shell 向 iframe 发送 `{ type: "localapp:toggle_chat" }`
- **THEN** 不展示系统侧边栏

## MODIFIED Requirements

### Requirement: PlatformShell 组件

`PlatformShell` React 组件 SHALL 渲染应用的 iframe 外壳：顶部导航栏 + 全屏 iframe + Issue 模态框 + AI 侧边栏。组件 SHALL 从 URL params 获取 `userId` 和 `name`，从 `/api/me` 获取当前用户信息。组件 SHALL 监听 iframe 的 postMessage 以检测 AI 模式和接收工具注册。

#### Scenario: 渲染平台外壳
- **WHEN** 访问 `/:userId/:name`
- **THEN** 显示顶部导航栏（包含应用名、Issue 按钮）
- **THEN** 显示全屏 iframe 加载用户应用
- **THEN** iframe 的 `src` 属性指向 `/serve/:userId/:name/`

#### Scenario: 已登录用户看到完整导航栏
- **WHEN** 已登录用户访问平台外壳
- **THEN** 导航栏右侧显示收藏按钮、AI 按钮（条件性显示）和头像
- **THEN** 点击头像跳转回主页

#### Scenario: 未登录用户看到登录按钮
- **WHEN** 未登录用户访问平台外壳
- **THEN** 导航栏右侧显示登录按钮
- **THEN** 点击登录跳转到 `/login?redirect=...`

#### Scenario: 监听 iframe AI 模式
- **WHEN** iframe 发送 postMessage
- **THEN** Shell 根据消息类型设置 AI 模式（Mode A 或 Mode B）
- **THEN** 收到工具注册时动态更新 Agent 配置

#### Scenario: shell navbar 禁用时重定向
- **WHEN** 应用的 shell 配置中 `navbar === false`
- **THEN** 页面重定向到 `/serve/:userId/:name/`（无壳直接访问）
