## Context

LocalApp 已引入 hosted backend action，用于把跨表写事务、审批、级联删除、同步计算和服务端校验等逻辑下沉到平台托管运行时。当前 runtime 通过 Node Worker + `vm.SourceTextModule` 执行 action bundle，并通过 `ctx.query`、`ctx.mutate`、`ctx.transaction` 等能力回到主服务。

这个设计提供了清晰的能力边界，但如果把 action 当作常规应用后端使用，最坏情况下会出现资源放大：并发 action 会创建大量 Worker、VM 上下文和跨线程 structured clone；读模型 action 还会让 SQL 结果在主线程、worker 和响应序列化之间产生多份副本。LocalApp 的轻量优势应来自平台原生能力，而不是为每个应用长期维护一个小后端运行时。

## Goals / Non-Goals

**Goals:**

- 让 hosted action 成为受控增强能力，而不是普通 CRUD 和读模型的默认路径。
- 用资源预算在平台层提前拒绝重型 action，避免底层 worker/VM/WASM 抛出不可读错误。
- 让 worker 数量由平台预算控制，而不是由请求数或应用数直接决定。
- 增强 named SQL 和文档指引，让普通表单、列表、筛选、统计和分页优先走便宜路径。
- 提供足够诊断信息，能解释 action 为什么被排队、拒绝或终止。

**Non-Goals:**

- 不在本变更中切换到 `isolated-vm`、容器或独立进程级 sandbox。
- 不把 hosted action 扩展成长任务、后台任务或通用后端服务。
- 不承诺 action 支持无分页全量读模型、大报表生成或搜索引擎职责。
- 不一次性替换 `sql.js` 存储实现；native SQLite adapter 可作为后续独立变更评估。

## Decisions

### 1. 先限制 action 预算，再优化 worker 生命周期

平台先实现 action 级资源预算：RPC 次数、单次 SQL rows/bytes、累计 SQL rows/bytes、返回 bytes、执行时间。超出预算时返回稳定错误码，例如 `action_rpc_limit_exceeded`、`action_sql_result_too_large`、`action_result_too_large`。

备选方案是先做每应用常驻 worker 或 worker 池。该方案能降低启动成本，但不能解决大对象 structured clone、读模型搬运和无限并发放大的根因。因此预算限制优先级更高。

### 2. worker 调度采用“全局上限 + appKey 队列”

action worker 的创建必须受全局上限约束，例如默认最多 4 或 8 个活跃 worker。请求按 appKey 进入队列，同一应用默认并发为 1，避免同一个应用同时占满资源。超出等待时间或队列长度时返回明确的并发/队列错误。

每应用 worker cache 可以作为优化存在，但必须是预算内的短暂热缓存：按 `{ownerId}/{appName}/{version}` 绑定，idle TTL 后回收，版本变化、超时、资源错误或运行时异常后丢弃。它不能演变成“每个有 backend 的应用都常驻一个 worker”。

### 3. action runtime 继续保留 Worker 隔离

当前 Node Worker 仍作为安全与故障隔离边界。`vm.SourceTextModule` 只负责在 worker 内提供模块加载和 import policy，不把 `node:vm` 单独视作安全边界。

成熟第三方 worker pool 可以在后续实现中评估，但本变更的规格关注调度语义而不绑定 Piscina/Tinypool 等依赖。是否引入三方组件应由实现阶段的复杂度、测试稳定性和运行时兼容性决定。

### 4. named SQL 是默认轻量后端路径

普通列表、详情、筛选、聚合、分页、轻量统计和简单写入应通过 named SQL 表达。需要多条写入原子性的场景优先通过短事务/批量 mutation 能力承载；只有当存在复杂编排、副作用或权限敏感服务端逻辑时才进入 action。

这样做的目的是让 100 个小应用不会因为“包含 backend 能力”而变成 100 个活跃 worker。

### 5. 文档和模板必须改变开发者默认心智

`init-repo` 的示例和指南必须明确 action 的边界：action 适合短事务写逻辑和副作用，不适合全量读模型。示例应展示 named SQL 分页/聚合与 action 短事务写逻辑的组合，而不是暗示所有业务逻辑都应该下沉到 action。

## Risks / Trade-offs

- [Risk] 预算过严会让现有 action 误报失败 → Mitigation: 默认阈值保守，错误消息指向分页、聚合或拆分方案，并允许平台配置覆盖。
- [Risk] 全局 worker 上限会增加高峰请求排队 → Mitigation: 增加队列诊断、超时错误和配置项，先保护服务稳定性，再按部署规模调大预算。
- [Risk] 每应用热 worker cache 可能产生跨请求状态污染 → Mitigation: 若复用 worker，也必须隔离每次执行的 VM context 或在文档中禁止并测试全局状态复用；资源异常后立即丢弃 worker。
- [Risk] named SQL 能力不足会继续迫使开发者滥用 action → Mitigation: tasks 中将 named SQL 分页、预算、短事务/批量变更能力作为同级工作推进。
- [Risk] 诊断字段过多影响日志噪声 → Mitigation: 采用聚合型 finish 事件和可选 debug 级别 RPC 事件，默认记录足够容量判断的信息。

## Migration Plan

1. 先增加预算统计和错误分类，不改变 action API 路径。
2. 为默认阈值选择保守配置，并通过测试覆盖超限路径。
3. 引入全局 worker 调度上限和 appKey 队列，保持原有 action handler 行为不变。
4. 更新 init 模板、示例和文档，引导开发者从重型 action 迁移到 named SQL 分页/聚合。
5. 在日志中观察 action 排队、超限和结果大小，再决定是否引入热 worker cache 或三方 worker pool。

## Open Questions

- 默认 `maxResultBytes` 应设为 512KB、1MB 还是按部署配置决定？
- 单应用 action 并发默认是否固定为 1，还是允许只读 action 并发为 2？
- named SQL 短事务/批量 mutation 是本变更直接实现，还是先定义接口和文档，再拆独立变更？
- 是否需要在管理端暴露 action runtime 指标，还是先只写结构化日志？

## Capacity Defaults

本变更的默认实现以单机轻量部署为目标：action runtime 默认全局最多 8 个活跃 worker、单应用最多 2 个并发 action、队列等待 1 秒。action 默认预算为 100 次 ctx RPC、单次 SQL 1000 rows / 1MB、累计 SQL 5000 rows / 5MB、action 返回体 1MB。named SQL 默认查询结果预算为 1000 rows / 1MB。

这些默认值的意图是让 100 个应用存在时不会产生 100 个常驻后端运行时，只有正在执行 hosted action 的请求占用 worker 预算。轻量表单、分页列表、筛选和聚合应走 named SQL；action worker 预算只用于短事务写逻辑和副作用编排。生产部署可以根据机器规格调大 worker 上限和预算，但不应取消全局上限。
