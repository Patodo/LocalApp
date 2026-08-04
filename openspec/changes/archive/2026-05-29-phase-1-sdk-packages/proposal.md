## Why

当前客户端 SDK 代码以源码形式嵌入在 `init-repo/src/lib/localapp/` 模板中，每次执行 `localapp upload` 时通过 CLI 复制到用户项目目录。这导致 SDK 没有独立版本号，用户无法在 `package.json` 中声明依赖，也无法独立更新。SDK 的 CRUD、React Hooks、Agent 三个模块耦合在同一个目录中，用户即使不需要 Agent 功能也会被强制引入。将其抽离为正式的 npm 包是后续前端架构统一（参见 `docs/plan.md` Phase 2-4）的前置条件。

## What Changes

- 在 monorepo 中新增 `packages/sdk-core/` — `@localapp/sdk` 包，纯 JS 客户端，零框架依赖
- 在 monorepo 中新增 `packages/sdk-react/` — `@localapp/sdk-react` 包，React Hooks，peerDependency `@localapp/sdk`
- 在 monorepo 中新增 `packages/sdk-agent/` — `@localapp/sdk-agent` 包，Agent SDK，peerDependency `@localapp/sdk` + `@localapp/sdk-react`
- `init-repo/` 模板中移除 `src/lib/localapp/` 目录，改为 `package.json` 中声明对上述包的依赖
- CLI `upload` 命令不再复制 SDK 源码到用户项目
- 现有 `init-repo/` 中的 SDK 代码作为过渡期保留，直到模板更新完成
- SDK 包提供完整的 TypeScript 类型导出

## Capabilities

### New Capabilities

- `sdk-core`: 平台 CRUD 操作的纯 JS 客户端，包括 `createClient()`、资源 CRUD、用户/组查询、文件上传、原始 SQL 执行等能力。独立于任何 UI 框架
- `sdk-react`: 基于 `@localapp/sdk` 的 React Hooks 封装，包括 `useList`、`useGet`、`useCreate`、`useUpdate`、`useDelete`、`useCount`、`useUpload`、`useExec`、`useMe`、`useUsers`、`useGroups` 等
- `sdk-agent`: 基于 `@localapp/sdk` 和 `@assistant-ui/react` 的 AI Agent 集成，包括 `useAgent` Hook 和 `AgentChat` 组件

### Modified Capabilities

无。此为全新能力，不修改已有 spec。

## Impact

- 新增: `packages/sdk-core/`、`packages/sdk-react/`、`packages/sdk-agent/`
- 修改: `init-repo/package.json`（添加依赖声明）、`init-repo/src/lib/localapp/`（移除）
- 修改: `packages/cli/src/commands/upload.rs`（移除 SDK 源码复制逻辑）
- 修改: `pnpm-workspace.yaml`（可能需要调整工作区配置以支持本地包引用）
- 不影响: `packages/server/`（服务器无变更）
- 不影响: 已有应用的运行时行为
