## Why

端到端测试发现 Phase 6 完成的 CLI 开发体验有多个关键缺陷：`localapp dev` 等新命令未编译安装、本地开发时 CRUD API 完全不可用（`detectBasePath()` 在 `localhost:5173` 下无法解析 page 上下文）、`--skip-deploy` 错误地跳过了依赖安装。这些阻塞性问题使 CLI 的开发工作流实际上不可用。

## What Changes

- **CLI `dev` 命令**: 启动 `npm run dev` 前写入 `.localapp/dev-config.json`，注入 userId、pageName、serverUrl，使 Vite 代理能将 `/api/*` 请求改写为 `/serve/{user}/{page}/api/*` 完整路径
- **Vite 模板配置**: 读取 dev-config.json 中的 page 上下文，使用代理路径改写而非简单转发
- **CLI 二进制**: 重新编译安装，使 `dev`、`generate`、`whoami`、`logout` 命令在用户机器上可用
- **`init --skip-deploy` 修复**: 将"跳过部署"和"跳过依赖安装"拆分为独立标志，`--skip-deploy` 不再跳过 `npm install`

## Capabilities

### New Capabilities

- `dev-config-context`: CLI `dev` 命令通过 dev-config.json 注入 page 上下文，使本地开发时 Vite 代理能构建正确的 API 路径

### Modified Capabilities

- `cli-dev-server`: `dev` 命令行为变更 — 启动前写入 dev-config.json；proxy 模式通过路径改写实现，移除手工代理提示
- `cli-builtin-template`: `init --skip-deploy` 行为变更 — 不再跳过 `npm install`
- `client-sdk`: `detectBasePath()` 的"非应用页面"场景不再需要变更（Vite 代理侧解决路径问题），但文档需明确此行为

## Impact

- `packages/cli/src/commands/dev.rs` — 写入 dev-config.json 逻辑
- `packages/cli/src/commands/init.rs` — 拆分 skip 标志
- `init-repo/vite.config.ts` — 读取 dev-config.json，代理路径改写
- `packages/cli` — 重新编译安装二进制
