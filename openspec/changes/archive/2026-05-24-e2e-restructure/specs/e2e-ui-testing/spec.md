## MODIFIED Requirements

### Requirement: Playwright test infrastructure
Playwright 配置 SHALL 保留 Chromium 项目，testDir 指向 `packages/server/tests/e2e-ui/`。helper 函数 SHALL 在现有基础上增加 `runCli()` 函数用于执行 CLI 子进程。E2E 测试 SHALL 支持 CLI 创建应用后的浏览器验证场景。

#### Scenario: Playwright 运行 E2E 测试
- **WHEN** 执行 `npx playwright test`
- **THEN** 运行 `tests/e2e-ui/` 下的所有测试，包括新增的 CLI E2E 场景

## ADDED Requirements

### Requirement: CLI 创建应用的浏览器验证测试
测试 SHALL 覆盖 CLI init 创建应用后，Playwright 浏览器验证页面可访问、CRUD API 可用。

#### Scenario: init 后页面 HTML 渲染正确
- **WHEN** 通过 CLI init 创建应用后，Playwright 访问页面 URL
- **THEN** 页面状态码 200，HTML 包含模板应用标题或内容

#### Scenario: init + schemas create 后 CRUD 数据可读写
- **WHEN** 通过 CLI init 创建应用并通过 schemas create 创建数据表后
- **THEN** Playwright 通过 `page.evaluate` 向 CRUD API 写入一条数据，再读取验证内容匹配

#### Scenario: upload 更新后页面内容更新
- **WHEN** 修改 dist 文件后通过 CLI upload 更新部署
- **THEN** Playwright 访问页面看到新版本内容
