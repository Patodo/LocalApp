## Context

当前 `packages/server/tests/e2e/` 下有 25 个测试文件，全部使用 vitest + `fetch()` 直接调用 Fastify server 实例的 API 端点。这些测试覆盖了 API 行为、错误码、权限等，但绕过了 CLI 和浏览器，实际上是集成测试。

同时存在 `tests/e2e-ui/` 目录下的 4 个 Playwright 测试，覆盖了 auth/profile/admin 的浏览器 UI。这些已经是真正的 UI E2E 测试，但覆盖范围有限。

`tests/e2e-cli-test-framework/` 的 spec 定义了 CLI 测试框架（编译 CLI、启动 server、子进程执行 CLI），但尚未实现。

目标：建立真正的 E2E 测试体系（CLI + Server + Playwright），同时将现有测试正确定位为集成测试。

## Goals / Non-Goals

**Goals:**
- 将 `tests/e2e/` 重命名为 `tests/integration/`，更新所有引用
- 新建 `tests/e2e/` 目录，包含真正的端到端测试
- E2E 测试基础设施：启动真实 server、定位/编译 CLI 二进制、Playwright 浏览器
- 核心测试场景：CLI init → Playwright 访问页面验证

**Non-Goals:**
- 不重写现有集成测试的测试逻辑
- 不改变现有 Playwright 测试的 helper 结构
- 不在 E2E 中覆盖所有集成测试的边界条件（那是集成测试的职责）

## Decisions

### Decision 1: E2E 测试使用 Playwright 统一框架

E2E 测试（CLI + Server + Browser）统一使用 Playwright 测试框架。

**理由**:
- 项目已配置 Playwright，不需要额外引入测试框架
- Playwright 提供 `page.goto()` 验证部署页面、`page.evaluate()` 调用 CRUD API
- 测试 helper 中可封装启动 server + 执行 CLI 的逻辑

### Decision 2: 测试三层结构

```
tests/
├── unit/          ← 未来（纯函数测试）
├── integration/   ← 原 e2e/，fetch() → Fastify API
└── e2e-ui/        ← 原 e2e-ui/，Playwright 浏览器测试
                    + 新增 CLI E2E 场景
```

集成测试保持 vitest 框架。E2E 测试保持 Playwright 框架。两者并行运行。

### Decision 3: E2E 测试 helper 复用现有模式

E2E 测试的 server 启动逻辑复用 `e2e-ui/helpers.ts` 的模式：创建临时 data 目录、启动 Fastify 实例、获取随机端口。额外增加：
- `runCli(args, options)`: 子进程执行 `localapp` CLI
- 自动检测/编译 CLI 二进制路径

### Decision 4: E2E 测试依赖 cli-builtin-template

CLI init 的 E2E 测试依赖内置模板功能（`--source builtin`），避免对 git/网络的依赖。因此 e2e-restructure 的实施应在 cli-builtin-template 之后。

## Risks / Trade-offs

- **E2E 测试速度较慢** → 需要 npm install + build + server 启动 + Playwright 浏览器，每个测试约 30-60s。通过 `fullyParallel: false` 和少量关键路径测试控制总时间
- **依赖 Rust 编译环境** → CI 需要 cargo 来编译 CLI。增加 CI 配置复杂度
- **集成测试重命名影响面** → 需要更新 package.json scripts、CI 配置、以及可能的文档引用
