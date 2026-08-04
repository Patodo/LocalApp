## ADDED Requirements

### Requirement: WebSocket 系统消息总线端点

Server SHALL 提供 `GET /api/ws` WebSocket 端点作为系统级消息总线。端点使用统一的消息信封 `{ "type": "<ns>:<event>", "data": { ... } }` 承载所有实时消息类型。

建链鉴权 SHALL 通过 HTTP Upgrade 请求的 `Authorization: Bearer <api_key>` header 完成。建链后不再进行逐消息鉴权。本端点的 MVP 客户端为 daemon 或其他可设置 HTTP Upgrade header 的 API-key client；原生浏览器 WebSocket 客户端不在本提案范围内。

#### Scenario: 合法 api_key 建链成功

- **WHEN** 客户端发起 WS 升级请求，携带 `Authorization: Bearer <valid_api_key>`
- **THEN** 返回 101 Switching Protocols，立即发送 `{ "type": "bus:ready", "data": { "user_id": "..." } }`

#### Scenario: 非法 api_key 建链失败

- **WHEN** 客户端发起 WS 升级请求，携带无效 api_key
- **THEN** 返回 HTTP 401，不升级协议

#### Scenario: 缺少 Authorization header

- **WHEN** 客户端发起 WS 升级请求，不携带 Authorization header
- **THEN** 返回 HTTP 401

#### Scenario: 浏览器客户端不直接接入

- **WHEN** Platform Shell 需要展示通知状态
- **THEN** Shell SHALL 使用收件箱 HTTP API（如 `/api/inbox/unread-count`），而不是直接连接 `/api/ws`

### Requirement: 心跳检测

Server SHALL 每 30 秒发送 `{ "type": "bus:ping", "data": { "ts": "..." } }` 消息。Client MUST 在 60 秒内回复 `{ "type": "bus:pong" }`。超时 SHALL 触发 server 主动关闭连接。

#### Scenario: 正常心跳

- **WHEN** client 在 60 秒内回复 pong
- **THEN** 连接保持，server 继续在下一个 30s 周期发 ping

#### Scenario: pong 超时

- **WHEN** client 收到 ping 后 60 秒内未回复 pong
- **THEN** server 关闭 WebSocket 连接，从连接池移除

### Requirement: 连接池管理

Server SHALL 维护 `user_id → Set<WebSocket>` 映射。同一用户的多条连接（不同设备）独立维护，推送时遍历所有连接。

#### Scenario: 多设备建链

- **WHEN** 同一 user_id 通过两个不同设备建立 WS 连接
- **THEN** 连接池中该 user_id 的 Set 大小为 2

#### Scenario: 断线清理

- **WHEN** 某连接关闭（正常或异常）
- **THEN** 从对应 user_id 的 Set 中移除该连接；若 Set 变空，移除 user_id 条目

### Requirement: 订阅 API

Server SHALL 提供以下订阅管理端点（需 cookie 或 api_key 鉴权），订阅数据存共享 SQLite 的 `subscriptions` 表：

| 方法 | 路径 | body | 行为 |
|---|---|---|---|
| POST | /api/subscriptions | `{ app_owner, app_name, level }` | 创建或更新订阅等级 |
| DELETE | /api/subscriptions/:owner/:name | — | 退订 |
| GET | /api/subscriptions | — | 返回当前用户所有订阅 |
| GET | /api/subscriptions/:owner/:name/status | — | 返回 `{ subscribed, level }` |

#### Scenario: 首次订阅

- **WHEN** 用户 POST `/api/subscriptions` 含新 `app_owner/app_name` 和 `level = "all"`
- **THEN** `subscriptions` 表新增一行，返回 `{ success: true }`

#### Scenario: 修改订阅等级

- **WHEN** 用户 POST `/api/subscriptions` 含已有 `app_owner/app_name` 但不同 `level`
- **THEN** `subscriptions` 表对应行 level 更新，返回 `{ success: true }`

#### Scenario: 退订

- **WHEN** 用户 DELETE `/api/subscriptions/alice/leave-app`
- **THEN** `subscriptions` 表对应行删除

#### Scenario: 查询订阅列表

- **WHEN** 用户 GET `/api/subscriptions`
- **THEN** 返回 `{ subscriptions: [{ app_owner, app_name, level }] }`

#### Scenario: 查询单 app 订阅状态（未订阅）

- **WHEN** 用户 GET `/api/subscriptions/alice/nonexistent/status`
- **THEN** 返回 `{ subscribed: false, level: null }`

#### Scenario: 查询单 app 订阅状态（已订阅）

- **WHEN** 用户 GET 已订阅 app 的 status 端点
- **THEN** 返回 `{ subscribed: true, level: "all" }`

#### Scenario: 未登录用户调用订阅 API

- **WHEN** 未登录用户调用任意订阅端点
- **THEN** 返回 HTTP 401

### Requirement: 收件箱 API

Server SHALL 提供以下收件箱端点（需 cookie 或 api_key 鉴权），操作共享 SQLite 的 `notifications` 表：

| 方法 | 路径 | 行为 |
|---|---|---|
| GET | /api/inbox | 游标分页查询（默认 20 条），过滤 `deleted_at IS NULL` |
| GET | /api/inbox/unread-count | 返回 `{ count: N }` |
| PATCH | /api/inbox/:id | `{ read: true }` 标记已读 |
| DELETE | /api/inbox/:id | 软删除（`deleted_at = now()`） |
| POST | /api/inbox/read-all | 批量标记所有未读为已读 |

#### Scenario: 分页查询第一页

- **WHEN** 用户 GET `/api/inbox?limit=20`
- **THEN** 返回最近 20 条通知（`deleted_at IS NULL`），含 `next_cursor` 供下一页使用

#### Scenario: 分页查询下一页

- **WHEN** 用户 GET `/api/inbox?limit=20&cursor=xxx`
- **THEN** 返回游标之后的 20 条通知

#### Scenario: 空收件箱分页

- **WHEN** 用户 inbox 为空
- **THEN** 返回 `{ notifications: [], next_cursor: null }`

#### Scenario: 未读计数

- **WHEN** 用户 GET `/api/inbox/unread-count`
- **THEN** 返回 `{ count: N }`（`read_at IS NULL AND deleted_at IS NULL` 的行数）

#### Scenario: 标记已读

- **WHEN** 用户 PATCH `/api/inbox/:id` 含 `{ read: true }`
- **THEN** 该通知 `read_at` 置为当前时间

#### Scenario: 标记他人通知已读

- **WHEN** 用户 PATCH 不属于自己的通知 ID
- **THEN** 返回 HTTP 404（不暴露其他用户通知的存在性）

#### Scenario: 软删除通知

- **WHEN** 用户 DELETE `/api/inbox/:id`
- **THEN** 该通知 `deleted_at` 置为当前时间，之后查询不可见

#### Scenario: 批量已读

- **WHEN** 用户 POST `/api/inbox/read-all`
- **THEN** 所有 `read_at IS NULL AND deleted_at IS NULL` 的通知 `read_at` 置为当前时间

### Requirement: 等级 × 优先级路由

Server SHALL 根据接收者的订阅等级与通知的优先级决定是否通过 WS 推送实时消息。

| 订阅等级 | priority=normal | priority=high |
|---|---|---|
| all | 入库 + WS 推送 | 入库 + WS 推送 |
| important | 仅入库 | 入库 + WS 推送 |
| muted | 仅入库 | 仅入库 |

所有等级均入库（除未订阅外）。未订阅者静默丢弃，不入库、不推送、不报错。

#### Scenario: all 等级接收所有推送

- **WHEN** 用户订阅等级为 all，app 发布 priority=normal 的通知
- **THEN** 通知入库，WS 推送 `notify:notification`

#### Scenario: important 等级不接收 normal 推送

- **WHEN** 用户订阅等级为 important，app 发布 priority=normal 的通知
- **THEN** 通知入库，但不推送 WS

#### Scenario: important 等级接收 high 推送

- **WHEN** 用户订阅等级为 important，app 发布 priority=high 的通知
- **THEN** 通知入库，并推送 WS `notify:notification`

#### Scenario: muted 等级 high 也不推送

- **WHEN** 用户订阅等级为 muted，app 发布 priority=high 的通知
- **THEN** 通知入库，但不推送 WS

#### Scenario: 未订阅者静默丢弃

- **WHEN** app 发布通知，路由到未订阅用户
- **THEN** 不写入 notifications 表，不推送，不报错

### Requirement: `to` 字段路由分发

Notify payload SHALL 支持可选的 `to: ["user_id", ...]` 字段。缺省时广播给该 app 的所有订阅者。显式列表时仅发给列表中已订阅的用户（未订阅者静默丢弃）。

#### Scenario: to 缺省广播

- **WHEN** payload 不含 `to` 字段
- **THEN** 接收者为该 app 的所有订阅者

#### Scenario: to 定向

- **WHEN** payload 含 `to = ["bob", "charlie"]`，bob 已订阅，charlie 未订阅
- **THEN** bob 收到通知入库 + 推送（按等级），charlie 静默丢弃

#### Scenario: to 所有目标均未订阅

- **WHEN** payload 含 `to = ["dave"]`，dave 未订阅该 app
- **THEN** 通知不入库、不推送、仍返回 200（不暴露订阅状态）

### Requirement: WebSocket notify:notification 消息格式

Server SHALL 推送 `notify:notification` 消息，data 字段含通知完整信息（不含 user_id）。

#### Scenario: notify:notification 消息

- **WHEN** server 推送实时通知
- **THEN** 消息为 `{ "type": "notify:notification", "data": { "id", "app_owner", "app_name", "title", "body", "url", "priority", "created_at" } }`

### Requirement: WebSocket notify:missed 消息

Server SHALL 在 WS 建链后（bus:ready 之后）立即计算该用户的未读通知数。若 `unread_count > 0`，推送 `notify:missed` 消息。

#### Scenario: 有未读通知

- **WHEN** 用户建链后有 5 条未读通知
- **THEN** 推送 `{ "type": "notify:missed", "data": { "count": 5 } }`

#### Scenario: 无未读通知

- **WHEN** 用户建链后无未读通知
- **THEN** 不推送 `notify:missed` 消息

### Requirement: 通知软删除

通知删除 SHALL 为软删除（`deleted_at` 置位），不物理删除行。查询默认过滤 `deleted_at IS NULL`。不自动清理。

#### Scenario: 删除通知

- **WHEN** 用户 DELETE 一条通知
- **THEN** `deleted_at` 置位，后续 inbox 查询不可见

#### Scenario: 未读数不计入已删除通知

- **WHEN** 某通知已软删除
- **THEN** 不计入 `unread-count`
