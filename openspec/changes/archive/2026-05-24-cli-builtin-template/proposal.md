## Why

`localapp init` 当前依赖 git clone 外部模板仓库，导致在没有网络或 CI 环境中无法初始化项目。这是构建真正端到端测试（CLI → Server → Playwright）的首要阻塞点。内置模板后，init 命令在离线环境也能工作，E2E 测试无需外部依赖即可验证完整用户旅程。

## What Changes

- CLI 编译时将 `init-repo/` 源码打包进二进制（使用 `include_dir!`）
- `init` 命令默认使用服务端的 git URL clone 模板，git clone 失败或无 git URL 时自动回退内置模板
- `init` 命令增加 `--builtin-repo` 布尔参数，直接使用内置模板跳过 git
- 内置模板路径下照样执行 `npm install` → `npm run build`

## Capabilities

### New Capabilities

- `cli-builtin-template`: CLI 内置模板机制——编译时打包 init-repo 源码，init 时解压到目标目录，作为 git clone 的离线替代

### Modified Capabilities

- `project-init`: init 命令增加 `--builtin-repo` 参数和自动回退内置模板逻辑

## Impact

- **packages/cli/**（Rust）: Cargo.toml 增加 `include_dir` 依赖，`init.rs` 增加模板解压逻辑
- **init-repo/**: 不变，但会被 CLI 编译流程引用
- **构建流程**: CLI 编译时需要确保 init-repo 内容是最新的
- **无 Server 端改动**
- **无 API 变更**
