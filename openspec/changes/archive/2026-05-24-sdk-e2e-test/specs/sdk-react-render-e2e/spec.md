## ADDED Requirements

### Requirement: init 模板 React 应用浏览器渲染验证
系统 SHALL 提供端到端测试验证 CLI init 创建的 React 应用在浏览器中通过 SDK Hook 正确渲染。

#### Scenario: init 模板部署后 React 渲染成功
- **GIVEN** 通过 CLI init --builtin-repo 创建应用（含 React + SDK）
- **WHEN** Playwright 访问部署页面 URL
- **THEN** 页面包含 `<h1>LocalApp App</h1>`（React 组件渲染成功）

#### Scenario: init 模板中 useMe Hook 执行不报错
- **GIVEN** 同上环境，用户未登录
- **WHEN** 页面 React 渲染完成
- **THEN** 页面显示 "Not logged in"（useMe Hook 正确处理了未认证状态）

#### Scenario: init 模板中 useList Hook 渲染空列表
- **GIVEN** 同上环境，无数据表
- **WHEN** 页面 React 渲染完成
- **THEN** 页面显示 "Loading..." 然后稳定（useList 返回错误但不崩溃，或 postsLoading 变为 false）
