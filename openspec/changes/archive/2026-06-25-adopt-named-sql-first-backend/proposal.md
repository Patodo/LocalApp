## Why

sample-app 已经代表 LocalApp 未来需要支持的复杂应用上限：它需要复杂列表、导入、阶段计算、权限绑定和协作，但不需要把 LocalApp 变成通用 serverless runtime。近期 hosted action 在真实导入链路中多次触发 `out of memory` / `memory access out of bounds`，且失败后会污染普通 named SQL，说明当前“应用 JS worker + 主进程 sql.js”组合不能作为平台主能力继续扩大。

本变更将 LocalApp 的核心定位收敛为 named SQL-first 的轻量业务应用平台：保留声明式 backend contract 作为服务端可信边界，禁用默认自定义 JS backend runtime，优先保证稳定性、可校验性和可诊断性。

## What Changes

- **BREAKING**: 新上传版本不得新增、修改或启用 hosted backend action；`backend/actions.manifest.json`、`backend/actions.bundle.mjs` 和 action source 将被 upload/validate 拒绝或标记为不支持。
- **BREAKING**: 已上传应用的 action endpoint 不再作为稳定生产能力承诺；平台应返回明确的能力禁用/迁移错误，而不是继续执行不稳定 runtime。
- 将 backend contract 的正式能力定义为 schema、migration、bounded named query、named mutation 和 transaction mutation。
- 强化 named SQL-first 开发路径：复杂读模型走 bounded query、JOIN、聚合、分页和前端局部组装；复杂写入走 transaction mutation 或平台内置批量/导入原语。
- 更新 SDK、init 模板、应用协作 skill 和文档，避免继续教应用开发者编写 hosted action。
- 为 sample-app 这类复杂应用补齐 named SQL-first 所需的平台原语或迁移路径，避免用“说明书约束”替代平台能力。

## Capabilities

### New Capabilities
- `named-sql-first-backend`: 定义 LocalApp 的应用后端主路线：声明式 backend contract 是稳定能力，自定义 hosted JS runtime 不是默认能力。

### Modified Capabilities
- `hosted-backend-actions`: 将 hosted action 从稳定业务动作层降级/禁用，并定义迁移语义。
- `hosted-action-runtime`: 不再要求平台执行 action worker；改为要求禁用时返回稳定、可诊断错误，且不得污染 named SQL。
- `backend-contract-files`: 上传和校验阶段禁止新的 action contract 文件进入稳定应用版本。
- `named-sql-api`: 强化 named query/mutation/transaction mutation 作为服务端可信执行路径。
- `client-sdk`: 移除或弱化 action 调用推荐路径，突出 named SQL 和 transaction mutation API。
- `init-template`: 删除 hosted action 示例，改为展示 named SQL-first 的复杂读写、导入和事务示例。

## Impact

- 影响 server upload、CLI validate/upload/sync、server serve action endpoint、server-core backend contract/action manifest 校验、init-repo 模板、SDK 文档和应用协作 skill。
- 现有依赖 hosted action 的应用需要迁移到 named SQL、transaction mutation 或平台内置原语；sample-app 的导入能力是首个迁移验证对象。
- 平台稳定性风险降低：应用 JS runtime 不再位于默认请求链路，named SQL 失败不应被 action worker/VM/structured clone 路径拖入全局坏状态。
