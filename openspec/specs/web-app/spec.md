# Web App

## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the web-app capability in LocalApp.
## Requirements

### Requirement: Next.js 应用骨架

`packages/web/` SHALL 包含一个基于 Next.js App Router 的应用。应用 SHALL 使用 Tailwind CSS v4 作为样式引擎，shadcn/ui 作为组件库。构建配置 SHALL 使用 `output: "export"` 生成静态文件。

#### Scenario: 开发服务器可启动
- **WHEN** 在 `packages/web/` 目录中运行 `npm run dev`
- **THEN** Next.js 开发服务器在 3001 端口启动
- **THEN** 修改页面文件后浏览器自动热重载

#### Scenario: 构建生成静态文件
- **WHEN** 在 `packages/web/` 目录中运行 `npm run build`
- **THEN** `packages/web/out/` 目录包含完整的静态站点
- **THEN** 每个页面生成对应的 `.html` 文件

### Requirement: 暗色模式

应用 SHALL 支持亮色和暗色两种主题。默认主题 SHALL 跟随系统 `prefers-color-scheme` 设置。用户 SHALL 可通过切换按钮手动切换主题。主题状态 SHALL 通过 `next-themes` 管理。

#### Scenario: 首次访问跟随系统
- **WHEN** 用户首次访问且系统设置为暗色模式
- **THEN** 页面以暗色主题渲染

#### Scenario: 手动切换主题
- **WHEN** 用户点击主题切换按钮
- **THEN** 页面立即切换到另一主题
- **THEN** 主题选择持久化到 localStorage

### Requirement: 登录页面

`/login` 路径 SHALL 渲染登录页面。页面 SHALL 包含用户名/邮箱输入框、密码输入框和登录按钮。表单提交 SHALL 调用 `POST /api/auth/login`。登录成功 SHALL 跳转到 `redirect` 查询参数指定的地址或 `/profile`。

#### Scenario: 登录成功
- **WHEN** 用户填写正确的用户名和密码并提交
- **THEN** 调用 `POST /api/auth/login` 成功
- **THEN** 页面跳转到 `redirect` 参数指定的地址

#### Scenario: 登录失败
- **WHEN** 用户填写错误的密码
- **THEN** 页面显示错误信息，不跳转
- **THEN** 表单保留用户已输入的用户名

#### Scenario: 已登录用户访问
- **WHEN** 已登录用户访问 `/login`
- **THEN** 自动跳转到 `/profile`

### Requirement: 强制改密页面

`/force-change-password` 路径 SHALL 渲染强制改密页面。页面 SHALL 包含用户名、当前密码、新密码、确认新密码输入框、提交按钮。表单提交 SHALL 调用 `POST /api/auth/force-change-password`。

#### Scenario: 改密成功
- **WHEN** 用户填写新密码和确认密码一致并提交
- **THEN** 调用 `POST /api/auth/force-change-password`
- **THEN** 成功后设置登录 cookie，并跳转到 `redirect` 查询参数指定的地址或 `/`

### Requirement: 首页按登录态原位渲染

`/` 路径 SHALL 返回同一 Web 首页入口。未登录用户 SHALL 看到公开首页与登录模态框入口；已登录用户 SHALL 看到工作台模块。两种状态都 SHALL 保持 `/`，不得重定向到 `/login?redirect=/` 或 `/profile`。

#### Scenario: 未登录用户访问首页
- **WHEN** 未登录用户访问 `/`
- **THEN** 返回 HTTP 200 并渲染公开首页
- **AND** 点击登录入口 SHALL 在当前页面打开登录模态框

#### Scenario: 已登录用户访问首页
- **WHEN** 已登录用户访问 `/`
- **THEN** 返回 HTTP 200 并渲染工作台首页

### Requirement: Fastify 静态托管

Fastify 服务器 SHALL 托管 Next.js 的静态导出产物。`/login`、`/force-change-password`、`/` 路由 SHALL 指向 Next.js 页面而非 serve.ts 的模板函数。Spa 风格的客户端路由 SHALL 通过 fallback 到 `index.html` 支持。

#### Scenario: 访问登录页面
- **WHEN** 浏览器请求 `/login`
- **THEN** 返回 `packages/web/out/login.html` 的内容

#### Scenario: API 路由不受影响
- **WHEN** 浏览器请求 `POST /api/auth/login`
- **THEN** 请求由 Fastify 路由处理，不被静态文件拦截

### Requirement: Next dev 代理不劫持 /serve 语义

`packages/web` 的 Next dev 配置 SHALL NOT 将 `/serve/:path*` 作为通用 rewrite 代理到 server。`/serve` 在平台 server 中代表裸应用资源路径，Next dev SHALL 使用不冲突的内部路径代理裸资源。

#### Scenario: /serve rewrite 不存在
- **WHEN** 检查 `packages/web/next.config.ts` 的 development rewrites
- **THEN** rewrites SHALL NOT 包含 `source: "/serve/:path*"`
- **AND** PlatformShell 模板路由 SHALL NOT 被 `/serve` 代理抢占

#### Scenario: 内部裸资源代理可用
- **WHEN** Next dev server 运行在 3001 端口，server 运行在 3000 端口
- **THEN** 请求 `GET /_localapp/raw/test-owner/team-workload/` SHALL 代理到 `http://localhost:3000/serve/test-owner/team-workload/`
- **AND** 返回已安装应用的裸 `index.html`

### Requirement: PlatformShell 根据环境解析裸应用资源 base

`PlatformShell` SHALL 在正式入口中使用 `/serve/{userId}/{name}/` 加载已安装应用资源；在 Next dev shell 预览中 SHALL 使用内部代理路径加载相同资源，避免跨 origin 和 `/serve` rewrite 冲突。

#### Scenario: 生产环境使用 /serve resource base
- **WHEN** 用户通过 server 正式入口 `/{userId}/{name}` 打开应用
- **THEN** PlatformShell SHALL fetch `/serve/{userId}/{name}/`
- **AND** 应用 CSS 和 JS asset SHALL 从 `/serve/{userId}/{name}/...` 加载

#### Scenario: Next dev 预览使用内部代理 resource base
- **WHEN** 平台开发者通过 `http://localhost:3001/platform-shell/{userId}/{name}` 打开 shell 预览
- **THEN** PlatformShell SHALL fetch `/_localapp/raw/{userId}/{name}/`
- **AND** 应用 CSS 和 JS asset SHALL 从 `/_localapp/raw/{userId}/{name}/...` 加载
- **AND** 浏览器 SHALL NOT 因 `/serve` 301/308 跳转进入重定向循环
