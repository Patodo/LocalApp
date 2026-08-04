## MODIFIED Requirements

### Requirement: Agent 生命周期管理

PlatformShell 组件 SHALL 在 native app 加载后创建 Agent 实例。Agent SHALL 使用 Shell 层的 `/api/llm/chat` 端点进行 LLM 通信。Agent SHALL 自动注册系统工具。系统工具 SHALL 仅包含 `getCurrentUser`，不得注册已废除的 `queryData` 或 `listSchemas` 通用数据探查工具。当 native app 发送 `localapp:register_tools` 消息时，SHALL 动态将应用注册的工具 schema 添加到 Agent 的工具列表。

#### Scenario: Agent 初始化
- **WHEN** PlatformShell 组件挂载
- **THEN** 创建 Agent 实例，注册系统工具 `getCurrentUser`
- **AND** SHALL NOT 注册 `queryData` 或 `listSchemas`
- **THEN** Agent 的 streamFn 指向 `/api/llm/chat`

#### Scenario: 动态添加应用工具
- **WHEN** Shell 收到 `{ type: "localapp:register_tools", tools: [...], systemHint: "..." }`
- **THEN** 将 tools 的 schema 添加到 Agent 的工具列表
- **THEN** 注册工具的 execute 为 same-page message 桥接代理
- **THEN** systemHint 合并到 Agent 的系统提示词中

#### Scenario: 工具执行桥接
- **WHEN** Agent 调用一个通过 register_tools 注册的工具
- **THEN** Shell 通过 same-page message 向 native app 发送 `{ type: "localapp:tool_call", callId, toolName, args }`
- **THEN** 等待 native app 返回 `{ type: "localapp:tool_result", callId, result }`
- **THEN** 将 result 传递给 Agent

## ADDED Requirements

### Requirement: PlatformShell 使用 raw resource base 加载应用

`PlatformShell` SHALL 在正式入口 `/{userId}/{name}` 内运行，并通过服务端注入或等价方式获得 raw app resource base。该 raw app resource base SHALL 指向 `/serve/{userId}/{name}/`，仅用于读取上传应用的 `index.html`、静态资源和应用级 API，不改变浏览器正式地址。

#### Scenario: 正式入口注入 raw resource base
- **WHEN** 用户访问 `/example-user/sample-app/`
- **THEN** `PlatformShell` SHALL 渲染平台 nav-shell 和 native app mount container
- **AND** 页面 SHALL 提供 `/serve/example-user/sample-app/` 作为 native app resource base
- **AND** 浏览器地址 SHALL 保持 `/example-user/sample-app/`

#### Scenario: raw resource base 不成为用户入口
- **WHEN** `PlatformShell` 从 `/serve/example-user/sample-app/` 读取应用 `index.html`
- **THEN** 该读取 SHALL 被视为内部资源加载
- **AND** UI 验证 SHALL 仍以 `/example-user/sample-app/` 为入口

### Requirement: Next dev shell 预览仅面向平台 Shell 开发

`packages/web` 的 Next dev shell 预览路径 SHALL 仅用于平台开发者调试 `PlatformShell` 组件热更新。应用开发者本地预览 SHALL 使用 `localapp dev` 注入的 DevShell；上传后的正式验证 SHALL 使用 server 上的 `/{userId}/{name}`。

#### Scenario: 平台开发者调试 Shell
- **WHEN** 平台开发者修改 `packages/web/components/shell/`
- **THEN** 可访问 `http://localhost:3001/platform-shell/{userId}/{name}` 查看 Shell 热更新
- **AND** 该路径 SHALL NOT 被 init-repo 或应用协作 skill 描述为应用开发者的默认验收入口

#### Scenario: 上传后正式验证
- **WHEN** 应用开发者上传应用后需要验证生产形态
- **THEN** 验证入口 SHALL 为 server 上的 `/{userId}/{name}`
- **AND** 不要求访问 `http://localhost:3001/serve/{userId}/{name}/`
