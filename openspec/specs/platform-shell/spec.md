## Purpose

Platform Shell 是基于 React 的客户端组件体系，替代 `serve.ts` 中约 200 行的服务器端 HTML 模板函数（`buildPlatformShell` 等）。它负责渲染用户应用的 native app 外壳：顶部导航栏 + 全屏 native app + Issue 管理模态框 + AI 侧边栏。认证状态由 Next.js 客户端管理（cookie 共享），使 `serve.ts` 退化为纯 API + 静态文件服务。
## Requirements
### Requirement: AI toggle 按钮

导航栏右侧 SHALL 在收藏按钮和头像之间显示 AI 切换按钮（Sparkles 图标）。点击 SHALL 切换 AI 侧边栏的展开/收起状态。按钮 SHALL 仅在应用注册了工具（Mode A）或声明了自定义模式（Mode B）时显示。

#### Scenario: 显示 AI 按钮（Mode A）
- **WHEN** Shell 收到 native app 的 `localapp:register_tools` 消息
- **THEN** 导航栏显示 AI 切换按钮（Sparkles 图标）

#### Scenario: 显示 AI 按钮（Mode B）
- **WHEN** Shell 收到 native app 的 `localapp:ai_custom_mode` 消息
- **THEN** 导航栏显示 AI 切换按钮

#### Scenario: 未注册工具时隐藏 AI 按钮
- **WHEN** native app 加载完成后 Shell 未收到任何 AI 模式声明
- **THEN** 导航栏不显示 AI 按钮

#### Scenario: 点击切换侧边栏
- **WHEN** 用户点击 AI 按钮
- **THEN** 侧边栏在展开和收起状态之间切换

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

### Requirement: Navbar 组件

导航栏 SHALL 分为左右两个区域。左侧 SHALL 包含 Home 按钮（House 图标，链接到 `/`）、应用名称和 Issue 按钮。右侧 SHALL 包含收藏按钮（星标图标 + 收藏数量）、头像（已登录时）或登录按钮（未登录时）。未登录时点击登录按钮 SHALL 弹出全局 LoginDialog 模态框，不再跳转到 `/login` 页面。导航栏 SHALL NOT 显示注册按钮。

#### Scenario: Home 按钮可见且功能正常
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏最左侧显示 House 图标按钮
- **THEN** 点击 Home 按钮跳转到 `/`

#### Scenario: Home 按钮不影响其他元素
- **WHEN** 应用名称较长
- **THEN** Home 按钮仍然可见，应用名称截断显示

#### Scenario: Issue 按钮可见
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏左侧显示 CircleDot 图标按钮（在 Home 按钮和应用名称之后）
- **THEN** 点击打开 Issue 模态框

#### Scenario: 收藏按钮显示星标数量
- **WHEN** 平台外壳渲染完成
- **THEN** 导航栏右侧显示星标图标 + 收藏数量
- **THEN** 点击收藏按钮切换收藏状态

#### Scenario: 未登录用户点击登录弹出模态框
- **WHEN** 未登录用户点击导航栏登录按钮
- **THEN** 弹出 LoginDialog 模态框（而非跳转到 `/login` 页面）

#### Scenario: 导航栏不显示注册按钮
- **WHEN** 未登录用户查看导航栏
- **THEN** 导航栏仅显示登录按钮，不显示注册按钮

### Requirement: Shell 🔔 订阅按钮（条件渲染 + 状态机）

Platform Shell 导航栏 SHALL 在 `manifest.notify.enabled === true` 时渲染 🔔 订阅按钮。按钮 SHALL 根据用户认证状态和订阅状态展示 4 种不同的 UI。

按钮位置：导航栏右侧，与 ★ 收藏按钮同级。

#### Scenario: notify.enabled = false 时不渲染

- **WHEN** 当前 app 的 `manifest.notify.enabled` 为 false 或缺省
- **THEN** 导航栏不显示 🔔 按钮

#### Scenario: 用户未登录

- **WHEN** `manifest.notify.enabled = true`，当前访客未登录
- **THEN** 显示 🔔 按钮，文案为"登录后订阅"，点击弹出登录模态框

#### Scenario: 用户已登录、未订阅

- **WHEN** `manifest.notify.enabled = true`，当前用户已登录但未订阅该 app
- **THEN** 显示 🔔 按钮，展开菜单含三个等级选项（All / Important / Muted）+ 订阅确认按钮

#### Scenario: 用户已订阅

- **WHEN** `manifest.notify.enabled = true`，当前用户已订阅该 app（如 level=all）
- **THEN** 显示 🔔 按钮，文案为"已订阅 (All)"，展开菜单含等级切换选项 + 退订按钮

#### Scenario: 点击等级切换

- **WHEN** 用户展开订阅菜单并选择不同等级（如从 All 切到 Important）
- **THEN** 调用 `POST /api/subscriptions` 更新等级，按钮文案同步更新

#### Scenario: 点击退订

- **WHEN** 用户展开订阅菜单并点击"退订"
- **THEN** 调用 `DELETE /api/subscriptions/:owner/:name`，按钮回复到"未订阅"状态

### Requirement: 导航栏未读通知徽标

当 `manifest.notify.enabled = true` 且用户已登录时，Platform Shell SHALL 调用 `GET /api/inbox/unread-count` 获取未读数。若 `count > 0`，在 🔔 按钮上显示红色徽标。

#### Scenario: 有未读通知

- **WHEN** `GET /api/inbox/unread-count` 返回 `{ count: 3 }`
- **THEN** 🔔 按钮上显示红色圆点 + 数字 3

#### Scenario: 无未读通知

- **WHEN** `GET /api/inbox/unread-count` 返回 `{ count: 0 }`
- **THEN** 🔔 按钮上无徽标

#### Scenario: 查询失败

- **WHEN** `GET /api/inbox/unread-count` 网络错误
- **THEN** 静默降级：不显示徽标，不阻塞页面渲染

### Requirement: IssuesModal 组件

`IssuesModal` SHALL 提供 Issue 的完整管理界面。SHALL 包含列表视图（按状态/标签筛选）和创建表单（title + description + label）。创建 Issue 和关闭 Issue 的权限验证 SHALL 和当前 API 一致。

#### Scenario: 查看 Issue 列表
- **WHEN** 点击 Issue 按钮
- **THEN** 显示模态框 + Issue 列表
- **THEN** 可按状态（open/closed）和标签（bug/feature）筛选

#### Scenario: 创建新 Issue
- **WHEN** 已登录用户点击 New Issue 按钮
- **THEN** 切换到创建表单
- **THEN** 填写 title、description、选择 label（bug/feature）
- **THEN** 提交后 Issue 出现在列表中

#### Scenario: 关闭 Issue
- **WHEN** Issue 的创建者或应用所有者点击关闭按钮
- **THEN** Issue 状态变为 closed
- **THEN** 关闭按钮变为重新打开按钮

#### Scenario: 未登录用户只能查看
- **WHEN** 未登录用户打开 Issue 模态框
- **THEN** 可查看 Issue 列表
- **THEN** 不显示创建 Issue 按钮

### Requirement: serve.ts 精简

`serve.ts` 文件 SHALL 移除所有 HTML 模板函数（`buildPlatformShell`、`buildLoginPage`、`buildRegisterPage`、`buildForceChangePasswordPage`）。文件 SHALL 只保留 API 路由（CRUD、文件上传）和静态文件服务。

#### Scenario: serve.ts 仅包含 API 逻辑
- **WHEN** 检查 `serve.ts` 文件
- **THEN** 无 HTML 模板字符串函数
- **THEN** CRUD API 和静态文件路由正常工作

### Requirement: PlatformShell 作为 native 应用宿主
`PlatformShell` SHALL 渲染平台 nav-shell、平台能力 host 和 native app mount container。应用 SHALL 在该 container 内运行，平台 shell SHALL NOT 使用 iframe 作为默认承载方式。

#### Scenario: 渲染 native shell
- **WHEN** 用户访问生产应用页面
- **THEN** `PlatformShell` SHALL 显示应用名称、Issue 入口、AI 入口和用户入口
- **AND** `PlatformShell` SHALL 显示 native app mount container
- **AND** `PlatformShell` SHALL NOT 渲染应用 iframe

### Requirement: PlatformShell 使用 raw resource base 加载应用

`PlatformShell` SHALL 在正式入口 `/{userId}/{name}` 内运行，并通过服务端注入或等价方式获得 raw app resource base。该 raw app resource base SHALL 指向 `/serve/{userId}/{name}/`，仅用于读取已安装应用的 `index.html`、静态资源和应用级 API，不改变浏览器正式地址。

#### Scenario: 正式入口注入 raw resource base
- **WHEN** 用户访问 `/test-owner/team-workload/`
- **THEN** `PlatformShell` SHALL 渲染平台 nav-shell 和 native app mount container
- **AND** 页面 SHALL 提供 `/serve/test-owner/team-workload/` 作为 native app resource base
- **AND** 浏览器地址 SHALL 保持 `/test-owner/team-workload/`

#### Scenario: raw resource base 不成为用户入口
- **WHEN** `PlatformShell` 从 `/serve/test-owner/team-workload/` 读取应用 `index.html`
- **THEN** 该读取 SHALL 被视为内部资源加载
- **AND** UI 验证 SHALL 仍以 `/test-owner/team-workload/` 为入口

### Requirement: PlatformShell 提供同页能力响应
`PlatformShell` SHALL 在同页处理 SDK 平台能力请求，包括 `getCurrentUser`、`getServerTime`、`copyText`、`downloadFile`、`confirm`、`openRoute` 和 `ai.*`。

#### Scenario: 同页确认弹窗
- **WHEN** native 应用请求 `confirm`
- **THEN** `PlatformShell` SHALL 展示平台确认弹窗
- **AND** 用户选择结果 SHALL 返回给应用 SDK

#### Scenario: 同页 AI 切换
- **WHEN** native 应用请求 `ai.open`
- **THEN** `PlatformShell` SHALL 打开平台 AI 侧栏

### Requirement: PlatformShell 模板路由独立于裸应用资源路径

`packages/web` SHALL 使用独立的 PlatformShell 模板路由导出生产 shell HTML。该模板路由 SHALL NOT 使用 `/serve/[userId]/[name]`，因为 `/serve` 在平台中保留给已安装应用的裸资源服务。推荐模板路由为 `/platform-shell/[userId]/[name]`。

#### Scenario: 静态导出生成独立 shell 模板
- **WHEN** 在 `packages/web` 中运行生产构建
- **THEN** 静态导出目录 SHALL 包含 `platform-shell/placeholder/placeholder.html`
- **AND** 该 HTML SHALL 渲染 `PlatformShell`
- **AND** server 正式入口 SHALL NOT 依赖 `serve/placeholder/placeholder.html` 作为 shell 模板

#### Scenario: 模板路径不改变正式入口
- **WHEN** 用户访问 `/{userId}/{name}`
- **THEN** 服务端 SHALL 返回 PlatformShell HTML
- **AND** 浏览器地址 SHALL 保持 `/{userId}/{name}`
- **AND** 用户 SHALL NOT 需要访问 `/platform-shell/{userId}/{name}` 才能使用正式应用

### Requirement: Next dev shell 预览仅面向平台 Shell 开发

`packages/web` 的 Next dev shell 预览路径 SHALL 仅用于平台开发者调试 `PlatformShell` 组件热更新。应用开发者本地预览 SHALL 使用 `localapp dev` 注入的 DevShell；安装后的正式验证 SHALL 使用 Server 上的 `/{userId}/{name}`。

#### Scenario: 平台开发者调试 Shell
- **WHEN** 平台开发者修改 `packages/web/components/shell/`
- **THEN** 可访问 `http://localhost:3001/platform-shell/{userId}/{name}` 查看 Shell 热更新
- **AND** 该路径 SHALL NOT 被 init-repo 或应用协作 skill 描述为应用开发者的默认验收入口

#### Scenario: 安装后正式验证
- **WHEN** 应用开发者安装应用后需要验证正式形态
- **THEN** 验证入口 SHALL 为 server 上的 `/{userId}/{name}`
- **AND** 不要求访问 `http://localhost:3001/serve/{userId}/{name}/`

### Requirement: 应用开发 DevShell 保持生产隔离

应用开发者的 DevShell SHALL 继续只存在于 `localapp dev` / Vite dev 模式。PlatformShell 模板路由迁移 SHALL NOT 将 DevShell 的 `DEV` 按钮、开发工具、`/api/dev/*` 或 dev event 引入 `packages/web` 的生产 shell。

#### Scenario: 生产 shell 不包含 DevShell 标识
- **WHEN** 在 `packages/web` 中运行生产构建
- **THEN** PlatformShell 导出的 HTML 和客户端 bundle SHALL NOT 包含 `Dev Toolkit`
- **AND** SHALL NOT 包含 `/api/dev/context`
- **AND** SHALL NOT 包含 `localapp:dev-context-changed`
