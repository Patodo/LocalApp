## ADDED Requirements

### Requirement: CLI init 到页面可访问的完整 E2E 验证
系统 SHALL 提供端到端测试验证从 CLI init 到 Playwright 访问页面的完整用户旅程。测试 SHALL 启动真实 Server、通过 CLI 二进制执行 init 命令、用 Playwright 打开部署页面并验证内容。

#### Scenario: CLI init 创建应用后页面可访问
- **WHEN** 启动测试 Server，执行 `localapp init --name my-app --source builtin`（使用已配置的 server URL 和 API key）
- **THEN** CLI 输出包含 `{"created":"my-app","url":"..."}` 的 JSON
- **AND** Playwright 访问部署页面 URL 返回 200
- **AND** 页面 HTML 包含模板应用的内容

#### Scenario: CLI init 后 CRUD API 可用
- **WHEN** 通过 CLI init 创建应用并通过 CLI schemas create 创建数据表
- **THEN** Playwright 通过 page.evaluate 调用 CRUD API 成功写入和读取数据

#### Scenario: CLI init 后页面包含正确的 SDK 代理配置
- **WHEN** 通过 CLI init 创建应用并访问页面
- **THEN** 页面的 API 请求被正确代理到 server（/api/* 和 /serve/* 路径可达）

### Requirement: E2E 测试 helper 提供完整基础设施
E2E 测试 SHALL 提供统一的 helper 函数，封装 Server 启动、CLI 执行、临时目录管理。

#### Scenario: helper 启动独立 Server 实例
- **WHEN** 测试调用 helper 启动 server
- **THEN** 返回独立的 baseUrl 和 bootstrap API key，使用临时 data 目录

#### Scenario: helper 执行 CLI 子进程
- **WHEN** 测试调用 `runCli(["init", "--name", "test", "--source", "builtin"])` 并传入 server URL 和 API key 环境变量
- **THEN** 返回 `{ exitCode, stdout, stderr }`

#### Scenario: 自动定位 CLI 二进制
- **WHEN** 测试启动时
- **THEN** helper 自动检测 `packages/cli/target/debug/localapp`（或 .exe），若不存在则执行 `cargo build` 编译

#### Scenario: 测试后自动清理
- **WHEN** 测试结束
- **THEN** 自动关闭 server、清理临时 data 目录、删除 init 创建的项目目录
