## ADDED Requirements

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
