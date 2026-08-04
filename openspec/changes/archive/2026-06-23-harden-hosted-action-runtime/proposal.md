## Why

hosted backend action 已经承担应用的可信后端逻辑，但当前运行时对并发、资源边界和底层错误归因不够稳健。`sample-app` 在小数据量场景下触发 `memory access out of bounds`，说明问题不应简单归因为业务数据过大，而是平台缺少对 action RPC、named SQL/sql.js 执行和 worker 资源错误的系统性护栏。

## What Changes

- 为 hosted backend action 建立正式运行时能力规格，明确短事务定位、worker 隔离、超时、资源错误包装、结果大小限制和可观测性要求。
- 为同一应用数据库的 named SQL 执行引入 per-db 串行化队列，避免 sql.js/WASM 同一连接被 action RPC 与页面普通查询并发交错访问。
- 为同一应用的 action 调用增加并发背压，防止页面加载、React StrictMode 或误写 effect 造成 worker 风暴。
- 包装 worker、VM、structured clone 和 sql.js/WASM 的底层错误，返回可诊断的 `ActionError` 或 named SQL 错误，不再泄漏 `memory access out of bounds` 等底层信息。
- 增加 action 执行指标与日志，记录 action 名称、RPC 次数、query/mutation rows/bytes/ms、DB 队列等待时间、worker 退出原因和错误分类。
- 更新 init-repo 与开发者文档，说明 backend action 适合写操作、级联删除、审批、同步计算和服务端校验，不鼓励用 action 承载无分页的全量读模型。

## Capabilities

### New Capabilities
- `hosted-action-runtime`: 规范平台托管 backend action 的隔离执行、资源治理、错误归因、并发背压与可观测性。

### Modified Capabilities
- `named-sql-api`: 增加同一应用数据库的执行串行化与底层 sql.js/WASM 错误包装要求，确保普通 named SQL 与 action ctx SQL 共享稳定的数据库执行边界。

## Impact

- 影响 `packages/server-core/src/lib/backend-actions.ts` 的 worker 执行、RPC 调度、错误包装和指标采集。
- 影响 `packages/server-core/src/lib/app-db.ts` 与 `backend-contract.ts` 的 DB 执行队列、事务互斥和 sql.js 错误归因。
- 影响 `packages/server/src/routes/serve.ts` 和 `init-repo/runtime/mini-server.mjs` 的 action/named SQL 错误响应一致性。
- 影响 `packages/server-core`、`packages/server`、`init-repo` 的测试覆盖。
- 影响 `init-repo/CLAUDE.md`、backend action 示例说明和开发者指南。
