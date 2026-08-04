## Purpose

This spec describes the expected behavior, acceptance criteria, and integration boundaries for the manifest-config capability in LocalApp.

## Requirements

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

### Requirement: manifest.json 支持 shell 配置
manifest.json SHALL 支持可选的 `shell` 字段，控制页面渲染方式。

#### Scenario: manifest.json 包含 shell.navbar 配置
- **WHEN** manifest.json 包含 `{ "shell": { "navbar": false } }`
- **THEN** 页面访问时不显示导航栏，直接服务页面内容

#### Scenario: manifest.json 不包含 shell 配置
- **WHEN** manifest.json 不包含 `shell` 字段或 `shell.navbar` 为 true 或未设置
- **THEN** 页面访问时使用默认行为（显示导航栏 + native app 嵌套）

#### Scenario: shell 配置的数据类型
- **WHEN** manifest.json 包含 shell 字段
- **THEN** shell 为可选对象，包含可选的 boolean 类型 navbar 字段

### Requirement: manifest.json notify 配置

manifest.json SHALL 支持顶层 `notify` 字段，控制 app 的通知能力开关与权限模型。

字段结构：

```json
{
  "notify": {
    "enabled": <boolean>,                    // 必填，开关
    "permission": {                           // 可选，省略时走 Level 1 或 Level 2
      "table": "<string>",                    //   app SQLite 表名或视图名
      "userColumn": "<string>",               //   可选，默认 "user_id"
      "where": "<string>"                     //   可选，附加 WHERE 子句
    }
  }
}
```

#### Scenario: 完整 Level 3 配置

- **WHEN** manifest.json 含 `notify = { enabled: true, permission: { table: "users", userColumn: "id", where: "role = 'supervisor'" } }`
- **THEN** notify 能力启用，权限校验走 Level 3（自定义查询）

#### Scenario: Level 1 最小配置

- **WHEN** manifest.json 含 `notify = { enabled: true }`
- **THEN** notify 能力启用，权限校验走 Level 1（owner-only），除非 app 有 `_localapp_notifiers` 表（则自动 Level 2）

#### Scenario: 显式关闭 notify

- **WHEN** manifest.json 含 `notify = { enabled: false }`
- **THEN** notify 能力关闭，端点不存在，shell 不渲染订阅按钮

#### Scenario: 不写 notify 字段

- **WHEN** manifest.json 不含 `notify` 字段
- **THEN** 与 `enabled: false` 等价（Level 0 默认关闭）

### Requirement: notify 配置上传与持久化

CLI upload MUST 将 manifest.json 中合法的 `notify` 字段作为 `notifyConfig` multipart 字段上传。Server SHALL 校验该字段后写入页面 `meta.json` 的顶层 `notify` 字段。页面 meta API SHALL 返回 `notify` 字段供 Platform Shell 条件渲染订阅按钮。

#### Scenario: upload 携带 notifyConfig

- **WHEN** manifest.json 含 `notify = { enabled: true }` 且用户运行 `localapp upload`
- **THEN** CLI 请求 `/api/upload` 时包含 `notifyConfig` multipart field
- **THEN** server 将 `{ enabled: true }` 写入该页面的 `meta.json.notify`

#### Scenario: 页面 meta 返回 notify

- **WHEN** Platform Shell 请求 `/api/pages/alice/leave-app/meta`
- **THEN** 响应 data 中包含 `notify` 字段（若页面未配置则缺省或为 `{ enabled: false }`）

#### Scenario: upload 未携带 notifyConfig

- **WHEN** 旧版 CLI 或旧 app 上传时不包含 `notifyConfig`
- **THEN** server 不写入 `meta.notify`，行为等同于 `notify.enabled = false`

### Requirement: notify 字段类型校验

Server SHALL 在上传/加载 manifest 时校验 `notify` 字段的结构。非法配置 SHALL 视为 notify 关闭并记录警告日志。

#### Scenario: enabled 字段类型错误

- **WHEN** manifest.json 含 `notify = { enabled: "true" }`（字符串而非布尔）
- **THEN** 视为 `enabled: false`，记录警告日志 "notify.enabled must be boolean"

#### Scenario: permission.table 类型错误

- **WHEN** manifest.json 含 `notify.permission.table = 123`（数字而非字符串）
- **THEN** 视为 permission 配置非法，回退到 Level 1/2，记录警告日志

#### Scenario: where 字段含分号

- **WHEN** manifest.json 含 `notify.permission.where = "role = 'admin'; DROP TABLE users"`
- **THEN** permission 配置被视为非法，回退到 Level 1/2，记录警告日志

### Requirement: Manifest declares backend contract location

manifest SHALL support a `backend` section that declares where application backend contract files are located without embedding schema or SQL definitions directly in manifest.

#### Scenario: backend root declared
- **WHEN** manifest includes `backend.root`
- **THEN** CLI and runtime MUST use that root to discover backend contract files

#### Scenario: manifest embeds SQL definitions
- **WHEN** manifest attempts to define named SQL inline
- **THEN** validate MUST reject the inline SQL definition and instruct the developer to use backend files

### Requirement: Manifest backend declaration is packaged

上传时，平台 SHALL preserve manifest backend declaration alongside resolved backend contract metadata for the uploaded app version.

#### Scenario: uploaded app has backend declaration
- **WHEN** an app with backend declaration is uploaded
- **THEN** production server MUST be able to resolve the uploaded backend contract without reading the developer working directory
