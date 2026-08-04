## Purpose

系统级 AI 侧边栏组件，浮动覆盖在 native app 应用之上，提供统一的 AI 对话界面。包含聊天消息列表、工具调用可视化、Composer 输入框。宽度可拖拽调整并通过浏览器 localStorage 持久化。

## Requirements

### Requirement: AI 侧边栏浮动面板

侧边栏 SHALL 以绝对定位浮动在 native app 之上，不改变 native app 的尺寸。侧边栏 SHALL 固定在容器右侧，从顶部延伸到底部。默认宽度 SHALL 为 380px。

#### Scenario: 侧边栏展开时不影响 native app 布局
- **WHEN** 用户点击 AI 按钮展开侧边栏
- **THEN** native app 保持原始宽度和高度不变
- **THEN** 侧边栏覆盖在 native app 右侧区域之上

#### Scenario: 侧边栏收起
- **WHEN** 用户再次点击 AI 按钮收起侧边栏
- **THEN** 侧边栏隐藏
- **THEN** native app 保持不变

### Requirement: 宽度拖拽调整

侧边栏左侧边缘 SHALL 提供拖拽手柄。用户 SHALL 可通过拖拽调整侧边栏宽度。最小宽度 SHALL 为 280px，最大宽度 SHALL 为 600px。

#### Scenario: 拖拽调整宽度
- **WHEN** 用户在侧边栏左边缘按下鼠标并向左拖动
- **THEN** 侧边栏宽度增大（最大 600px）

#### Scenario: 拖拽缩小宽度
- **WHEN** 用户在侧边栏左边缘按下鼠标并向右拖动
- **THEN** 侧边栏宽度减小（最小 280px）

### Requirement: 宽度偏好持久化

侧边栏宽度 SHALL 在拖拽结束时保存到浏览器 localStorage。key SHALL 为 `localapp-ai-sidebar-width`。组件挂载时 SHALL 从 localStorage 读取宽度值并应用。

#### Scenario: 宽度持久化
- **WHEN** 用户拖拽侧边栏宽度到 450px 后释放鼠标
- **THEN** localStorage 中 `localapp-ai-sidebar-width` 值为 `450`

#### Scenario: 页面刷新恢复宽度
- **WHEN** 页面刷新且 localStorage 中 `localapp-ai-sidebar-width` 为 `"450"`
- **THEN** 侧边栏宽度恢复为 450px

#### Scenario: 首次使用无存储值
- **WHEN** localStorage 中无 `localapp-ai-sidebar-width`
- **THEN** 侧边栏使用默认宽度 380px

### Requirement: 聊天消息列表

侧边栏 SHALL 渲染 AI 对话的消息列表。消息列表 SHALL 包含用户消息（右对齐，蓝色气泡）和助手消息（左对齐，灰色气泡）。助手消息 SHALL 支持 Markdown 渲染。

#### Scenario: 显示用户消息
- **WHEN** 用户发送一条消息
- **THEN** 消息列表中显示用户消息，右对齐，蓝色气泡样式

#### Scenario: 显示助手消息
- **WHEN** 助手回复一条消息
- **THEN** 消息列表中显示助手消息，左对齐，灰色气泡样式，支持 Markdown 渲染

### Requirement: 工具调用可视化

消息列表中的工具调用 SHALL 以可折叠的卡片形式展示。默认折叠态 SHALL 显示一行摘要（图标 + 工具名 + 结果摘要）。展开态 SHALL 显示完整的入参 JSON 和返回值 JSON。

#### Scenario: 折叠态工具调用
- **WHEN** 工具调用已完成且有结果
- **THEN** 显示一行摘要：图标 + 工具名 + 结果摘要（首行，不超过 60 字符）

#### Scenario: 展开态工具调用
- **WHEN** 用户点击折叠态的工具调用
- **THEN** 展开显示完整入参和返回值 JSON

#### Scenario: 工具执行中
- **WHEN** 工具调用尚在执行中（无结果）
- **THEN** 显示图标 + 工具名 + 入参，自动展开

### Requirement: Composer 输入框

侧边栏底部 SHALL 提供 Composer 输入框。用户 SHALL 可输入文字并发送。发送按钮 SHALL 在有文字内容时可用。Agent 运行期间输入框 SHALL 显示禁用状态。

#### Scenario: 发送消息
- **WHEN** 用户在输入框输入文字并按 Enter 或点击发送按钮
- **THEN** 消息发送给 Agent 处理
- **THEN** 输入框清空

#### Scenario: Agent 运行中禁用输入
- **WHEN** Agent 正在处理消息（isRunning 为 true）
- **THEN** 输入框和发送按钮显示禁用状态

### Requirement: same-page message 工具执行桥接

侧边栏的 Agent SHALL 通过 same-page message 与 native app 通信执行工具。当 Agent 产生 tool_call 时，SHALL 向 native app 发送 `{ type: "localapp:tool_call", callId, toolName, args }`。native app 返回结果后，SHALL 将结果传递给 Agent 继续。

#### Scenario: 工具调用发送到 native app
- **WHEN** Agent 产生 tool_call（如 `fillForm`）
- **THEN** Shell 通过 same-page message 向 native app 发送 `{ type: "localapp:tool_call", callId: "c1", toolName: "fillForm", args: { field: "name", value: "张三" } }`

#### Scenario: 接收工具结果
- **WHEN** native app 返回 `{ type: "localapp:tool_result", callId: "c1", result: "已填写 name" }`
- **THEN** Agent 收到结果并继续对话

#### Scenario: 工具执行超时
- **WHEN** 工具调用在 30 秒内未收到 native app 的结果响应
- **THEN** Agent 将该工具调用标记为错误，告知用户工具执行超时

### Requirement: 系统工具直接执行

系统工具（`getCurrentUser`、`queryData`、`listSchemas`）SHALL 在 Shell 层直接执行，不通过 same-page message 转发到 native app。

#### Scenario: 系统工具在 Shell 层执行
- **WHEN** Agent 调用 `getCurrentUser` 工具
- **THEN** Shell 直接调用 `/api/me` API
- **THEN** 结果直接返回给 Agent，不涉及 native app 通信
