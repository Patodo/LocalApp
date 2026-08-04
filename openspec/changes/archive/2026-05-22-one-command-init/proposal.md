## Why

当前 `localapp init --name X` 只生成项目脚手架，用户还需要手动执行 `cd`、`npm install`、`localapp new`、`npm run build`、`localapp upload` 等 5 个步骤才能看到页面。对比 PinMe 的 `pinme create` 一步完成所有操作（创建 → 安装 → 构建 → 部署），LocalApp 的首次体验割裂且步骤繁多。将 init 改为一步到位的流程，可以让用户 init 完就能访问页面，大幅降低上手门槛。

## What Changes

- 重构 `localapp init` 命令，在克隆模板后自动执行：安装依赖 → 注册页面（当前 `new` 的逻辑）→ 构建 → 上传 → 打印访问 URL
- 新增 `--skip-deploy` flag，支持离线/内网隔离场景下只生成脚手架
- `new` 命令保留，作为单独注册页面的入口（已有项目的场景）
- 未登录时返回错误提示先 login（克隆模板需从服务端获取 templateRepoUrl，无法降级为脚手架模式）

## Capabilities

### New Capabilities

（无新增能力规格）

### Modified Capabilities

- `project-init`: init 命令从"只生成脚手架"扩展为"生成 + 注册 + 构建 + 部署"的一键流程，新增 `--skip-deploy` flag
- `cli-tool`: CLI init 命令行为变更，增加依赖安装和部署步骤

## Impact

- `packages/cli/src/commands/init.rs` 重构，合并 new/upload 的 HTTP 调用逻辑
- `packages/cli/src/client.rs` 可能需要新增辅助方法
- 无服务端改动，无 API 变更
