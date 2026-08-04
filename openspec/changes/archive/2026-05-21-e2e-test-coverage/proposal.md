## Why

当前 e2e 测试仅通过 `fetch` 直接调用 Server HTTP API，没有覆盖 CLI → Server 的完整链路。page-serving（iframe wrapper、静态文件服务、SPA fallback）零覆盖，导致 Fastify 通配路由不匹配空路径的 bug 未被发现。此外，pages CRUD、version 管理等场景也缺少验证。

## What Changes

- 新增 CLI + Server 端到端测试框架：启动 Server、编译 CLI 二进制、通过子进程调用 CLI 命令、验证 stdout/stderr 和退出码
- 补齐 page-serving 全部 7 个 scenario 的 e2e 测试（iframe wrapper、静态文件、index.html、SPA fallback、CSP 头、404 等）
- 补齐 pages CRUD 的 e2e 测试（list、info、delete、404、403）
- 补齐 version 管理的 e2e 测试（版本递增、旧版本清理）
- 补齐 CLI 特有场景的 e2e 测试（未配置时报错、项目目录检测、.localapp.json 读写）
- 保留现有 fetch-based 测试不动，新增的 CLI e2e 测试放在独立目录

## Capabilities

### New Capabilities
- `e2e-cli-test-framework`: CLI + Server 端到端测试基础设施（编译 CLI、启动 Server、子进程执行、环境变量注入、临时目录管理）

### Modified Capabilities
- `page-serving`: 补充 e2e 测试覆盖，验证 iframe wrapper、静态文件服务、SPA fallback、CSP 头等 scenario
- `file-upload`: 补充 CLI upload 命令的 e2e 测试，验证带子目录文件上传
- `cli-tool`: 补充 CLI 各命令的端到端集成测试

## Impact

- 测试基础设施：新增测试 helper（编译 CLI、启动 Server、临时项目目录）
- 测试文件：新增 `packages/server/tests/e2e-cli/` 目录下的测试文件
- 构建依赖：e2e-cli 测试需要先编译 Rust CLI 二进制（`cargo build`）
- 现有测试：不变
