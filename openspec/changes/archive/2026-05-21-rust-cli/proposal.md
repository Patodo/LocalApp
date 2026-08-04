## Why

当前 LocalApp 的 AI 集成通过 MCP stdio client 实现，需要用户在本机安装 Node.js 并配置 MCP client 路径。这带来了分发和安装的复杂性：打包依赖、跨平台兼容、配置门槛高。对于企业内部工具而言，一个单文件二进制 CLI + Claude Code Skill 是更务实的方案——零运行时依赖，下载即用。

## What Changes

- **删除 TypeScript MCP client** (`packages/mcp-client`)，用 Rust 编写的 CLI 工具替代
- **新增 Rust CLI 工具**：编译为单个二进制文件（`localapp`），支持 Windows / macOS / Linux
- **新增 Claude Code Skill**：说明书性质的 skill，指导 AI 使用 CLI 和 HTTP API
- **新增服务端接口** `POST /api/pages`：创建空页面，供 CLI `new` 命令调用
- **删除服务端 MCP e2e 测试**：`packages/server/tests/e2e/mcp/` 目录，改为测试新增的 API 端点

## Capabilities

### New Capabilities

- `cli-tool`: Rust CLI 工具，提供 `new`、`upload`、`pages`、`schemas` 命令，输出 JSON，配置管理（`~/.localapp/work/config.json` + 环境变量覆盖）
- `claude-skill`: Claude Code Skill 说明书，指导 AI 通过 CLI 和 HTTP API 操作 LocalApp

### Modified Capabilities

- `mcp-tools`: 删除此 capability，被 `cli-tool` 和 `claude-skill` 替代

## Impact

- **packages/mcp-client**: 完全重写，从 TypeScript 切换为 Rust
- **packages/server/src/routes/pages.ts**: 新增 `POST /api/pages` 端点
- **packages/server/tests/e2e/mcp/**: 删除 MCP 集成测试，新增 `POST /api/pages` 的 e2e 测试
- **packages/server/src/index.ts**: 如需要则注册新路由
- **.claude/skills/**: 新增 localapp skill 文件
- **构建工具链**: 新增 Rust / Cargo 构建依赖
