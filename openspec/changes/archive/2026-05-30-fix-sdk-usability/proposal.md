## Why

两个独立无上下文 Agent 使用 LocalApp 平台构建应用（请假系统、资产追踪系统）时，均遭遇阻断性错误和显著的开发体验问题。最严重的问题是 `localapp init` 生成的项目无法安装依赖（`workspace:*` 协议不兼容 npm），以及 `useExec` 在 CRUD 模式下返回 404 与文档承诺矛盾。这些问题导致新用户完全无法启动开发。

## What Changes

- **CLI 模板提取后处理**：CLI 提取内置模板后，将 SDK 源码拷贝到目标项目 `vendor/` 目录，并将 `package.json` 中的 `workspace:*` 替换为 `file:./vendor/{pkg}` 引用，使 `npm install` 可以正常工作
- **CRUD 模式开放 useExec**：移除服务器端 `mode !== "sql"` 的硬检查，CRUD 模式下也允许通过 `useExec` 执行 SQL 查询，仅保留 `sqlAccess` 权限校验；添加对 CRUD 管理表的 DROP TABLE 防护
- **修复 useList 依赖 bug**：将 `useList` 中 `JSON.stringify(options)` 依赖改为 `useMemo` 稳定化，避免不必要的重复请求
- **修复模板测试**：通过 vitest `resolve.alias` 解决双 React 实例问题
- **Mutation hooks 添加 onSuccess**：为 `useCreate`/`useUpdate`/`useDelete` 添加可选 `onSuccess` 回调，支持 mutation 后执行自定义逻辑

## Capabilities

### New Capabilities

（无新能力，均为现有能力的修复和增强）

### Modified Capabilities

- `cli-builtin-template`：模板提取后需后处理 package.json，解析 workspace:* 引用并拷贝 SDK 源码
- `raw-sql-endpoint`：CRUD 模式下应允许 useExec（受 sqlAccess 权限控制），需添加 DROP TABLE 防护
- `sdk-react`：useList 依赖修复 + mutation hooks onSuccess 回调
- `sdk-test-fix`：通过 resolve.alias 修复双 React 实例导致的模板测试失败

## Impact

- **CLI (Rust)**：`packages/cli/src/commands/init.rs` 增加模板后处理逻辑；`packages/cli/src/template.rs` 增加 SDK 源码拷贝
- **Server**：`packages/server/src/routes/serve.ts` 修改 db/exec 路由逻辑；`packages/server/src/lib/app-db.ts` 添加 DROP TABLE 防护
- **SDK React**：`packages/sdk-react/src/hooks/use-list.ts` 修复依赖；`use-create.ts`/`use-update.ts`/`use-delete.ts` 添加 onSuccess
- **Init 模板**：`init-repo/` 的 vitest 配置添加 resolve.alias；文档更新（`localapp-data.md`）
