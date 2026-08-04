## ADDED Requirements

### Requirement: meta.db.defaultAccess 作为 RouteAccess fallback

当 Schema 未配置 `routeAccess` 时，系统 MUST fallback 到 meta.json 中 `db.defaultAccess` 的对应操作级别。若 meta.json 也未配置 `db` 或 `defaultAccess` 中缺少对应操作级别，则 SHALL 使用 `"public"` 作为最终 fallback。Schema 配置了 `routeAccess` 时，Schema 的配置优先。

#### Scenario: Schema 未配置时使用 meta.db fallback

- **WHEN** Schema 不包含 `routeAccess` 字段且 meta.db.defaultAccess 为 `{ "delete": "owner" }` 且非 owner 用户请求 DELETE
- **THEN** 返回 HTTP 403

#### Scenario: Schema 和 meta.db 均未配置

- **WHEN** Schema 不包含 `routeAccess` 且 meta.json 无 `db` 字段（或 defaultAccess 为空）
- **THEN** 所有操作视为 `"public"`

#### Scenario: Schema 配置优先级高于 meta.db

- **WHEN** Schema 配置了 `routeAccess.delete = "owner"` 且 meta.db.defaultAccess 配置了 `delete = "authenticated"`
- **THEN** 使用 Schema 的 `"owner"`，非 owner 用户 DELETE 返回 403

### Requirement: Raw SQL 端点 sqlAccess 检查

系统 SHALL 对 raw SQL 端点应用 meta.db.sqlAccess 级别的访问控制。sqlAccess 为 `owner` 时仅页面所有者可执行 raw SQL，为 `authenticated` 时仅登录用户可执行，为 `public` 时任何人可执行。所有者（visitorId === ownerId）在任何级别下 MUST 始终有权限。

#### Scenario: sqlAccess 为 owner 时所有者可执行

- **WHEN** meta.db.sqlAccess 为 `owner` 且 visitorId 等于 page.userId
- **THEN** raw SQL 请求被允许

#### Scenario: sqlAccess 为 owner 时非所有者被拒

- **WHEN** meta.db.sqlAccess 为 `owner` 且 visitorId 不等于 page.userId
- **THEN** 返回 HTTP 403

#### Scenario: sqlAccess 为 authenticated 时登录用户可执行

- **WHEN** meta.db.sqlAccess 为 `authenticated` 且 visitorId 存在（已登录）
- **THEN** raw SQL 请求被允许

#### Scenario: sqlAccess 为 authenticated 时未登录被拒

- **WHEN** meta.db.sqlAccess 为 `authenticated` 且 visitorId 为 null
- **THEN** 返回 HTTP 401
