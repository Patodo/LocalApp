## Why

当前 hosted backend action 的最坏情况资源模型会把并发 action 放大为大量独立 Node Worker、VM 上下文和跨线程 structured clone，导致小型应用在 100 应用 / 50 并发这类场景下也可能需要过高机器配置。LocalApp 的优势应来自“静态前端 + named SQL + 平台原语”的轻量默认路径，hosted action 应作为受控增强能力，而不是把每个应用重新变成一个常驻小后端。

## What Changes

- 为 hosted action runtime 增加明确的资源预算，包括 SQL RPC 次数、单次/累计 SQL rows、SQL 结果 bytes、action 返回 bytes 和执行耗时。
- 将 action 调度模型从“请求或应用数量直接决定 worker 数”收敛为平台预算驱动：全局 worker 上限、按 appKey 排队、单应用并发默认受限、热 worker 可短暂复用但必须可回收。
- 明确 action 不适合无分页全量读模型，平台应在超出预算时返回可理解错误，引导开发者改用 named SQL 分页、JOIN、聚合或前端组装。
- 增强 named SQL 的服务端读写承载能力，使普通 CRUD、列表、筛选、统计、分页和短事务写逻辑优先走便宜路径。
- 更新 init 模板和开发者指引，明确“默认用 named SQL，只有跨表短事务、权限敏感写操作、审批、级联删除、通知等场景才使用 action”。
- 增加运行时可观测性，记录 worker 池/队列、action 预算消耗、SQL rows/bytes 和拒绝原因，便于容量评估。

## Capabilities

### New Capabilities

无。

### Modified Capabilities

- `hosted-action-runtime`: 增加 action 资源预算、结果大小限制、全局 worker 调度上限、按应用队列和更细粒度诊断要求。
- `hosted-backend-actions`: 明确 hosted action 的产品定位和 API 行为边界，禁止将 action 作为无分页读模型搬运层。
- `named-sql-api`: 增强 named SQL 作为默认轻量后端路径的规格要求，包括分页/聚合优先、结果预算和短事务/批量变更能力方向。
- `init-template`: 更新模板文档和示例，避免应用开发者把读模型和普通 CRUD 下沉到 action。

## Impact

- 影响 `packages/server-core/src/lib/backend-actions.ts` 的 action 执行、RPC 统计、资源预算检查、worker 生命周期和诊断事件。
- 影响 `packages/server/src/routes/serve.ts` 的 action endpoint 错误响应、日志字段和 runtime 配置传递。
- 影响 named SQL 执行路径和客户端/模板说明，鼓励分页、JOIN、聚合和短事务变更优先使用 named SQL。
- 影响 `init-repo/CLAUDE.md`、`init-repo/backend/actions/README.md`、示例 action 和 SDK 使用指引。
- 可能引入新的平台配置项，例如 action worker 全局上限、单应用队列上限、预算阈值和 idle 回收时间。
