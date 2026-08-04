## Why

Agent 测试中每次使用 `useExec` 都会触发 403，因为默认 `sqlAccess` 为 `null`（服务器回退到 `"owner"`）。页面所有者与访问者不同时，raw SQL 不可用。需要手动修改 manifest 才能使用 `useExec`，降低了开箱即用体验。

## What Changes

- CLI init 创建的 manifest.json 默认 `sqlAccess` 从 `null` 改为 `"authenticated"`
- 服务器 sqlAccess fallback 从 `"owner"` 改为 `"authenticated"`

## Capabilities

### Modified Capabilities
- `raw-sql-endpoint`: sqlAccess 默认值从 `"owner"` 改为 `"authenticated"`

## Impact

- `packages/cli/src/commands/init.rs` — sql_access 默认值
- `packages/server/src/routes/serve.ts` — sqlAccess fallback
- 新创建的应用 `useExec` 无需额外配置即可使用
- 现有无 sqlAccess 配置的应用也会受益于新的 fallback
