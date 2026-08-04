## ADDED Requirements

### Requirement: manifest.json db 配置

manifest.json SHALL 扩展 `db` 字段，包含 `mode`（`crud` 或 `sql`）、`sqlAccess`（访问级别）、`defaultAccess`（CRUD 默认权限）。CLI 的 Manifest struct MUST 新增 `db` 字段。`localapp upload` 时 MUST 将 `db` 配置作为 `dbConfig` form field 发送。服务端 MUST 将 `dbConfig` 存入 meta.json 的 `db` 字段。

#### Scenario: 完整 manifest.json db 配置

- **WHEN** manifest.json 包含 `{ "name": "app", "description": "", "distDir": "dist", "db": { "mode": "sql", "sqlAccess": "owner", "defaultAccess": { "read": "public", "create": "authenticated", "update": "authenticated", "delete": "owner" } } }`
- **THEN** CLI upload 时将 `dbConfig` 作为 JSON 字符串发送，服务端存入 meta.json

#### Scenario: 最小 db 配置

- **WHEN** manifest.json 仅包含 `{ "name": "app", "db": { "mode": "crud" } }`
- **THEN** `sqlAccess` 默认 `"owner"`，`defaultAccess` 默认全 `"public"`

#### Scenario: 无 db 字段

- **WHEN** manifest.json 不包含 `db` 字段（仅有 name, description, distDir）
- **THEN** CLI 不发送 `dbConfig`，服务端 meta.json 不写入 `db` 字段，行为等同于 `mode: "crud"`

### Requirement: db.mode 开关

服务端 SHALL 根据 meta.json 中 `db.mode` 决定是否暴露 raw SQL 端点。`mode: "crud"` 或无 `db` 字段时 raw SQL 端点返回 404。`mode: "sql"` 时 raw SQL 端点可用。

#### Scenario: crud 模式禁用 raw SQL

- **WHEN** meta.json 中 `db.mode` 为 `crud` 或 `db` 字段不存在
- **THEN** `POST /serve/{userId}/{pageName}/api/db/exec` 返回 HTTP 404

#### Scenario: sql 模式启用 raw SQL

- **WHEN** meta.json 中 `db.mode` 为 `sql`
- **THEN** `POST /serve/{userId}/{pageName}/api/db/exec` 可用（后续仍需 sqlAccess 检查）

### Requirement: 默认行为

meta.json 中无 `db` 字段的已有项目 SHALL 默认采用 `{ mode: "crud", sqlAccess: "owner", defaultAccess: { read: "public", create: "public", update: "public", delete: "public" } }`。CRUD 行为不变，raw SQL 端点不可用。

#### Scenario: 旧项目无 db 配置

- **WHEN** 页面的 meta.json 不包含 `db` 字段
- **THEN** raw SQL 端点返回 404，CRUD 端点行为不变（全 public）
