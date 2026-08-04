## Why

两轮端到端测试暴露了两个 CLI 摩擦点：`init --builtin-repo --skip-deploy` 仍强制要求登录，`login` 命令不支持非交互式输入，导致脚本和 CI/CD 场景无法使用。这些痛点直接影响新用户的首次体验。

## What Changes

- `init` 命令在使用 `--builtin-repo` 且 `--skip-deploy` 时不再强制要求登录配置，允许纯本地初始化
- `login` 命令新增 `--server-url` 和 `--api-key` 命令行参数，支持非交互式配置
- `login` 帮助文本更新，说明两种使用方式

## Capabilities

### New Capabilities

- `cli-non-interactive-login`: CLI login 命令支持通过命令行参数非交互式配置服务器地址和 API Key

### Modified Capabilities

- `cli-tool`: login 命令新增 `--server-url` 和 `--api-key` 参数，原有交互式流程保持不变
- `project-init`: init 命令在 `--builtin-repo --skip-deploy` 时跳过登录配置检查，允许无服务端环境的纯本地初始化

## Impact

- `packages/cli/src/commands/init.rs` — 条件化 Config::load() 检查
- `packages/cli/src/commands/login.rs` — 新增参数解析和分支逻辑
- `packages/cli/src/main.rs` — Login 命令新增 `--server-url` 和 `--api-key` 参数定义
