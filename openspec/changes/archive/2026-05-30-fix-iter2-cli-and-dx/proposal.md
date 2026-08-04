## Why

CLI 二进制（221MB）在 macOS 上复制到新路径后被 AMFI 杀死（exit 137），导致 `localapp` 命令完全不可用。同时二进制体积过大（内嵌了 265MB 的 node_modules），sqlAccess 权限拒绝时缺少配置提示。这些是第二轮 Agent 测试中反馈最集中的三个阻塞性问题。

## What Changes

- **CLI 构建流程增加 ad-hoc codesign**：`cargo build --release` 后执行 `codesign -s -`，修复 macOS 上二进制复制后 exit 137
- **build.rs 排除 node_modules**：编译前将 init-repo 复制到 staging 目录（排除 node_modules/dist/.next），`include_dir!` 指向 staging 目录，二进制从 221MB 降至 ~19MB
- **sqlAccess 403 错误信息改进**：返回可操作的提示，引导用户配置 manifest.json 中的 sqlAccess
- **init-repo/CLAUDE.md 文档补充**：上传目录结构行为和 sqlAccess 配置说明

## Capabilities

### New Capabilities

- `cli-build-codesign`: macOS ad-hoc 签名确保二进制在新路径可执行
- `cli-binary-slim`: 编译时排除 node_modules 减小二进制体积

### Modified Capabilities

- `cli-builtin-template`: build.rs 改为 staging 目录模式，init-repo 的 exclude 逻辑从运行时移到编译时
- `raw-sql-endpoint`: 403 错误信息增加 sqlAccess 配置指引

## Impact

- `packages/cli/build.rs` — 新增 staging 目录复制逻辑，排除 node_modules 等
- `package.json` — `build:cli` 脚本增加 codesign 步骤
- `packages/server/src/routes/serve.ts` — sqlAccess 403 错误信息
- `init-repo/CLAUDE.md` — 新增部署注意事项章节
- 二进制体积：221MB → ~19MB
- macOS 兼容性：exit 137 问题修复
