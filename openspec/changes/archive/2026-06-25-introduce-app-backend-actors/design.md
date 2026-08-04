## Context

LocalApp 当前稳定路线是 named SQL-first：应用通过 backend contract 声明 schema、migration、bounded named query、named mutation 和 transaction mutation，由平台直接执行可信数据操作。这个模型稳定、可校验、容易诊断，但它不能优雅覆盖所有后端编排需求。

复杂应用仍可能需要：
- 调用平台 AI 能力做结构化抽取、分类和建议。
- 在一个可信命令中串联权限校验、named SQL、文件、通知和审计。
- 对导入、同步、批量处理做短任务编排。
- 与受 allowlist 限制的外部系统交互。

旧 hosted action 的问题不是“应用需要后端”这个需求本身，而是“每次请求临时 worker + 应用 JS 任意执行 + 主进程 sql.js RPC + 不清晰资源边界”的实现方式。App Backend Actor 试图保留受控后端编排价值，同时避免把 LocalApp 推向通用 serverless 平台。

```
默认应用:

Browser/App ──▶ Platform API ──▶ named SQL / transaction mutation

声明 backend actor 的应用:

Browser/App ──▶ Platform API ──▶ App Backend Actor ──▶ ctx.db / ctx.ai / ctx.storage / ctx.notify
                                      │
                                      ├─ app/version scoped
                                      ├─ lazy start
                                      ├─ idle recycle
                                      └─ resource budget + audit
```

## Goals / Non-Goals

**Goals:**
- 让 named SQL 继续作为默认后端路径，不声明 actor 的应用不得产生 actor 成本。
- 为显式声明 backend 的应用提供受控后端编排单元。
- 通过 `ctx` API 限制 actor 能力，避免任意后端扩张。
- 在 upload/validate 阶段尽早发现 actor bundle、权限、能力和资源声明问题。
- 提供可观测、可熔断、可回收的 actor 生命周期。
- 用真实应用验证 actor 不会污染 named SQL 主路径。

**Non-Goals:**
- 不恢复旧 hosted action API 或 action manifest。
- 不允许应用监听端口、直接打开数据库、任意读写文件系统或默认访问外网。
- 不在本变更中承诺具体 sandbox 依赖一定采用 Node worker_threads、isolated-vm、workerd 或进程隔离。
- 不把所有复杂逻辑都迁入 actor；常规 CRUD、列表、短事务仍应使用 named SQL。
- 不实现无限后台任务、队列系统或通用 PaaS。

## Decisions

### Decision 1: actor 是显式声明的高级能力，不是默认路径

应用必须在 manifest/backend contract 中声明 `backend.actor` 或等价配置后，平台才会打包、校验和运行 actor。未声明 actor 的应用只有 named SQL、content、platform primitives 等默认能力。

替代方案是为每个应用默认创建 actor。该方案简化调用模型，但会让简单表单应用也承担运行时成本，并削弱 LocalApp 轻量平台定位。

### Decision 2: actor 按 app/version 管理生命周期

actor 实例以 `{owner, app, version}` 为隔离键懒加载，空闲超时后回收。平台 MAY 对同一 app/version 保留一个 actor，也 MAY 在压力下重建 actor，但 MUST 保证 actor 不持有唯一真实状态。

```
request ─▶ lookup actor ─┬─ cold start ─▶ handle command
                         └─ warm actor ─▶ handle command

idle timeout ─▶ graceful dispose
version switch ─▶ old actor drain/dispose, new version cold start
```

替代方案是每个请求创建 worker。该方案隔离更强，但启动开销、structured clone 成本和错误抖动更大，已经在旧 runtime 中暴露风险。

### Decision 3: ctx 是唯一能力边界

actor 不获得直接 Node 后端权限，只能通过平台传入的 `ctx` 调用能力：
- `ctx.auth`: 当前用户、owner、groups、roles、权限断言。
- `ctx.db`: registered named query/mutation/transaction，禁止 raw SQL 和直接 DB 文件访问。
- `ctx.storage`: 应用内容文件，带大小、类型、quota 限制。
- `ctx.ai`: 平台统一 AI 能力，带 token/cost/timeout/audit。
- `ctx.http`: 默认关闭，manifest 声明 allowlist 后才可用。
- `ctx.notify`: 平台通知原语。
- `ctx.job`: 可选短任务/导入进度原语，必须有超时和状态边界。
- `ctx.cache`: app/version scoped、TTL、内存预算内的小缓存。
- `ctx.log` / `ctx.audit`: 结构化日志和审计。

替代方案是允许 actor 使用普通 Node API。该方案开发体验更自由，但会把平台变成通用后端托管，破坏权限、资源和审计边界。

### Decision 4: actor command 必须有契约

actor 对外暴露 command，而不是任意 HTTP route。每个 command MUST 声明：
- name
- input schema
- output schema 或 result budget
- access level / ACL
- required capabilities
- timeout / memory / response size budget

SDK 调用应是 `client.command("name", input)` 或类似受控入口，而不是直接构造 actor URL。

### Decision 5: upload/validate 先做能力预检

平台必须在上传阶段拒绝明显不安全或不可运行的 actor：
- 未声明 capabilities 却使用相应 ctx 能力。
- bundle 超过大小限制。
- command 缺少 input/output/access 契约。
- 声明外网访问但没有 allowlist。
- 使用禁用模块、动态导入或直接文件/网络/DB API。
- 资源预算超过平台上限。

静态分析不能证明所有安全性，因此运行时仍必须强制执行同一能力边界。

### Decision 6: actor 失败不得污染 named SQL 主路径

actor runtime 错误、内存超限、超时或崩溃 MUST 返回结构化错误，例如 `backend_actor_timeout`、`backend_actor_memory_exceeded`、`backend_actor_crashed`。这些错误不得让同一应用的 named query/mutation 进入坏状态。平台 MUST 能熔断或回收异常 actor。

### Decision 7: 先做 spike，再定 sandbox 选型

实现前应先做小型 spike，对比至少三类方案：
- Node `worker_threads` + 严格 ctx RPC。
- `isolated-vm` 或类似 V8 isolate。
- 进程级 worker / workerd 风格运行时。

评价维度包括启动成本、内存边界、崩溃隔离、bundle 格式、Node API 暴露控制、依赖复杂度、macOS 本地开发兼容和生产部署复杂度。

## Risks / Trade-offs

- **[Risk] actor 变成任意后端逃逸口** → **Mitigation**: 只暴露 ctx 能力，默认关闭 HTTP/文件/DB/raw SQL，upload 和 runtime 双重校验。
- **[Risk] 资源成本上升** → **Mitigation**: 只有声明 actor 的应用才启动，按 app/version 懒加载，空闲回收，限制并发和内存。
- **[Risk] actor 与 named SQL 主路径互相污染** → **Mitigation**: actor 只通过受控 ctx 调用平台能力，运行时错误结构化包装，异常 actor 可熔断回收。
- **[Risk] 复杂应用仍把大读模型塞进 actor** → **Mitigation**: 文档和 validate 强调 bounded named query、分页和 SQL 聚合；actor response size 有预算。
- **[Risk] sandbox 选型过早锁死** → **Mitigation**: 第一阶段只定义契约和 spike，正式实现前通过性能/稳定性 gate。

## Migration Plan

1. 定义 actor manifest/command schema、ctx API 和错误码。
2. 添加 upload/validate 失败测试，覆盖未声明能力、过大 bundle、缺少 command 契约、禁用 API。
3. 做 runtime spike，对比 worker_threads、isolate、进程级方案。
4. 实现最小 actor manager：按 app/version 懒加载、调用 command、超时、回收、结构化错误。
5. 接入最小 ctx：auth、db.query/mutate/transaction、log/audit。
6. 再逐步接入 storage、AI、notify、HTTP allowlist、job/cache 等可选能力。
7. 用一个真实应用场景验证 actor：例如 AI 辅助导入或 bug-report AI 结构化填报，而不是把 sample-app 的普通 CRUD 迁回 actor。

## Open Questions

- 第一版 actor runtime 选型应优先 worker_threads 还是进程级隔离？
- actor 是否允许引入第三方 npm 依赖？若允许，依赖应在 CLI build 阶段 bundle 进单文件，还是平台侧安装？
- `ctx.http` 的 allowlist 是否按域名、URL pattern 还是 manifest capability 名称声明？
- actor command 的 input/output schema 使用 JSON Schema，还是沿用现有 backend contract schema 子集？
- actor 是否需要支持 streaming/progress，还是第一版仅支持短请求 command？
