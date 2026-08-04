## MODIFIED Requirements

### Requirement: 模板示例展示业务模型和权限判断

模板的 work_items 示例 SHALL 通过完整声明 named SQL 展示业务应用建模的标准形态。示例 SHALL 包含覆盖完整 CRUD 操作的 6 条 named SQL：
- `$work_items.list`（query，支持 offset/limit/sort/order/filters）
- `$work_items.get`（query，按 id）
- `$work_items.count`（query，支持 filters）
- `$work_items.create`（mutation，覆盖所有业务字段，`created_by_member_id` 通过子查询从当前用户推导）
- `$work_items.update`（mutation，按 id 部分更新）
- `$work_items.delete`（mutation，按 id）

示例 SHALL NOT 依赖任何 REST CRUD 路径或 SDK fallback 行为。模板内任何文档/skill 引用 SHALL 明确说明"所有数据操作必须通过 named SQL"。

#### Scenario: 模板含完整 named SQL 声明

- **WHEN** 应用从模板初始化后查看 `backend/resources/work_items/`
- **THEN** SHALL 看到 `queries.json` 含 `$work_items.list` / `$work_items.get` / `$work_items.count`
- **AND** SHALL 看到 `mutations.json` 含 `$work_items.create` / `$work_items.update` / `$work_items.delete`

#### Scenario: 模板 SDK 调用走 named SQL

- **WHEN** 示例前端代码调用 `client.list('work_items')` 或 `client.create('work_items', data)`
- **THEN** 调用路径 SHALL 命中对应的 named SQL（`$work_items.list` / `$work_items.create`）
- **AND** 不得触发任何 REST CRUD fallback

### Requirement: 模板示例展示 transition UI 模式

模板的 work_items 示例 SHALL 展示基于 named SQL + 前端 SDK 本地计算的状态流转 UI 模式。示例 SHALL：
- 在 `schema.json` 声明 `business.transitions` 作为前端元数据
- 在 `mutations.json` 声明对应的 named mutation（如 `$work_items.approve`）作为实际执行入口
- 前端代码使用 `client.availableTransitions('work_items', record)` 计算当前可执行动作
- 前端代码使用 `client.mutate('$work_items.<action>', { id })` 执行流转

示例 SHALL NOT 使用任何已移除的 transition 端点（`GET /api/<resource>/:id/transitions` 等）。

#### Scenario: 模板展示状态机声明与执行分离

- **WHEN** 应用从模板初始化后查看 work_items 的状态流转实现
- **THEN** SHALL 在 `schema.json` 看到 `business.transitions` 声明（前端元数据用途）
- **AND** SHALL 在 `mutations.json` 看到对应的 named mutation（含 SQL 状态守卫）
- **AND** SHALL 在前端代码看到 `availableTransitions` + `mutate` 的组合调用

## REMOVED Requirements

### Requirement: 模板 CLAUDE.md 补充 Raw SQL 文档

**Reason**: Raw SQL 端点已移除。模板 CLAUDE.md 不再需要 Raw SQL 文档章节。

**Migration**: 模板 CLAUDE.md 应包含 named SQL 完整使用指引，覆盖 list/get/create/update/delete/count 6 条标准 named SQL 的声明与调用方式。

### Requirement: 模板包含状态流转开发指引

**Reason**: 该 requirement 描述的是基于服务端 transition 端点的开发指引。transition 端点移除后该指引内容失效。

**Migration**: 模板的状态流转指引应改为"基于 named SQL + SDK `availableTransitions` 的两段式实现"指引，覆盖：(1) 在 schema 声明 transitions 元数据；(2) 在 mutations.json 声明对应 named mutation；(3) 前端用 `availableTransitions` 计算 + `mutate` 执行。
