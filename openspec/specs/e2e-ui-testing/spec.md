## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the e2e-ui-testing capability in LocalApp.

## Requirements

### Requirement: Playwright 测试基础设施

项目 SHALL 提供 Playwright 配置和测试脚手架，支持启动真实 server 后在浏览器中执行 UI 自动化测试。测试用 fastify server MUST 服务 Next.js 静态导出的所有资源，包括 `/my/*` 路径下的 HTML 文件和 `/_next/static/*` 下的 JS/CSS chunks——缺少后者会导致 React 无法 hydration，所有依赖 DOM 内容的测试都会失败。

#### Scenario: Playwright 配置存在
- **WHEN** 查看 `playwright.config.ts`
- **THEN** 配置了 Chromium 浏览器、baseURL、测试目录指向 `packages/server/tests/e2e-ui/`

#### Scenario: 测试 helper 可用
- **WHEN** 编写 UI 测试用例
- **THEN** 可通过 helper 启动真实 server、获取 baseUrl、供应测试用户并执行登录操作获取 session

#### Scenario: CI 可运行
- **WHEN** 执行 `npx playwright test`
- **THEN** 自动启动 Chromium、运行所有 UI 测试、输出报告

#### Scenario: 测试 server 服务 Next.js 静态资源
- **WHEN** 浏览器加载 `/my/users.html` 并请求页面中引用的 `/_next/static/chunks/*.js`
- **THEN** 测试 server 返回 200 和对应 JS 内容（MIME 类型为 `application/javascript` 或 `text/javascript`），使 React 能够完成 hydration

#### Scenario: 测试 server 服务 Next.js 样式资源
- **WHEN** 浏览器请求页面中引用的 `/_next/static/css/*.css`
- **THEN** 测试 server 返回 200 和对应 CSS 内容（MIME 类型为 `text/css`）

### Requirement: Profile SPA UI 测试

系统 SHALL 包含 Profile 页面（当前路径 `/my/info`，由 Next.js web 包提供）的 Playwright UI 自动化测试。

#### Scenario: 登录后访问 Profile 页面
- **WHEN** 已登录用户导航到 `/my/info`
- **THEN** 页面正确显示当前用户的用户名、角色、昵称、简介

#### Scenario: 编辑昵称和简介
- **WHEN** 用户在 Profile 页面修改昵称和简介并点击保存
- **THEN** 页面显示成功提示，刷新后新值保留

#### Scenario: 上传头像
- **WHEN** 用户选择一张有效的 JPG 图片上传
- **THEN** 页面头像区域更新为新图片

#### Scenario: 修改密码
- **WHEN** 用户填写正确的当前密码和新密码后提交
- **THEN** 页面显示成功提示

#### Scenario: 未登录访问重定向
- **WHEN** 未登录用户导航到 `/my/info`
- **THEN** my-serve.ts 重定向到首页 `/`（非 admin 用户访问 admin 页面同理）

### Requirement: 登录页面 UI 测试

系统 SHALL 包含登录页面的 Playwright UI 自动化测试。用户创建流程由管理员供应场景覆盖。

#### Scenario: 登录成功
- **WHEN** 用户在登录页面填写正确的用户名和密码后提交
- **THEN** 登录成功，跳转到之前的页面

#### Scenario: 登录失败显示错误
- **WHEN** 用户在登录页面填写错误的密码后提交
- **THEN** 页面显示错误提示信息
