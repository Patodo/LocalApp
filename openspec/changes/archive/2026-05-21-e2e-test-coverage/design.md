## Context

LocalApp 由 Server（TypeScript/Fastify）和 CLI（Rust）两部分组成。现有 e2e 测试（`tests/e2e/`）通过 `fetch` 直接调用 Server API，没有经过 CLI。这导致 CLI 的参数解析、配置读取、`.localapp.json` 管理、子进程通信等环节完全没有被验证。

Server 的 page-serving 路由（iframe wrapper、静态文件、SPA fallback、CSP 头）零测试覆盖，刚因此暴露了一个 Fastify 通配路由不匹配空路径的 bug。

## Goals / Non-Goals

**Goals:**
- 建立 CLI + Server 端到端测试框架，通过子进程调用编译好的 CLI 二进制
- 补齐 page-serving、pages CRUD、version 管理、CLI 配置等关键路径的 e2e 覆盖
- 每个测试独立、可重复运行，使用临时目录和随机端口

**Non-Goals:**
- 不修改现有 `tests/e2e/` 测试
- 不增加 Rust 单元测试（那是另一个议题）
- 不测试 `localapp login` 的交互式输入（dialoguer 不适合自动化）
- 不测试 CLI 的 `--help` 输出

## Decisions

### 1. 测试放在 `packages/server/tests/e2e-cli/`

CLI e2e 测试需要 Server 运行，而 Server 的测试基础设施（`createTestServer`、`getAppUrl` 等）已经在 `packages/server/tests/e2e/helpers.ts` 中。将 CLI e2e 测试放在同一包下可以复用 Server 启动逻辑。

**替代方案**: 放在 `packages/cli/tests/` — 但 Rust 测试不方便启动和管理 Node.js Server。

### 2. 通过环境变量注入 CLI 配置

CLI 通过 `LOCALAPP_SERVER_URL` 和 `LOCALAPP_API_KEY` 环境变量读取配置，优先级高于配置文件。e2e 测试通过环境变量注入，避免写配置文件污染用户环境。

### 3. 每个测试套件启动独立 Server

使用 `beforeAll` 启动 Server（随机端口），`afterAll` 关闭。每个 describe 块独立，避免测试间状态污染。

### 4. 测试前编译 CLI 二进制

在 `beforeAll` 中检查 CLI 二进制是否存在，若不存在则执行 `cargo build`。二进制路径为 `packages/cli/target/debug/localapp-cli.exe`（Windows）或 `localapp-cli`（其他平台）。

### 5. 子进程执行 + 输出解析

CLI 成功时输出 JSON 到 stdout，失败时输出 JSON 到 stderr 并返回非零退出码。测试通过 `child_process.execFile` 调用 CLI，解析 stdout/stderr 验证结果。

### 6. 使用临时目录作为工作目录

`localapp new` 和 `localapp upload` 依赖当前目录的 `.localapp.json`。每个测试套件创建临时目录，CLI 命令在该目录下执行。

## Risks / Trade-offs

- **编译耗时**: Rust 首次编译需要时间 → 只在二进制不存在时编译，dev 模式增量编译很快
- **平台差异**: 二进制名称在 Windows 上是 `.exe` → helper 中自动判断平台
- **Server 端口冲突**: 使用随机端口（port 0）避免冲突
- **page-serving 验证**: CLI 不直接访问页面内容，page-serving 测试仍需用 `fetch` 验证 HTTP 响应 → 混合使用 CLI 和 fetch
