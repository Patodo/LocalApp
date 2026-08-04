## Purpose

页面访问与静态文件服务。通过 native app 包装提供页面预览，通过 /serve 路径提供静态文件服务，支持 SPA fallback 和安全头设置。
## Requirements
### Requirement: 静态文件服务

`GET /serve/{userId}/{name}/*` SHALL 从最新版本目录提供文件，并设置 CSP 头。

#### Scenario: 请求存在的静态文件
- **WHEN** 请求 `GET /serve/user1/my-cool-app/assets/style.css`
- **THEN** 返回文件内容，设置正确的 MIME 类型和 CSP 头

#### Scenario: 请求 index.html
- **WHEN** 请求 `GET /serve/user1/my-cool-app/` 或 `GET /serve/user1/my-cool-app/index.html`
- **THEN** 返回最新版本的 `index.html`

### Requirement: SPA Fallback

当请求的路径没有对应文件时，SHALL 返回 `index.html`，以支持 SPA 客户端路由。

#### Scenario: SPA 子路由
- **WHEN** 请求 `GET /serve/user1/my-cool-app/about`，但文件系统中不存在 `about` 文件
- **THEN** 返回 `index.html`，由前端路由处理

#### Scenario: 静态资源不受影响
- **WHEN** 请求 `GET /serve/user1/my-cool-app/assets/app.js`，文件存在
- **THEN** 返回 `app.js` 文件本身，不 fallback

### Requirement: 安全头设置

页面服务 MUST 设置以下安全头：

#### Scenario: CSP 头
- **WHEN** 返回任何页面内容
- **THEN** 设置 `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`

### Requirement: 静态文件服务端到端验证

测试 SHALL 验证通过 CLI 上传的文件能被正确服务。

#### Scenario: 请求 index.html（无尾部路径）
- **WHEN** 通过 CLI 上传 `index.html` 后，请求 `GET /serve/{userId}/{name}`
- **THEN** 返回 `index.html` 内容，MIME 类型为 `text/html`

#### Scenario: 请求 index.html（带尾部斜杠）
- **WHEN** 请求 `GET /serve/{userId}/{name}/`
- **THEN** 返回 `index.html` 内容

#### Scenario: 请求子目录中的静态文件
- **WHEN** 通过 CLI 上传 `assets/style.css` 后，请求 `GET /serve/{userId}/{name}/assets/style.css`
- **THEN** 返回 CSS 文件内容，MIME 类型为 `text/css`

#### Scenario: 请求不存在的文件
- **WHEN** 请求 `GET /serve/{userId}/{name}/nonexistent.js`
- **THEN** 返回 HTTP 404

### Requirement: SPA Fallback 端到端验证

e2e 测试 SHALL 验证 SPA fallback 在无扩展名路径时返回 index.html。

#### Scenario: SPA 子路由回退到 index.html
- **WHEN** 请求 `GET /serve/{userId}/{name}/about`，文件系统中无 `about` 文件
- **THEN** 返回 `index.html` 内容（无扩展名的路径触发 SPA fallback）

#### Scenario: 有扩展名的缺失文件不触发 fallback
- **WHEN** 请求 `GET /serve/{userId}/{name}/missing.js`
- **THEN** 返回 HTTP 404（有扩展名说明是明确的资源请求，不 fallback）

### Requirement: 安全头端到端验证

e2e 测试 SHALL 验证所有页面响应包含正确的 CSP 安全头。

#### Scenario: CSP 头设置
- **WHEN** 请求任何页面内容（`/serve/{userId}/{name}/`）
- **THEN** 响应头包含 `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'`

### Requirement: 用户页面导航栏

系统在用户页面的平台 Shell 导航栏中 SHALL 展示当前用户的头像（如有）和名称，并提供跳转到 `/profile` 的链接。

#### Scenario: 已登录用户有头像
- **WHEN** 已登录用户访问 `/{userId}/{pageName}`，且用户有头像
- **THEN** 导航栏右侧显示头像图片和用户名，点击可跳转 `/profile`

#### Scenario: 已登录用户无头像
- **WHEN** 已登录用户访问 `/{userId}/{pageName}`，且用户没有头像
- **THEN** 导航栏右侧显示用户名首字母占位头像和用户名，点击可跳转 `/profile`

#### Scenario: 未登录用户
- **WHEN** 未登录用户访问 `/{userId}/{pageName}`
- **THEN** 导航栏右侧仅显示登录入口
- **AND** 不显示公开注册入口

### Requirement: 路由优先级处理
`/admin` 路径 SHALL 不被 `/:userId/:name` 动态路由捕获。

#### Scenario: /admin 不匹配用户页面路由
- **WHEN** 请求 `GET /admin` 或 `GET /admin/*`
- **THEN** 由 admin-serve 路由处理，不进入 `/:userId/:name` 的 Shell 渲染逻辑

### Requirement: 根路径重定向

`GET /` SHALL 根据用户登录状态执行重定向。已登录用户（session cookie 有效）SHALL 重定向到 `/profile`。未登录用户 SHALL 重定向到 `/login?redirect=/`。

#### Scenario: 已登录用户访问根路径
- **WHEN** 携带有效 session cookie 请求 `GET /`
- **THEN** 返回 HTTP 302，Location 为 `/profile`

#### Scenario: 未登录用户访问根路径
- **WHEN** 不携带 session cookie 请求 `GET /`
- **THEN** 返回 HTTP 302，Location 为 `/login?redirect=/`

#### Scenario: 登录后通过 fallback 回到根路径
- **WHEN** 用户在 `/login` 页面登录成功，无 redirect 参数，JS fallback 到 `/`
- **THEN** `/` 重定向到 `/profile`，用户最终看到个人主页

### Requirement: 生产页面 native 渲染
平台定义的生产应用入口 `GET /{userId}/{name}` 和 `GET /{userId}/{name}/` SHALL 返回 native 平台 shell 页面。该页面 SHALL 加载最新版本应用资源并在 app container 中挂载应用。

#### Scenario: 访问已存在应用
- **WHEN** 用户访问已存在应用的生产入口
- **THEN** 服务端 SHALL 返回平台 shell HTML 或对应 shell route
- **AND** 响应 SHALL 指向最新版本应用资源
- **AND** 响应 SHALL NOT 包含应用 iframe wrapper

### Requirement: 应用静态资源服务保留
服务端 SHALL 继续从最新版本目录提供应用 JS、CSS、图片和其他静态资源，并保持 SPA fallback 与明确资源 404 规则。

#### Scenario: 请求应用资源
- **WHEN** 浏览器请求最新版本的应用 asset
- **THEN** 服务端 SHALL 返回对应文件内容和正确 MIME 类型

#### Scenario: 缺失资源不 fallback
- **WHEN** 请求带扩展名但不存在的资源
- **THEN** 服务端 SHALL 返回 HTTP 404

### Requirement: 正式入口和裸资源入口职责分离

服务端 SHALL 明确区分正式应用入口与裸应用资源入口。`GET /{userId}/{name}` 和 `GET /{userId}/{name}/` SHALL 返回带 PlatformShell 的正式应用页面，并作为用户访问、应用验收和 UI 级验证的默认入口。`GET /serve/{userId}/{name}/` 和 `GET /serve/{userId}/{name}/*` SHALL 只返回上传应用的裸 `index.html`、assets、SPA fallback 或应用 API 响应；该路径 SHALL 被视为内部 raw app resource/API route，不得在用户文档、CLI 默认输出或 agent 验收步骤中称为预览入口。

#### Scenario: 正式入口返回 PlatformShell
- **WHEN** 已存在应用 `test-owner/team-workload`，用户请求 `GET /test-owner/team-workload/`
- **THEN** 响应 SHALL 为 HTML
- **AND** 响应 SHALL 包含 PlatformShell 的 native shell 标识或 mount container
- **AND** 响应 SHALL 使用 `/serve/test-owner/team-workload/` 作为 native app resource base

#### Scenario: 用户验收访问正式入口
- **WHEN** agent 或测试人员需要验证 `test-owner/team-workload` 的用户可见功能
- **THEN** 验证入口 SHALL 为 `/test-owner/team-workload/`
- **AND** 测试 SHALL 覆盖平台 nav-shell 与 native app container 的组合运行形态
- **AND** SHALL NOT 使用 `/serve/test-owner/team-workload/` 作为默认验收入口

#### Scenario: 裸资源入口不返回 nav-shell
- **WHEN** 已存在应用 `test-owner/team-workload`，用户请求 `GET /serve/test-owner/team-workload/`
- **THEN** 响应 SHALL 为上传应用最新版本的 `index.html`
- **AND** 响应 SHALL NOT 包含 PlatformShell 导航栏
- **AND** 响应 SHALL NOT 包含 native shell 标识

#### Scenario: /serve 无尾路径仍只规范化裸资源入口
- **WHEN** 用户请求 `GET /serve/test-owner/team-workload`
- **THEN** 服务端 MAY 重定向到 `/serve/test-owner/team-workload/`
- **AND** 重定向目标 SHALL 仍为裸资源入口
- **AND** SHALL NOT 跳转到 PlatformShell 模板路由

### Requirement: raw route 仅用于资源和应用 API 验证

测试或文档直接访问 `/serve/{userId}/{name}/` 时，目标 SHALL 限定为 raw resource、SPA fallback、静态资源安全头、MIME、或 `/serve/{userId}/{name}/api/*` 应用级 API 契约，不得用于判断平台 Shell、导航栏、Issue、AI 侧栏、登录入口或收藏等用户体验功能。

#### Scenario: raw route 测试资源服务
- **WHEN** 测试请求 `GET /serve/test-owner/team-workload/assets/app.js`
- **THEN** 测试 SHALL 断言静态资源服务行为
- **AND** 测试 SHALL NOT 断言平台 nav-shell 行为

#### Scenario: shell 能力测试不访问 raw route
- **WHEN** 测试需要验证 Issue 入口、AI 侧栏或用户头像
- **THEN** 测试 SHALL 访问 `/test-owner/team-workload/`
- **AND** 测试 SHALL NOT 访问 `/serve/test-owner/team-workload/`

### Requirement: server shell 模板读取使用独立导出路径

服务端在处理正式入口时 SHALL 从独立 PlatformShell 静态导出路径读取 shell 模板，不得从 `/serve` 静态导出路径读取 shell 模板。

#### Scenario: shell 模板缺失时返回明确错误
- **WHEN** `web/out/platform-shell/placeholder/placeholder.html` 不存在
- **AND** 用户请求 `GET /test-owner/team-workload/`
- **THEN** 服务端 SHALL 返回 404 或明确错误
- **AND** 错误信息 SHALL 指向 shell 未构建或需要构建 web

#### Scenario: 模板参数注入正确
- **WHEN** 用户请求 `GET /test-owner/team-workload/`
- **THEN** 服务端 SHALL 将 placeholder 参数替换为 `test-owner` 和 `team-workload`
- **AND** 返回 HTML 中的 native app resource base SHALL 为 `/serve/test-owner/team-workload/`
