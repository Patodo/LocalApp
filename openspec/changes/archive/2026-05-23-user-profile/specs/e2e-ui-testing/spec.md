## ADDED Requirements

### Requirement: Playwright 测试基础设施

项目 SHALL 提供 Playwright 配置和测试脚手架，支持启动真实 server 后在浏览器中执行 UI 自动化测试。

#### Scenario: Playwright 配置存在
- **WHEN** 查看 `playwright.config.ts`
- **THEN** 配置了 Chromium 浏览器、baseURL、测试目录指向 `packages/server/tests/e2e-ui/`

#### Scenario: 测试 helper 可用
- **WHEN** 编写 UI 测试用例
- **THEN** 可通过 helper 启动真实 server、获取 baseUrl、执行注册/登录操作获取 session

#### Scenario: CI 可运行
- **WHEN** 执行 `npx playwright test`
- **THEN** 自动启动 Chromium、运行所有 UI 测试、输出报告

### Requirement: Profile SPA UI 测试

系统 SHALL 包含 Profile 页面的 Playwright UI 自动化测试。

#### Scenario: 登录后访问 Profile 页面
- **WHEN** 已登录用户导航到 `/profile`
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
- **WHEN** 未登录用户导航到 `/profile`
- **THEN** 重定向到登录页面

### Requirement: 登录注册页面 UI 测试

系统 SHALL 包含登录和注册页面的 Playwright UI 自动化测试。

#### Scenario: 注册新用户
- **WHEN** 用户在注册页面填写用户名和密码后提交
- **THEN** 注册成功，跳转到登录页面

#### Scenario: 登录成功
- **WHEN** 用户在登录页面填写正确的用户名和密码后提交
- **THEN** 登录成功，跳转到之前的页面

#### Scenario: 登录失败显示错误
- **WHEN** 用户在登录页面填写错误的密码后提交
- **THEN** 页面显示错误提示信息
