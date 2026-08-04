## ADDED Requirements

### Requirement: Notify 端点路径

Notify API SHALL 使用与 CRUD API 一致的路径模式：`POST /serve/{userId}/{name}/api/notify`。端点的存在性由 manifest 的 `notify.enabled` 字段控制。

#### Scenario: notify.enabled = true 时端点存在

- **WHEN** 请求 `POST /serve/alice/leave-app/api/notify`，且 alice/leave-app 的 manifest.json 中 `notify.enabled = true`
- **THEN** 端点存在并执行权限校验

#### Scenario: notify.enabled 缺失时端点不存在

- **WHEN** 请求 `POST /serve/alice/leave-app/api/notify`，且 alice/leave-app 的 manifest.json 不含 `notify` 字段
- **THEN** 返回 HTTP 404

#### Scenario: notify.enabled = false 时端点不存在

- **WHEN** 请求 `POST /serve/alice/leave-app/api/notify`，且 manifest.json 中 `notify.enabled = false`
- **THEN** 返回 HTTP 404

### Requirement: 通知 payload 校验

Notify 端点 SHALL 接受以下 JSON payload：

- `title`（string，必填，非空，最大 200 字符）
- `body`（string，可选，最大 1000 字符）
- `url`（string，可选，必须是相对路径）
- `priority`（string，可选，取值 `normal` 或 `high`，默认 `normal`）
- `to`（string[]，可选，定向接收者 user_id 列表；缺省时广播给所有订阅者）
- `data`（object，可选，序列化后最大 4KB）

#### Scenario: 缺少 title 字段

- **WHEN** 请求 POST notify 且 body 不含 `title`
- **THEN** 返回 HTTP 400，错误信息提示 title 必填

#### Scenario: url 为绝对 URL

- **WHEN** 请求 POST notify 且 `url = "https://evil.com/phish"`
- **THEN** 返回 HTTP 400，错误信息提示 url 必须是相对路径

#### Scenario: url 为协议相对 URL

- **WHEN** 请求 POST notify 且 `url = "//evil.com"`
- **THEN** 返回 HTTP 400，错误信息提示 url 必须是相对路径

#### Scenario: 合法的相对路径 url

- **WHEN** 请求 POST notify 且 `url = "/alice/leave-app/tasks/123"`
- **THEN** 校验通过，url 被存入通知记录

#### Scenario: to 字段为合法数组

- **WHEN** 请求 POST notify 且 `to = ["bob", "charlie"]`
- **THEN** 校验通过，to 被传入路由分发逻辑

#### Scenario: to 字段为非数组类型

- **WHEN** 请求 POST notify 且 `to = "bob"`（字符串而非数组）
- **THEN** 返回 HTTP 400

### Requirement: 跨 app 冒用防护（Referer 校验）

Server SHALL 校验 notify 请求的 Referer 头必须匹配路径中的 app（即 Referer 路径以 `/{owner}/{app}/` 开头）。

#### Scenario: 同 app 页面调用 notify

- **WHEN** Referer 为 `http://host/alice/leave-app/tasks/123`，请求 `POST /serve/alice/leave-app/api/notify`
- **THEN** Referer 校验通过，继续权限校验

#### Scenario: 跨 app 调用 notify

- **WHEN** Referer 为 `http://host/bob/blog/page`，请求 `POST /serve/alice/leave-app/api/notify`
- **THEN** 返回 HTTP 403

#### Scenario: Referer 缺失

- **WHEN** 请求 POST notify 不带 Referer 头
- **THEN** 返回 HTTP 403，错误信息提示 Referer 必填

#### Scenario: 非 LocalApp 域的 Referer

- **WHEN** Referer 为 `http://evil.com/page`
- **THEN** 返回 HTTP 403

### Requirement: Level 1 权限（owner-only，默认开启态）

当 `manifest.notify.enabled = true` 且无 `notify.permission` 字段且 app 无 `_localapp_notifiers` 表时，notify 端点 SHALL 仅允许 page owner 调用。

#### Scenario: owner 调用 notify

- **WHEN** page owner alice 已登录并调用 `POST /serve/alice/leave-app/api/notify`
- **THEN** 校验通过，通知入库

#### Scenario: 非 owner 调用 notify

- **WHEN** 用户 bob 已登录并调用 `POST /serve/alice/leave-app/api/notify`
- **THEN** 返回 HTTP 403

#### Scenario: 未登录用户调用 notify

- **WHEN** 未登录用户调用 `POST /serve/alice/leave-app/api/notify`
- **THEN** 返回 HTTP 401

### Requirement: Level 2 权限（系统约定表）

当 `manifest.notify.enabled = true` 且 app 的 SQLite 含 `_localapp_notifiers` 表（schema: `user_id TEXT PRIMARY KEY`）时，notify 端点 SHALL 允许 owner 加上表中所有 user_id 调用。

#### Scenario: 在 notifiers 表中的用户调用

- **WHEN** 用户 bob 已登录，bob 存在于 alice/leave-app 的 `_localapp_notifiers` 表中，调用 `POST /serve/alice/leave-app/api/notify`
- **THEN** 校验通过，通知入库

#### Scenario: 不在 notifiers 表中的用户调用

- **WHEN** 用户 charlie 已登录，charlie 不在 `_localapp_notifiers` 表中，调用 `POST /serve/alice/leave-app/api/notify`
- **THEN** 返回 HTTP 403

#### Scenario: owner 始终可调用

- **WHEN** owner alice 调用 notify，且 `_localapp_notifiers` 表为空
- **THEN** 校验通过（owner 始终有权限）

### Requirement: Level 3 权限（自定义 SQL 查询）

当 `manifest.notify.permission` 含 `table`、`userColumn`、可选 `where` 字段时，server SHALL 执行自定义查询校验调用者权限。

查询模板：`SELECT 1 FROM {table} WHERE {userColumn} = ? [AND {where}] LIMIT 1`，绑定参数为当前用户 ID。

#### Scenario: 自定义表校验通过

- **WHEN** manifest 配置 `permission = { table: "users", userColumn: "id", where: "role = 'supervisor'" }`，当前用户 alice 的 `users.id = 'alice' AND role = 'supervisor'` 命中
- **THEN** 校验通过

#### Scenario: 自定义表校验失败

- **WHEN** manifest 配置同上，当前用户 bob 的 `users.role = 'member'` 不命中 where 条件
- **THEN** 返回 HTTP 403

#### Scenario: table 字段指向不存在的表

- **WHEN** manifest 配置 `permission.table = "nonexistent"`，server 查询失败
- **THEN** 返回 HTTP 500，错误信息提示权限配置错误

#### Scenario: where 子句含 SQL 注入风险

- **WHEN** manifest 的 `where` 字段含恶意 SQL（如 `"; DROP TABLE users; --"`）
- **THEN** server SHALL 拒绝该 Level 3 permission 配置，回退到 Level 1/2，并记录警告日志

### Requirement: 权限检测优先级

Server SHALL 按以下优先级检测权限：Level 3（manifest.permission 存在）> Level 2（`_localapp_notifiers` 表存在）> Level 1（owner-only）。

#### Scenario: 同时配置 manifest.permission 和 _localapp_notifiers 表

- **WHEN** manifest 含 `notify.permission.table`，且 app 同时有 `_localapp_notifiers` 表
- **THEN** 走 Level 3（manifest.permission 优先），忽略 `_localapp_notifiers` 表

#### Scenario: 无 manifest.permission 但有 _localapp_notifiers 表

- **WHEN** manifest 含 `notify.enabled: true` 但无 `permission` 字段，app 有 `_localapp_notifiers` 表
- **THEN** 走 Level 2

### Requirement: Rate limiting

Server SHALL 对每个 app 实施 rate limit：每小时 100 条 + 每分钟 10 条（突发）。超额请求返回 429。

#### Scenario: 正常速率

- **WHEN** 某 app 在 1 分钟内调用了 5 次 notify
- **THEN** 所有请求正常处理

#### Scenario: 超过突发限制

- **WHEN** 某 app 在 1 分钟内调用了 11 次 notify
- **THEN** 前 10 次正常处理，第 11 次返回 HTTP 429 + `Retry-After` 头

#### Scenario: 超过小时限制

- **WHEN** 某 app 在 1 小时内累计调用了 101 次 notify
- **THEN** 前 100 次正常处理，第 101 次返回 HTTP 429

### Requirement: 通知持久化

成功通过校验的 notify 请求 SHALL 查询订阅关系确定接收者：若 `to` 字段存在则仅发给列表中已订阅用户（未订阅者静默丢弃）；若 `to` 缺省则发给所有订阅者。Server SHALL 对每个接收者按等级×优先级矩阵决定入库与 WS 推送策略。通知 SHALL 按接收者逐行写入共享 SQLite 的 `notifications` 表，且每行 `user_id` SHALL 为接收者 user_id。

#### Scenario: 单接收者通知写入持久化

- **WHEN** notify 请求通过所有校验，且路由到 bob
- **THEN** `notifications` 表新增一行，包含 id、user_id=`bob`、app_owner、app_name、title、body、url、priority、data、created_at、read_at=NULL、deleted_at=NULL

#### Scenario: 多接收者广播通知写入持久化

- **WHEN** notify 请求缺省 `to` 字段，且 app 有 3 个订阅者
- **THEN** `notifications` 表新增 3 行，每行对应一个接收者 user_id

#### Scenario: 无接收者

- **WHEN** notify 请求通过权限校验，但没有任何订阅者或所有 `to` 目标均未订阅
- **THEN** 不写入 `notifications` 表，返回 HTTP 200，body 中 `delivered` 为 0

#### Scenario: 通知写入失败

- **WHEN** SQLite 写入失败（如磁盘满）
- **THEN** 返回 HTTP 500，错误信息提示持久化失败

### Requirement: 通知响应格式

成功创建通知后 SHALL 返回标准 JSON 响应。

#### Scenario: 成功响应

- **WHEN** notify 请求通过所有校验并成功持久化
- **THEN** 返回 HTTP 200，body 为 `{ success: true, delivered: <number>, ids: ["<notification_id>", ...] }`

#### Scenario: 无接收者成功响应

- **WHEN** notify 请求通过所有校验但没有可投递接收者
- **THEN** 返回 HTTP 200，body 为 `{ success: true, delivered: 0, ids: [] }`

#### Scenario: 校验失败响应

- **WHEN** notify 请求未通过校验
- **THEN** 返回相应 HTTP 状态码（400/401/403/429/500），body 为 `{ success: false, error: "<message>" }`
