## Context

LocalApp 近期引入 backend contract 和 hosted backend action，是为了让应用获得服务端可信执行能力：权限敏感写入、事务、级联、校验和同步计算。sample-app 的真实验证表明，这个方向的“需求”存在，但当前 hosted action 实现路径存在平台级风险：action 在 worker/VM 中执行应用 JS，但 `ctx.query` / `ctx.mutate` 通过 RPC 回到主进程执行 sql.js/WASM 数据库；当 action 路径触发 `out of memory` 或 `memory access out of bounds` 后，普通 named SQL 也会进入 500 坏状态，需要重启 server 才恢复。

如果 sample-app 已经代表未来复杂应用上限，LocalApp 不需要成为通用 serverless backend 平台。更合理的定位是：提供稳定的应用数据契约、平台 Shell、身份权限、部署版本化、AI host 和受控数据执行能力。应用仍然可以拥有“后端”，但这个后端应是声明式、可校验、由平台执行的 backend contract，而不是应用上传任意 JS runtime。

## Goals / Non-Goals

**Goals:**
- 将 LocalApp 的稳定主路线定义为 named SQL-first backend contract。
- 禁止新上传版本依赖 hosted action 执行应用 JS，避免不稳定 runtime 进入默认链路。
- 保留并强化 schema、migration、named query、named mutation、transaction mutation 作为服务端可信执行能力。
- 为复杂应用提供迁移路径：读模型走 bounded query/JOIN/聚合/分页，写模型走 mutation/transaction mutation/平台内置原语。
- 让 CLI、server upload、init 模板、SDK 和应用协作 skill 都表达同一套边界。

**Non-Goals:**
- 不在本变更中实现 isolated-vm、workerd、Piscina worker pool 或通用 serverless runtime。
- 不在本变更中迁移 sql.js 到原生 SQLite；该方向可作为未来数据库稳定性变更单独评估。
- 不承诺现有 hosted action 继续作为生产稳定能力。
- 不把所有复杂业务逻辑都塞进 SQL；当 SQL 表达不足时，应沉淀平台原语或让前端做预览/编排。

## Decisions

### Decision 1: backend contract 保留，hosted JS runtime 退场

LocalApp 不废弃 backend，而是重新定义 backend：稳定能力是契约文件和平台执行器，包括 schema、migration、named SQL 和 transaction mutation。`backend/actions.*` 不再是默认稳定能力。

替代方案是继续修 hosted action runtime。这个方案理论上可行，但需要同时解决 JS isolate、安全沙箱、worker 池、DB 驱动、熔断、观测和压力验证；对于 sample-app 这个复杂度上限来说，收益不足以覆盖平台复杂度和稳定性风险。

### Decision 2: upload/validate 前置拒绝 action 文件

CLI validate、CLI upload 和 server upload 都必须拒绝新的 action manifest、action bundle 和 action source。server 侧必须复验，避免旧 CLI 或手工请求绕过。

替代方案是仅文档警告或仅运行时禁用。文档警告不能防止未来应用继续踩坑；仅运行时禁用会让开发者到上传后甚至运行时才发现问题，反馈太晚。

### Decision 3: action endpoint 返回稳定禁用错误

对于已经上传过 action 的旧版本，平台不应继续无声执行不稳定 runtime。`POST /serve/:owner/:app/api/actions/:name` 应返回明确错误，例如 `hosted_actions_disabled`，并指向 named SQL / transaction mutation 迁移路径。

替代方案是保留旧版本 action 运行。这个方案兼容性更好，但继续保留“一个请求能污染 named SQL”的风险，与本变更的稳定性目标冲突。

### Decision 4: named SQL-first 要补表达力，而不是只砍能力

禁用 action 后，平台必须让 sample-app 级应用仍然可实现。重点是强化：
- bounded named query：列表、详情、统计、聚合、分页、JOIN。
- named mutation：单步可信写入。
- transaction mutation：多条注册 mutation 的原子执行。
- 平台内置原语：批量导入、级联删除、服务端校验这类常见短事务能力可逐步沉淀，而不是让每个应用写 JS action。

### Decision 5: 模板和应用协作 skill 改为约束生成行为

init 模板、CLAUDE.md、`.agents/skills/localapp-app-loop`、init-repo skills 和 SDK 文档不得再推荐 hosted action。应用 Agent 应默认使用 named SQL-first：只有当平台显式提供原语时才调用平台能力，不能自行上传 JS backend 作为兜底。

## Risks / Trade-offs

- **[Risk] 表达力下降** → **Mitigation**: 保留 transaction mutation，并为导入、级联、校验等常见场景设计平台原语；sample-app 作为迁移验收样板。
- **[Risk] 现有依赖 action 的应用功能中断** → **Mitigation**: action endpoint 返回稳定错误，CLI/文档给出迁移建议；先迁移官方/示例应用。
- **[Risk] 过度 SQL 化导致复杂逻辑难维护** → **Mitigation**: 读模型优先 SQL，交互预览和轻量计算保留在前端；跨多表短写入用 transaction mutation；确实通用的复杂能力沉淀为平台原语。
- **[Risk] 未来仍想恢复 hosted action** → **Mitigation**: 本变更不删除历史讨论；未来必须通过独立 stability gate，包括 isolate/DB/熔断/压力测试，才能重新开放。

## Migration Plan

1. 在 CLI 和 server upload 阶段拒绝 action manifest、bundle 和 action source。
2. 将 action endpoint 改为稳定禁用错误，避免继续执行旧 runtime。
3. 更新 init 模板、SDK 文档、应用协作 skill 和示例，移除 hosted action 推荐。
4. 将 sample-app 导入能力迁移到 named SQL-first 路径，必要时补 transaction mutation 或平台内置导入原语。
5. 运行平台测试、CLI e2e、sample-app/bug-report 应用回归，确认 named SQL、正式入口和 AI 工具链不受影响。

## Decisions

- sample-app 的 create 工作项后创建阶段/备注/计划场景先由 transaction mutation + previous-result reference 表达；暂不新增平台级 batch/import 原语。后续只有当多个应用出现同类批量导入语义时再沉淀通用原语。
- 旧版本 action endpoint 的 HTTP 状态码使用 410 Gone 还是 501 Not Implemented 更利于 SDK 和开发者理解？
