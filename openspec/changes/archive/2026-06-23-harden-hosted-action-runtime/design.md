## Context

hosted backend action 让应用开发者可以把可信业务逻辑下沉到平台托管函数中执行。当前实现会为每次 action 调用创建 Node worker，并在 worker 内通过 `vm.SourceTextModule` 执行上传的 `backend/actions.bundle.mjs`；action 通过 `ctx.query`、`ctx.mutate`、`ctx.transaction` 等 RPC 能力访问平台受控资源。

近期 `sample-app` 的 `workload.listWorkRows` 在小数据量下暴露了 `memory access out of bounds`。本地复查显示数据规模很小，单次 action 直接执行也能成功，因此问题更像是页面普通 named SQL 请求、action 内部 `Promise.all(ctx.query)`、React 重复 effect 和 sql.js/WASM 连接池之间的并发边界不稳，而不是单纯业务数组越界或数据量过大。

当前平台缺少三类护栏：

- 同一 app DB 的 SQL 执行没有 per-db 队列，sql.js/WASM 连接可能被多个异步请求交错访问。
- action worker 与 ctx RPC 没有并发背压，页面误触发或高频 action 会造成 worker 与 SQL 请求风暴。
- worker/VM/structured clone/sql.js 的底层错误没有归因包装，开发者看到的是底层异常而不是平台可解释错误。

## Goals / Non-Goals

**Goals:**

- 保证同一应用数据库上的 named SQL、action ctx SQL 和事务执行具有稳定的串行化边界。
- 限制同一应用的 action 并发，避免 worker 风暴拖垮 server 或 DB runtime。
- 将 worker、VM、structured clone 和 sql.js/WASM 错误包装为可诊断、状态码稳定的错误响应。
- 为 action 执行增加最低限度可观测性，便于定位 action 名称、RPC 次数、SQL 执行耗时、payload 粗略大小和资源退出原因。
- 保持 action worker 隔离模型，继续禁止应用 action 直接访问 Node、网络、文件系统或数据库连接。
- 更新模板和开发者说明，明确 action 适合短事务写逻辑，不适合无分页全量读模型。

**Non-Goals:**

- 不把应用 action 改成主线程直接 import 执行。
- 不在本变更中引入新的数据库引擎替换 sql.js。
- 不实现通用 read model/materialized view 框架。
- 不保证无分页的大型读模型 action 可以无限制运行。
- 不修改应用业务代码；`sample-app` 的适配由下游应用继续处理。

## Decisions

### Decision 1: 对同一 dbPath 的数据库操作引入串行队列

所有通过 server-core app DB 层访问同一 `dbPath` 的操作必须进入同一个队列，包括 named query、named mutation、action ctx query/mutate、事务、issue 表操作和保存导出。这样可以避免 sql.js 的同一 WASM database 对象被多个异步流程交错访问。

备选方案：

- 只在 action ctx.query 内串行化：无法覆盖页面普通 named SQL 与 action 同时访问同一 DB 的情况。
- 为每个请求创建独立 sql.js Database：能减少对象共享，但写入冲突、读写一致性和导出覆盖问题更复杂，且性能更差。
- 迁移到 native SQLite：方向可能更稳，但涉及依赖、部署和数据层重构，不适合作为本次止血优化。

### Decision 2: action RPC 不直接并发打 DB，交给 DB 队列做背压

action 内仍允许开发者写 `Promise.all([ctx.query(...), ...])`，但主线程处理 RPC 时，所有 DB 相关 RPC 最终都通过 per-db 队列执行。这样应用代码的并发表达不会绕开平台的执行边界。

备选方案：

- 禁止 action 内 `Promise.all(ctx.query)`：难以静态判断，开发体验差。
- 在 worker 内把 ctx.query 自动串行化：只能约束单个 action，不能约束 action 与页面普通 query 的并发。

### Decision 3: 同一应用 action 调用增加并发上限

按 `{ownerId}/{pageName}` 维护 action 执行队列或 semaphore。默认同一应用最多允许少量 action 并发；超出时排队等待，等待过久返回明确错误。这样限制 worker 数、RPC 风暴和 DB 队列堆积。

备选方案：

- 全局 action 并发限制：实现简单，但容易让一个应用影响所有应用。
- 完全不限制 action 并发，仅调大 worker 内存：无法处理页面误触发或恶意高频调用。

### Decision 4: 错误归因按来源分层包装

新增统一错误分类：

- `action_timeout`: action 超时。
- `action_resource_limit`: worker 内存、worker 异常退出或 structured clone 资源失败。
- `action_runtime_error`: action 代码抛出的普通错误。
- `db_runtime_error`: sql.js/WASM 运行时错误，包括 `memory access out of bounds`。
- `db_contract_error`: named SQL 未注册、参数错误、权限错误或 SQL 校验错误。

HTTP 响应继续保持 `{ success: false, error }`，但错误文案必须面向开发者可读，不泄漏底层 WASM/VM 栈作为主错误信息。测试可在内部断言错误分类，外部响应只需稳定。

备选方案：

- 原样透传底层错误：排查快，但开发者误判概率高，且暴露内部实现。
- 所有错误统一为 500：稳定但不可诊断。

### Decision 5: 增加轻量 action 观测指标，不引入新依赖

先使用现有 logger 或内存内结构记录 action 执行摘要：action name、app key、耗时、RPC 次数、每个 DB RPC rows/bytes/ms、DB queue wait、worker exit code、错误分类。测试中通过可注入 logger 或返回内部事件验证，不引入外部 metrics 系统。

备选方案：

- 直接接入 Prometheus/OpenTelemetry：长期可选，但超出当前项目依赖和部署复杂度。
- 不记录指标：无法解释下一次类似问题。

### Decision 6: 文档明确 action 与读模型边界

模板文档应强调 backend action 是平台托管短事务逻辑，不是应用自建后端，也不是无分页全量 read model 容器。复杂读模型优先使用 named SQL 的过滤、JOIN、聚合、分页，或前端基于分页数据组装。

## Risks / Trade-offs

- [Risk] per-db 队列会降低同一应用并发查询吞吐。
  → Mitigation: sql.js 本身不是服务型并发数据库；稳定性优先。后续可对只读查询引入快照副本或 native SQLite。

- [Risk] action 并发排队可能让高频应用感知到延迟。
  → Mitigation: 设置合理默认并发和等待超时，并在错误中提示重试或拆分调用。

- [Risk] 错误包装过度会隐藏调试细节。
  → Mitigation: 外部错误文案保持安全可读，内部日志记录原始错误 name/message/stack 摘要。

- [Risk] 运行时指标可能增加少量序列化成本。
  → Mitigation: 只记录 rows、payload 字节估算、耗时和错误分类，不记录完整结果。

- [Risk] 本地 mini-server 与生产 server 行为漂移。
  → Mitigation: 将核心逻辑放在 server-core，生产与 init-repo runtime 共用；新增两侧集成测试。

## Migration Plan

1. 在 server-core 增加 per-db 队列和 action 并发控制，保持对现有 API 透明。
2. 将 worker/VM/sql.js 错误映射为 `ActionError` 或 named SQL 错误响应。
3. 增加单元测试与集成测试，覆盖 action 内并发 ctx.query、页面 query 与 action 同时访问、WASM 错误包装、action 并发排队。
4. 更新 init-repo runtime 与文档，重新构建 CLI 后通过 `localapp sync` 下发。
5. 回滚时可关闭 action 并发队列，但 per-db SQL 队列不应回滚，除非出现明确性能退化且有替代保护。

## Open Questions

- 默认 action per-app 并发上限采用 2 还是 4，需要根据本地压测和应用交互体验确定。
- DB 队列等待超时默认值采用 5 秒还是 10 秒，需要和 action 总超时协调。
- 是否在响应体中暴露机器可读错误码，还是仅内部日志记录分类。
