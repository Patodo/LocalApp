## Why

LocalApp 已实现完整的后端能力（CRUD API、用户认证、双层访问控制），但用户（不懂代码的人 + AI 助手）在 `localapp init` 后拿到的是一个空项目，不知道平台能提供什么、API 怎么调用。需要一个前端 SDK 和初始化模板，让 AI 助手能正确使用平台能力。

## What Changes

- 新增 `packages/client/`：零运行时依赖的 React SDK，封装 CRUD API、访客身份查询、路径自动检测
- 新增 `init-repo/`：Vite + React 项目模板，预装 SDK 源码，包含 CLAUDE.md（供 AI 助手阅读）和示例页面
- 更新 `pnpm-workspace.yaml`：将 `packages/client` 纳入 workspace
- 更新 README 和 openspec/config.yaml：说明 init-repo 的定位和同步机制

## Capabilities

### New Capabilities
- `client-sdk`：React SDK，提供 useMe、useList、useGet、useCreate、useUpdate、useDelete、useCount 等 Hook，自动检测 API basePath，封装平台 CRUD 和身份查询能力
- `init-template`：Vite + React 项目模板，预装 SDK 源码和 CLAUDE.md，供 localapp init 命令 git clone 使用

### Modified Capabilities
- `monorepo-structure`：新增 packages/client 作为第三个 TypeScript 子包纳入 pnpm workspace

## Impact

- 新增 `packages/client/` 包（TypeScript，零运行时依赖，react 为 peerDependency）
- 新增 `init-repo/` 目录（不属于 pnpm workspace，是独立的模板目录）
- 修改 `pnpm-workspace.yaml` 添加 `packages/client`
- 修改根 README.md 和 openspec/config.yaml 的 context 说明
- CLI 的 init 命令无需修改（仍通过 TEMPLATE_REPO_URL git clone 远程模板仓库）
- 需要一个脚本将 `packages/client/src/` 同步到 `init-repo/src/lib/localapp/`
