## Purpose

业务状态流转（State Transitions）能力。允许在 schema 业务元数据中声明状态字段和 transitions，作为**前端 SDK 本地计算可用动作的元数据**。状态流转的实际执行由应用在 `backend/resources/<resource>/mutations.json` 中显式声明对应的 named mutation 完成。

服务端不再暴露任何 transition 查询或执行 HTTP 端点。

## Requirements

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
