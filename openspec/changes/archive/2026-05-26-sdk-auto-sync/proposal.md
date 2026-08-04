## Why

SDK 代码目前存在两份（`packages/client/src/` 和 `init-repo/src/lib/localapp/`），且已不同步。用户通过 AI agent 生成应用时不关心 SDK 版本，需要 SDK 更新自动跟随 CLI 版本，无需手动同步。

## What Changes

- 确立 `init-repo/src/lib/localapp/` 为 SDK 唯一源码，删除 `packages/client/` 包
- 将 SDK 测试从 `packages/client/src/__tests__/` 迁移到 `init-repo/`（已有 vitest 环境）
- `localapp upload` 命令新增自动流程：用内置模板的 SDK 覆盖用户项目的 `src/lib/localapp/`，然后执行 `npm run build`，再上传构建产物
- 移除 `sync:sdk` 脚本（不再需要反向同步）
- 更新 `pnpm-workspace.yaml` 和根 `package.json`，移除 `packages/client` 相关配置

## Capabilities

### New Capabilities
- `sdk-auto-refresh`: CLI upload 时自动用内置模板刷新用户项目的 SDK 文件，确保每次部署使用与 CLI 版本一致的 SDK

### Modified Capabilities
- `client-sdk`: SDK 源码唯一真相源从 `packages/client/src/` 变更为 `init-repo/src/lib/localapp/`，测试迁至 init-repo
- `init-template`: 移除对 `packages/client` 的依赖和 `sync:sdk` 脚本引用
- `cli-tool`: `localapp upload` 命令新增 SDK 刷新和自动构建步骤

## Impact

- **packages/client/**: 整个包将被删除，测试迁移到 init-repo
- **init-repo/**: 接管 SDK 开发和测试职责
- **packages/cli/**: upload 命令新增 SDK 刷新和构建逻辑
- **根 package.json**: 移除 `sync:sdk` 脚本和 `packages/client` 的 workspace 引用
- **pnpm-workspace.yaml**: 移除 `packages/client`
- **无用户感知变更**: SDK 刷新在 upload 流程中自动完成，用户无需额外操作
