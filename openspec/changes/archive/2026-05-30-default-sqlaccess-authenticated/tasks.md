## 1. sqlAccess 默认值

- [x] 1.1 修改 `packages/cli/src/commands/init.rs` 中 sql_access 默认值为 `"authenticated"`
- [x] 1.2 修改 `packages/server/src/routes/serve.ts` 中 sqlAccess fallback 为 `"authenticated"`
- [x] 1.3 验证 `localapp init --skip-deploy` 生成包含 `sqlAccess: "authenticated"` 的 manifest.json
