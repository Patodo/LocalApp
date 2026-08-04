## Why

当前 25 个"端到端"测试全部用 `fetch()` 直接调用 Server API，实际上绕过了 CLI 和浏览器，是集成测试而非端到端测试。这导致 CLI 与 Server 之间的协议不匹配无法被发现（如字段名差异、multipart 格式变更）。需要建立真正的 E2E 测试体系：CLI 创建应用 → Playwright 验证页面可用，同时将现有测试正确归类为集成测试。

## What Changes

- **测试目录重命名**: `tests/e2e/` → `tests/integration/`，25 个测试文件定位为集成测试
- **新建真正的 E2E 测试**: `tests/e2e/` 目录，使用 Playwright + 真实 CLI 二进制 + 真实 Server
- **E2E 测试基础设施**: 测试 helper 提供启动 Server、编译/定位 CLI 二进制、临时目录管理
- **E2E 核心测试场景**: CLI init → Playwright 访问页面 → 验证 HTML 渲染；CLI schemas create → Playwright CRUD 验证
- **vitest 配置更新**: 调整 test script 路径指向 `tests/integration/`
- **Playwright 配置更新**: 增加 E2E CLI 测试目录

## Capabilities

### New Capabilities

- `e2e-cli-flow`: 真正的端到端测试——启动 Server + 执行 CLI 二进制 + Playwright 浏览器验证，覆盖从项目初始化到页面可访问的完整用户旅程

### Modified Capabilities

- `e2e-cli-test-framework`: 重命名为集成测试 helper，路径从 `tests/e2e/` 迁移到 `tests/integration/`，更新 vitest 配置
- `e2e-ui-testing`: 增加基于 CLI 创建的应用的 Playwright 测试场景（访问页面、CRUD 数据验证）

## Impact

- **packages/server/tests/**: 目录结构重组（e2e → integration + 新 e2e）
- **packages/server/package.json**: test script 路径更新
- **playwright.config.ts**: testDir 更新，增加 CLI E2E 配置
- **CI 流程**: E2E 测试需要 Rust 编译环境（编译 CLI）和 Playwright 浏览器
- **无 Server 代码改动**
- **无 API 变更**
