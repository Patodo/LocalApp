## MODIFIED Requirements

### Requirement: Schema 声明状态流转

系统 SHALL 支持在 schema 业务元数据中声明状态流转配置（`business.transitions`、`business.statusField`、`business.initialStatus`）。该配置 SHALL 作为**前端 SDK 本地计算可用动作的元数据**，前端通过 `client.availableTransitions(resource, record)` 读取并据此渲染 UI。

系统 SHALL NOT 据此声明暴露任何服务端 HTTP 端点（不再有 `/<resource>/:id/transitions` 或 `/<resource>/:id/transitions/:name`）。状态流转的实际执行 SHALL 由应用在 `backend/resources/<resource>/mutations.json` 中显式声明对应的 named mutation 完成。

#### Scenario: 声明状态流转作为前端元数据

- **WHEN** schema 的业务元数据声明 `statusField: "status"` 和名为 `submit` 的 transition
- **THEN** 系统 SHALL 将该声明作为该 schema 的状态流转元数据保存
- **AND** 不得据此暴露任何服务端执行端点
- **AND** 前端 SDK 可通过 `availableTransitions` 计算该 transition 是否可执行

#### Scenario: schema 未声明 transitions

- **WHEN** schema 不包含 transitions 配置
- **THEN** 系统 SHALL 保持现有行为不变
- **AND** 不得要求应用使用状态流转特性

#### Scenario: 前端计算可用 transitions

- **WHEN** 前端 SDK 调用 `availableTransitions(resource, record)` 且 schema 声明了 transitions
- **THEN** SDK SHALL 根据 record 当前状态（由 `statusField` 指示）过滤 transitions 的 `from` 集合
- **AND** 返回当前状态匹配的 transition 列表（含 name、label、to）

## REMOVED Requirements

### Requirement: 查询记录可用 transitions

**Reason**: 服务端 transition 查询端点（`GET /api/<resource>/:id/transitions`）移除。可用动作改由前端 SDK 本地纯函数计算，无需网络请求。

**Migration**: 前端调用 `client.availableTransitions(resource, record)` 取代原 `client.listTransitions(resource, id)`。

### Requirement: 执行状态流转

**Reason**: 服务端 transition 执行端点（`POST /api/<resource>/:id/transitions/:name`）移除。状态流转改由应用在 `mutations.json` 中显式声明对应的 named mutation 实现。

**Migration**: 为每个状态流转声明 named mutation，SQL 中显式校验当前状态（如 `WHERE id=:id AND status='pending'`）并写入目标状态。前端调用 `client.mutate('$<resource>.<action>', { id, ...payload })`。

### Requirement: transition 服务端写入字段

**Reason**: 服务端 transition 执行入口已移除，对应的 `set` 字段写入逻辑也随之消失。

**Migration**: 状态流转的字段写入（如 `approved_at = :now`、`approved_by = :currentUser.id`）改由 named mutation 的 SQL 直接表达。`:now` 和 `:currentUser.id` 等系统变量继续由 named SQL 执行器注入。
