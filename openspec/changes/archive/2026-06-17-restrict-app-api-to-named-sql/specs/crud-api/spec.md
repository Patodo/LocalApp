## REMOVED Requirements

### Requirement: CRUD API 路由

**Reason**: 应用层数据通道统一为 named SQL。隐式 REST CRUD 端点（`GET/POST /api/<resource>`、`GET/PUT/DELETE /api/<resource>/:id`、`GET /api/<resource>/count`）全部移除，避免与 named SQL 形成双协议。

**Migration**: 应用必须为每个 resource 在 `backend/resources/<resource>/queries.json` 和 `mutations.json` 中声明对应的 named SQL（`$<resource>.list` / `$<resource>.get` / `$<resource>.create` / `$<resource>.update` / `$<resource>.delete` / `$<resource>.count`）。SDK helper 内部调用这些 named SQL。

### Requirement: CRUD API 访问控制

**Reason**: REST CRUD 端点移除后，原路由级访问控制（基于 schema.routeAccess）失去载体。访问控制改由 named SQL 的 `access` 字段在声明层执行。

**Migration**: 在 `backend/resources/<resource>/{queries,mutations}.json` 中为每个 named SQL 声明 `access` 字段（如 `"access": "owner"` / `"access": "authenticated"`）。SDK 通过 named SQL 调用时自动应用。

### Requirement: CRUD 创建记录时填充当前用户字段

**Reason**: REST POST 端点移除。当前用户字段填充改由 named mutation 的 SQL 内部直接引用系统变量（如 `:currentUser.id`）实现。

**Migration**: 在 `$<resource>.create` mutation 的 SQL 中直接使用 `:currentUser.id` / `:currentUser.name` 系统变量。例如 `INSERT INTO work_items (..., created_by) VALUES (..., :currentUser.id)`。

### Requirement: CRUD 列表查询应用记录级读权限

**Reason**: REST list 端点移除。记录级读权限改由 named query 的 SQL WHERE 子句或 access 字段实现。

**Migration**: 在 `$<resource>.list` query 的 SQL 中显式加入读权限过滤（如 `WHERE owner_field = :currentUser.id`），或将 query 声明为 `"access": "owner"`。

### Requirement: CRUD 单条写操作应用记录级权限

**Reason**: REST PUT/DELETE 端点移除。记录级写权限改由 named mutation 的 SQL WHERE 子句或 access 字段实现。

**Migration**: 在 `$<resource>.update` / `$<resource>.delete` mutation 的 SQL 中显式加入权限过滤，或将 mutation 声明为 `"access": "owner"`。

### Requirement: CRUD API 提供 transition 查询端点

**Reason**: transition 服务端执行入口移除。transitions 降级为前端元数据，由 SDK 本地纯函数计算可用动作。

**Migration**: 前端调用 `client.availableTransitions(resource, record)`（SDK 新增）本地计算当前可执行 transitions，取代原 `client.listTransitions(resource, id)` 网络请求。

### Requirement: CRUD API 提供 transition 执行端点

**Reason**: transition 服务端执行入口移除。状态流转改由应用自行声明对应的 named mutation。

**Migration**: 为每个状态流转在 `mutations.json` 中声明对应的 named mutation（如 `$work_items.approve`），SQL 中显式校验当前状态和写入新状态。前端调用 `client.mutate('$<resource>.<action>', { id, ...payload })`。

### Requirement: transition 执行复用 CRUD 字段校验

**Reason**: transition 执行入口已移除，对应的字段校验逻辑也随之消失。

**Migration**: 状态流转的字段约束改由 named mutation 的 SQL 直接表达（如 enum 校验在 WHERE 子句中、required 字段在 INSERT 列表中）。

### Requirement: CRUD API 的字段元数据从 manifest.business 读取

**Reason**: REST CRUD 端点移除，对应的字段约束下沉逻辑（`applyBusinessFieldConstraints`）失去消费者。

**Migration**: 字段约束（`defaultValue` / `defaultFrom` / `enum`）改由 named SQL 直接表达。schema 中的 `business.defaultFields` / `business.enums` 可作为前端表单生成的元数据，不再由服务端中间件强制。

### Requirement: CRUD count 与 list 的过滤和权限一致

**Reason**: REST count 和 list 端点同时移除，原一致性约束失去对象。

**Migration**: 应用在 `$<resource>.count` 和 `$<resource>.list` 两个 named SQL 中自行保持 WHERE 子句一致。

### Requirement: 保留平台端点优先级

**Reason**: 该 requirement 描述的是 CRUD 路由匹配不能吞掉平台端点（如 `/api/time`）。CRUD 路由移除后，平台端点优先级问题不再存在——所有保留的端点（time/me/users/groups/platform/_schemas/content）都是显式声明的，不存在路由冲突。

**Migration**: 无需替代。平台端点保留并继续按现有路径提供服务。

## MODIFIED Requirements

### Requirement: CRUD HTTP 契约由共享层定义

应用 API 路由匹配（`matchAppApiRoute`）SHALL 仅识别以下端点类别：平台辅助（time/me/users/groups/groups/:id/platform/*）、内容（content/upload、content/:key）、schemas 自省（_schemas）、named SQL（queries/:name、mutations/:name）。路由匹配 SHALL NOT 识别 resource 风格的隐式 CRUD 路径（`/<resource>`、`/<resource>/:id`、`/<resource>/count`、`/<resource>/:id/transitions`、`/<resource>/:id/transitions/:name`）、raw SQL（`/db/exec`）或 legacy upload（`/upload`）。

CRUD HTTP 契约的共享层 SHALL 继续被生产 server 和 dev mini-server 共享，确保两端行为一致。

#### Scenario: 未识别路径返回 404

- **WHEN** 请求到达 `/serve/{user}/{app}/api/<unknown_resource>`
- **AND** 该路径不匹配任何已注册的 named SQL 或平台端点
- **THEN** 系统 SHALL 返回 HTTP 404
- **AND** 不得回落到隐式 CRUD 路由

#### Scenario: dev 与 prod 行为一致

- **WHEN** 同一应用在 dev 模式（mini-server）和 prod 模式（生产 server）下被访问
- **THEN** 两端 SHALL 返回相同的 API 表面
- **AND** 都不得暴露 REST CRUD 路径

#### Scenario: 平台端点优先级保留

- **WHEN** 请求到达 `/serve/{user}/{app}/api/time` 或 `/serve/{user}/{app}/api/me`
- **THEN** 系统 SHALL 走平台辅助端点
- **AND** 不得被任何 resource 路径匹配拦截
