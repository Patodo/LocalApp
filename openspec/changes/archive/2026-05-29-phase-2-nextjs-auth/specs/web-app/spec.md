## ADDED Requirements

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

`/login` 路径 SHALL 渲染登录页面。页面 SHALL 包含用户名/邮箱输入框、密码输入框、登录按钮、注册链接。表单提交 SHALL 调用 `POST /api/auth/login`。登录成功 SHALL 跳转到 `redirect` 查询参数指定的地址或 `/profile`。

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

### Requirement: 注册页面

`/register` 路径 SHALL 渲染注册页面。页面 SHALL 包含用户名、密码、确认密码输入框、注册按钮、登录链接。表单提交 SHALL 调用 `POST /api/auth/register`。注册成功 SHALL 自动登录并跳转。

#### Scenario: 注册成功
- **WHEN** 用户填写有效的用户名、密码和确认密码
- **THEN** 调用 `POST /api/auth/register`
- **THEN** 注册成功后自动跳转到 `/profile`

#### Scenario: 密码不匹配
- **WHEN** 用户填写的密码和确认密码不一致
- **THEN** 在提交前显示客户端验证错误

### Requirement: 强制改密页面

`/force-change-password` 路径 SHALL 渲染强制改密页面。页面 SHALL 包含新密码、确认新密码输入框、提交按钮。表单提交 SHALL 调用 `POST /api/auth/change-password`。

#### Scenario: 改密成功
- **WHEN** 用户填写新密码和确认密码一致并提交
- **THEN** 调用 `POST /api/auth/change-password`
- **THEN** 成功后跳转到 `/profile`

### Requirement: 首页重定向

`/` 路径 SHALL 根据登录状态重定向：已登录用户重定向到 `/profile`，未登录用户重定向到 `/login?redirect=/`。

#### Scenario: 未登录用户访问首页
- **WHEN** 未登录用户访问 `/`
- **THEN** 重定向到 `/login?redirect=/`

#### Scenario: 已登录用户访问首页
- **WHEN** 已登录用户访问 `/`
- **THEN** 重定向到 `/profile`

### Requirement: Fastify 静态托管

Fastify 服务器 SHALL 托管 Next.js 的静态导出产物。`/login`、`/register`、`/force-change-password`、`/` 路由 SHALL 指向 Next.js 页面而非 serve.ts 的模板函数。Spa 风格的客户端路由 SHALL 通过 fallback 到 `index.html` 支持。

#### Scenario: 访问登录页面
- **WHEN** 浏览器请求 `/login`
- **THEN** 返回 `packages/web/out/login.html` 的内容

#### Scenario: API 路由不受影响
- **WHEN** 浏览器请求 `POST /api/auth/login`
- **THEN** 请求由 Fastify 路由处理，不被静态文件拦截
