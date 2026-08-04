## MODIFIED Requirements

### Requirement: useList Hook

`useList<T>(resource, options?)` Hook SHALL 调用 `client.query('$<resource>.list', params)` 获取列表数据。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

未声明 `$<resource>.list` named SQL 时，Hook SHALL 直接抛出 `LocalAppError`（status 为服务端返回的 404，message 含 named SQL 名字），不得隐式切换到其它路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.list` named SQL 且参数合法
- **THEN** useList SHALL 调用该 named SQL 并返回 rows + pagination

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.list` named SQL
- **THEN** useList SHALL 抛出 LocalAppError
- **AND** 错误信息 MUST 提示该 named SQL 缺失
- **AND** 不得发起任何 REST CRUD 请求

### Requirement: useGet Hook

`useGet<T>(resource, id)` Hook SHALL 调用 `client.query('$<resource>.get', { id })` 获取单条记录。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.get` named SQL 且参数合法
- **THEN** useGet SHALL 返回该记录

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.get` named SQL
- **THEN** useGet SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `GET /api/<resource>/:id`

### Requirement: useCreate Hook

`useCreate<T>(resource)` Hook 返回的 mutate 函数 SHALL 调用 `client.mutate('$<resource>.create', data)`。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.create` named SQL 且参数合法
- **THEN** useCreate SHALL 返回新建记录

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.create` named SQL
- **THEN** useCreate SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `POST /api/<resource>`

### Requirement: useUpdate Hook

`useUpdate<T>(resource)` Hook 返回的 mutate 函数 SHALL 调用 `client.mutate('$<resource>.update', { id, ...data })`。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.update` named SQL 且参数合法
- **THEN** useUpdate SHALL 返回更新后的记录

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.update` named SQL
- **THEN** useUpdate SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `PUT /api/<resource>/:id`

### Requirement: useDelete Hook

`useDelete(resource)` Hook 返回的 mutate 函数 SHALL 调用 `client.mutate('$<resource>.delete', { id })`。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.delete` named SQL 且参数合法
- **THEN** useDelete SHALL 完成删除

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.delete` named SQL
- **THEN** useDelete SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `DELETE /api/<resource>/:id`

### Requirement: useCount Hook

`useCount(resource, filters?)` Hook SHALL 调用 `client.query('$<resource>.count', filters)` 获取计数。Hook SHALL NOT 在 named SQL 失败时 fallback 到 REST CRUD 路径或 list-then-count 路径。

#### Scenario: 命名 SQL 已声明

- **WHEN** 应用声明了 `$<resource>.count` named SQL 且参数合法
- **THEN** useCount SHALL 返回数字类型的计数

#### Scenario: 命名 SQL 未声明

- **WHEN** 应用未声明 `$<resource>.count` named SQL
- **THEN** useCount SHALL 抛出 LocalAppError
- **AND** 不得 fallback 到 `GET /api/<resource>/count` 或 list 模拟计数

## ADDED Requirements

### Requirement: availableTransitions 纯函数

SDK SHALL 提供 `availableTransitions(resource, record)` 纯函数，根据 schema 的 `business.transitions` 元数据结合 record 当前状态本地计算可执行的 transitions 列表。

函数 SHALL：
- 从 schema 读取 `business.transitions` 和 `business.statusField`
- 取 record 中 `statusField` 指示的当前状态
- 过滤 `from` 数组包含当前状态的 transitions
- 返回 `[{ name, label, to }]` 列表

函数 SHALL NOT 发起任何网络请求。所有计算在客户端完成。

#### Scenario: 当前状态匹配多个 transitions

- **WHEN** record 当前状态为 `pending`
- **AND** schema 声明了 `approve`（from: ["pending"]）和 `reject`（from: ["pending"]）两个 transitions
- **THEN** 函数 SHALL 返回 `[{ name: "approve", ... }, { name: "reject", ... }]`

#### Scenario: 当前状态无可用 transition

- **WHEN** record 当前状态为 `approved`
- **AND** schema 声明的 transitions 中没有任何 `from` 包含 `approved`
- **THEN** 函数 SHALL 返回空数组

#### Scenario: schema 未声明 transitions

- **WHEN** schema 不包含 `business.transitions`
- **THEN** 函数 SHALL 返回空数组
- **AND** 不得抛出错误

## REMOVED Requirements

### Requirement: LocalAppClient.exec 方法

**Reason**: 原始 SQL 端点（`POST /api/db/exec`）已移除。SDK 不再需要 `exec(sql, params)` 方法。

**Migration**: 应用必须将所有数据操作声明为 named SQL，通过 `client.query(name, params)` 或 `client.mutate(name, params)` 调用。

### Requirement: useExec Hook

**Reason**: 对应 `client.exec` 方法的 Hook，raw SQL 端点移除后该 Hook 失去服务端支持。

**Migration**: 应用通过 `useQuery` / `useMutation` Hook 调用 named SQL。

### Requirement: SDK count 兼容旧运行时

**Reason**: 该 requirement 描述的是 count 在 named SQL 缺失时 fallback 到 REST count 端点、再 fallback 到 list-then-count 的多层兼容逻辑。named SQL 成为唯一数据通道后，兼容逻辑全部移除。

**Migration**: 应用必须声明 `$<resource>.count` named SQL。未声明时 SDK 直接抛错。
