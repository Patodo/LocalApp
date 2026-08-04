## Context

LocalApp 引入 hosted backend action 的初衷，是为纯前端应用补上服务端可信业务逻辑：权限敏感写入、短事务、级联删除、状态流转、服务端校验和通知编排。近期下游将全量读模型 `listWorkRows` 下沉到 action 后，平台出现 `memory access out of bounds`，重启 server 才恢复。这暴露出两个架构问题：action 的定位没有被平台机制强制约束，named SQL/result budget 的保护也发生在 SQL 结果已经完整物化之后。

当前路径中，普通 named SQL 是 server 主线程查询后直接响应；action 则会经过 worker、RPC、structured clone 和二次组装。同样的 SQL 结果，action 路径会产生更多对象副本和更低的 worker 内存上限。因此不能把 action 视为通用后端服务，更不能让应用在 action 中自由拉取多张表并返回全量读模型。

## Goals / Non-Goals

**Goals:**

- 把 hosted backend 的边界从文档约定变成 contract、upload 校验和运行时强制。
- 让 action 默认成为 command/短事务层，而不是普通读模型层。
- 让 action 只能调用 manifest `uses` 声明过的 named SQL。
- 让 action 引用的 named query 必须是 bounded query，包括分页、单行、聚合或显式预算。
- 在 CLI validate、CLI upload 和 server upload 三处提前拒绝明显危险的 action/query 组合。
- 在 named SQL 执行阶段前置结果预算，避免完整物化大结果后才检查。
- 保留 named SQL 作为列表、详情、筛选、统计和分页读模型的默认路径。

**Non-Goals:**

- 不在本变更中实现独立应用后端服务、常驻 app worker 或通用 serverless 平台。
- 不在本变更中引入外部数据库、ORM 或新的 SQL 引擎。
- 不在本变更中解决所有复杂报表需求；复杂读模型先通过 bounded named SQL、聚合和分页表达。
- 不要求立即迁移所有历史应用，但新上传版本必须通过更严格校验。

## Decisions

### Decision 1: action 增加类型与用途约束

Action manifest 增加可选 `type` 字段，默认值为 `command`。`command` 表示短事务业务动作，平台允许其调用 mutation，并只允许在显式声明且 query 有界时调用 query。后续可扩展 `event` 或其它类型，但第一阶段不引入通用 `query action`。

备选方案是只增强文档，不改 manifest。这个方案会继续依赖开发者自律，无法阻止全量读模型 action 上传，因此不采用。

### Decision 2: `uses` 从说明性元数据变成强制授权清单

Action 运行时不再允许 `ctx.query(name)` 和 `ctx.mutate(name)` 调用任意 named SQL。运行时根据 action manifest 中的 `uses.queries` 和 `uses.mutations` 建立白名单，未声明调用返回稳定错误。SDK/模板可以据此生成更窄的 ctx 类型，但运行时校验是最终边界。

备选方案是在构建时静态扫描源码中的 `ctx.query("...")`。静态扫描可以作为提示，但无法覆盖动态字符串、间接调用或混淆后的 bundle，因此不能作为唯一机制。

### Decision 3: named query 必须声明可执行的结果形态

Named query 增加 `result` 声明，至少覆盖：

- `mode: "page"`：必须有 `limit` 和可选 `offset/cursor` 参数，平台强制最大行数。
- `mode: "single"`：最多返回一行。
- `mode: "aggregate"`：用于计数、分组、合计等聚合结果，必须有明确预算。
- `mode: "bounded"`：保留兼容出口，但必须声明 `maxRows` 和 `maxBytes`。

Action 引用 query 时，query 必须有 `result` 声明并通过 bounded 校验。普通前端直接调用 named query 也受运行时预算保护。

备选方案是自动推断所有 query 是否有界。SQL 静态分析在 CTE、子查询和动态条件下容易误判，因此采用“显式声明 + 保守静态规则 + 运行时预算”的组合。

### Decision 4: upload 阶段进行双端校验

CLI 在 `localapp upload` 前校验 backend contract，server 在 `/api/upload` 保存新版本前复验。server 复验是为了防止旧 CLI、手工请求或未来工具绕过本地校验。

校验规则包括：

- action 调用 query 但未声明在 `uses.queries` 中，拒绝。
- action 引用的 query 缺少 `result`，拒绝。
- action 引用 `mode: "page"` query 但 SQL 无 `LIMIT` 或缺少 limit 参数，拒绝。
- action 引用普通 `SELECT *` 且无分页/过滤预算，拒绝。
- action manifest 的 bundle 路径必须在 backend root/include 范围内，且对应文件存在。

### Decision 5: 运行时预算前置到 SQL 读取过程

当前 `execRawSql` 通过 `db.exec()` 一次性取回所有结果，再估算 rows/bytes。新的执行路径对 query 使用 prepared statement 逐行 `step()`，达到 `maxRows + 1` 或 `maxBytes` 后立即停止并返回 `named_sql_result_too_large`。这样预算成为内存保护，而不是事后诊断。

备选方案是在 SQL 外层自动包一层 `LIMIT`。这对简单 SELECT 有效，但对已有 LIMIT、WITH、聚合、排序和子查询不够稳定；因此第一阶段以逐行读取为主，必要时对 `page` query 辅助验证 SQL 中存在 LIMIT。

### Decision 6: 保留 action worker 隔离，不把读模型搬进 worker

Worker 仍然作为不可信应用代码的 sandbox。问题不是“worker 存在”，而是平台让读模型进入 worker 做全量组装。设计上应让普通读模型走 named SQL/view，worker 只处理业务动作。

## Risks / Trade-offs

- 兼容性风险：已有 action 可能因为未声明 `uses` 或 query 无界而上传失败。缓解：提供清晰错误、迁移指南和模板示例，必要时先提供 warn 模式但 server 生产 upload 默认 hard fail。
- SQL 静态校验误判：复杂但安全的 SQL 可能被拒绝。缓解：允许开发者通过 `result` 显式声明预算，并在运行时用逐行预算兜底。
- 实现复杂度上升：CLI、server、server-core 和模板都要同步。缓解：先抽象共享 contract 校验逻辑，CLI Rust 保留轻量等价规则，server-core 作为最终权威。
- 性能权衡：逐行读取比 `db.exec()` 代码更复杂，极小结果集可能略慢。缓解：只在 named query 路径启用预算读取，mutation 维持现有路径。
- 开发者体验变化：action 不再像万能后端。缓解：SDK 生成窄 ctx、错误提示指向 bounded named SQL、init 模板展示正确写法。

## Migration Plan

1. 扩展 backend contract 类型与解析，接受 action `type` 和 named query `result`。
2. 在 validate/upload 中先对新字段做 warn + 测试覆盖，再切换为 hard fail。
3. 更新 init 模板、内置 SDK 和 backend 示例，展示 command action + bounded named query。
4. 调整 sample-app 等应用示例，把读模型保留在分页/聚合 named SQL 或前端局部组装路径。
5. 发布新版 CLI，要求下游执行 sync 后再上传。

回滚策略：保留旧字段解析兼容；若 hard fail 影响过大，可通过平台配置临时降级为 warning，但运行时前置预算不可关闭。

## Open Questions

- 是否需要为 `mode: "bounded"` 设置平台默认上限，例如 `maxRows <= 1000`、`maxBytes <= 1MB`？
- 是否在第一阶段就生成强类型 `ctx.queries.*` / `ctx.mutations.*`，还是先做运行时白名单？
- 是否需要专门的 `projection/view` contract 来承接复杂读模型，还是先用 named SQL 聚合和分页覆盖？
