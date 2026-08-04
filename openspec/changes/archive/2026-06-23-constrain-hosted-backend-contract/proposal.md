## Why

当前 hosted backend action 已经能承接服务端可信业务逻辑，但平台边界仍主要依赖开发者文档和运行时事后预算。下游反馈的 `memory access out of bounds` 说明：当应用把全量读模型放进 action 中执行时，平台会在 worker 序列化、低内存限制和 sql.js 对象物化的组合下出现不稳定，需要把边界从“说明书”升级为 contract、upload 校验和运行时前置限制。

## What Changes

- 将 hosted backend action 明确定义为受限的业务动作层，优先承接 command、短事务、级联写入、状态流转、服务端校验和通知编排。
- 为 action manifest 引入 action 类型与 `uses` 约束，平台只允许 action 调用已声明的 named SQL。
- 为 named query 引入结果形态和预算声明，支持分页、单行、聚合等有界读模型。
- 在 CLI validate/upload 与 server upload 阶段拒绝 action 引用无界 query，例如无分页参数、无 `LIMIT` 的列表型 query，或明显的全量多表读模型。
- 将 named SQL 结果预算从事后检查前移到 SQL 读取过程，避免先完整物化大结果再报错。
- 在 SDK/init 模板中生成更窄的 backend ctx 示例和说明，让普通读模型走 bounded named SQL，复杂读模型走 SQL 聚合/分页/投影，而不是 action 全量组装。
- **BREAKING**：已有 action 若调用未在 manifest `uses` 中声明的 query/mutation，或引用无界 query，将在 validate/upload 或运行时被拒绝，需要补充 contract 或改为分页/聚合查询。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `backend-contract-files`: 增加 action 类型、uses 约束、query 结果形态与 upload/validate 阶段的成本校验要求。
- `hosted-backend-actions`: 收窄 action 的平台语义，要求 action 只能调用声明过的 named SQL，并禁止默认承接无界读模型。
- `hosted-action-runtime`: 增强运行时前置预算、RPC 结果限制和稳定错误分类，避免 worker/structured clone/WASM 底层异常成为主要对外错误。
- `named-sql-api`: 增加 bounded query 契约和执行时行数/字节预算的前置 enforcement，确保读模型默认走分页、过滤或聚合。

## Impact

- `packages/cli/src/commands/upload.rs`：增强 backend contract 与 action manifest 的静态校验。
- `packages/server/src/routes/upload.ts`：服务端 upload 阶段复验 backend contract，避免绕过 CLI。
- `packages/server-core/src/lib/backend-contract.ts`：扩展 named SQL contract、结果预算模型与执行时前置限制。
- `packages/server-core/src/lib/backend-actions.ts`：强制 action uses、限制 ctx 可调用范围、改进 action budget 错误。
- `packages/backend`、`init-repo` 与 builtin template：更新 action 定义、文档、示例和生成的 SDK/ctx 类型。
- 现有下游应用：需要将全量读模型 action 改为 bounded named SQL、分页 query 或聚合 query。
