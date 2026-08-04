## Why

LocalApp 目前只有"用户主动访问 app"的单向数据流——用户打开浏览器、查看页面、读写 CRUD 数据。**App 无法主动把消息推送给用户**，导致大量业务场景无法实现：

- 工作分配应用中，主管登记新任务后，组员无法及时收到通知
- 审批流中，待审批状态变更无法主动提醒相关人
- 内容订阅类应用，新内容发布无法推送给关注者

虽然 LocalApp 已有 WebSocket 使用的可能性（server 是 Fastify），但目前**没有任何推送通道、订阅模型、通知持久化**。本变更新增"通知子系统"，让 app 能向已订阅的用户推送消息。

## What Changes

### Publish 侧：通知发布端点

- 新增 `POST /serve/{owner}/{app}/api/notify` 端点（路径模式与现有 CRUD API 一致）
- App 的前端 JS 通过 `fetch` 调用此端点发布通知
- 通知 payload：`title`（必填）、`body`、`url`（相对路径，防钓鱼）、`priority`（normal/high）、`to`（可选定向用户列表）、`data`（app 自定义）
- `to` 字段缺省时广播给所有订阅者；显式列表时仅发送给指定用户（须已订阅；未订阅者静默丢弃）

### Publish 侧：通知权限三层模型

按 LocalApp"convention over configuration"哲学，权限模型分三层（外加关闭态）：

- **Level 0（默认关闭）**：manifest 不写 `notify` 字段 → 端点不存在、shell 不渲染订阅按钮
- **Level 1（owner-only）**：`manifest.notify.enabled = true`，仅 page owner 可调用 notify
- **Level 2（系统约定表）**：`manifest.notify.enabled = true` + app 含 `_localapp_notifiers` 表 → owner + 表中用户可调用
- **Level 3（自定义查询）**：`manifest.notify.permission = { table, userColumn, where }` → 执行自定义 SQL 校验

检测优先级：Level 3 > Level 2 > Level 1。

### Publish 侧：跨 app 冒用防护

- Server 校验请求 `Referer` 头必须来自该 app 的页面（`/{owner}/{app}/` 前缀）
- 利用浏览器同源策略天然防跨 app 冒用
- **不引入 publish token**——路径已标识身份，token 是冗余的 security theater

### Publish 侧：Rate limiting

- 每 app 默认：100 条/小时（持续）+ 10 条/分钟（突发）
- 超额返回 429 + Retry-After

### Subscribe 侧：订阅 API

- `POST /api/subscriptions` — 创建或更新订阅（body: `{ app_owner, app_name, level }`）
- `DELETE /api/subscriptions/:app_owner/:app_name` — 退订
- `GET /api/subscriptions` — 列出当前用户所有订阅
- `GET /api/subscriptions/:app_owner/:app_name/status` — 查询单个订阅状态（给 Shell 🔔 按钮用）
- 订阅等级：`all`（所有都弹窗）/ `important`（仅 high 弹窗）/ `muted`（不弹窗，但 inbox 仍记录）
- 订阅数据存共享 SQLite（`subscriptions` 表），per-user

### Subscribe 侧：等级 × 优先级路由

| | priority=normal | priority=high |
|---|---|---|
| all | 入库 + WS 推送 | 入库 + WS 推送 |
| important | 仅入库（不推送） | 入库 + WS 推送 |
| muted | 仅入库（不推送） | 仅入库（不推送） |
| 未订阅 | 静默丢弃 | 静默丢弃 |

### Subscribe 侧：收件箱 API

- `GET /api/inbox?limit=20&cursor=xxx` — 通知列表（游标分页）
- `GET /api/inbox/unread-count` — 未读计数（给导航栏徽标用）
- `PATCH /api/inbox/:id` — 标记已读（`{ read: true }`）
- `DELETE /api/inbox/:id` — 删除（软删除：`deleted_at` 置位）
- `POST /api/inbox/read-all` — 批量标记已读
- 不自动清理，用户手动删

### WebSocket 系统消息总线

- `GET /api/ws` — 系统级 WebSocket 端点（非 notify 专属）
- 建链鉴权：`Authorization: Bearer <api_key>` header，建链后不再鉴权
- 消息信封：`{ "type": "<ns>:<event>", "data": { ... } }` — 命名空间隔离
- 心跳：server 每 30s 发 `bus:ping`，client 须 60s 内回 `bus:pong`
- `user_id → Set<WebSocket>` 连接池，多设备广播
- 当前支持的消息类型：`notify:notification`、`notify:missed`、`bus:ready`、`bus:ping`、`bus:pong`
- 未来可扩展 `crud:row_changed`、`presence:user_online` 等新类型

### 离线消息处理

- 用户离线期间的通知持久化在 `notifications` 表（`read_at=NULL`）
- Daemon 正式运行时，建链后 server 计算 `unread_count`，推送 `notify:missed = { count: N }`
- CLIENT（daemon）端收到 missed 后弹窗："你错过了 N 条通知"

### Manifest 字段扩展

- `manifest-config` 新增 `notify` 字段，含 `enabled`（boolean）和可选的 `permission` 对象
- `localapp upload` 必须把 manifest 中的 `notify` 配置作为 `notifyConfig` multipart 字段上传
- Server 必须把 `notifyConfig` 校验后写入页面 `meta.json` 的 `notify` 字段，并通过页面 meta API 暴露给 Platform Shell

### Platform Shell 修改

- 新增 🔔 订阅按钮（条件渲染于 `manifest.notify.enabled === true`）
- 按钮有 4 种状态：隐藏（Level 0）、未登录（提示登录）、未订阅（可选择等级后订阅）、已订阅（显示当前等级，可改可退订）
- 按钮位置：导航栏右侧，与 ★ 收藏同级

### Web 端页面

- `/inbox` — 收件箱页面（通知列表 + 分页 + 标记已读 + 删除）
- `/my/subscriptions` — 订阅管理页面（列表 + 改等级 + 退订 + 跳转 app）

## Capabilities

### New Capabilities

- `notify-publish`: 通知发布端点 + 权限三层模型 + Referer 校验 + Rate limiting
- `notify-subscribe`: 订阅 API + 收件箱 API + WebSocket 系统消息总线 + 等级×优先级路由矩阵 + 离线消息处理

### Modified Capabilities

- `manifest-config`: 新增 `notify.{enabled, permission}` 字段定义与校验规则
- `platform-shell`: 新增 🔔 订阅按钮（条件渲染 + 4 种状态 + 未读徽标）

## Impact

### 代码影响（Server）

- `packages/server/src/routes/`：新增 `notify.ts`（publish 端点）+ `subscribe.ts`（订阅 API）+ `inbox.ts`（收件箱 API）+ `ws.ts`（WebSocket 端点）
- `packages/server/src/lib/`：新增 `notifications-db.ts`（通知持久化 + 订阅存储）+ `ws-manager.ts`（连接池管理）
- `packages/server/src/lib/access-control.ts`：扩展支持 notify 权限的三层检测
- `packages/server/src/lib/config.ts` 或 manifest 解析：读取 `notify` 字段
- 上传/serve 流程：CLI 上传 `notifyConfig`，server 写入 `meta.notify`，并根据 `meta.notify.enabled` 决定是否注册 notify 端点
- `packages/server/src/plugins/storage.ts`：`PageMeta` 新增 `notify` 配置字段

### 数据存储（Server）

- 共享 SQLite 新增：
  - `notifications(id, user_id NOT NULL, app_owner, app_name, title, body, url, priority, data, created_at, read_at, deleted_at)` — 按接收者逐行写入的通知记录
  - `subscriptions(user_id, app_owner, app_name, level, created_at)` — 订阅关系
- App SQLite 可选：`_localapp_notifiers(user_id TEXT PK)` — 系统约定表（Level 2）

### 代码影响（Web）

- 新增 `/inbox` 页面（Next.js page）
- 新增 `/my/subscriptions` 页面
- 修改 Platform Shell 组件：新增 🔔 按钮

### 不在本提案范围

- **cli-daemon**（Rust daemon binary）：独立变更，消费本变更的 WS 总线
- CLI 的 `localapp subscribe` / `localapp unsubscribe` 命令 — 已确定不做
- Tauri 桌面应用 — 已确认暂不做
- SDK 的 `notify()` 封装 — 独立变更（未来）
- 浏览器端直接接入 `/api/ws` — 本提案的 WS 鉴权面向 daemon/API-key client；Web/Shell 仅通过 HTTP API 展示未读徽标

### 兼容性

- **向后兼容**：现有 app 不写 `notify` 字段时，行为完全不变（Level 0）
- **无破坏性变更**：现有路由、API、manifest 字段不受影响
