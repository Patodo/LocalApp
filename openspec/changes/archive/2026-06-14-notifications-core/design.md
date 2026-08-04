## Context

LocalApp 当前是"用户拉取"模型——用户访问 `/{owner}/{app}/` 时，浏览器加载静态文件、调 CRUD API。**没有任何由 app 主动触达用户的通道**。

本变更引入完整的"通知子系统"：**publish 侧**（app 如何发布通知）+ **subscribe 侧**（用户如何订阅、收件箱如何查询、实时推送如何送达）。

现有架构参考：
- **路由模式**：CRUD API 走 `/serve/{userId}/{name}/api/{resource}`，按 app 命名空间隔离
- **访问控制**：`access-control.ts` 的 `checkAccess(level, visitorId, ownerId, acl)`，level 为 `public | authenticated | owner`
- **manifest.json**：app 配置文件，含 `db`、`shell` 字段
- **App SQLite**：每个 app 有独立 SQLite（`app-db.ts`），CRUD 数据存这里
- **共享 SQLite**：`meta-sqlite.ts` 管理平台级数据（用户、API Key 等）

## Goals / Non-Goals

**Goals:**

- 通知发布端点 + 三层权限模型 + Rate limiting
- 订阅 API（增删改查），订阅数据存共享 DB，per-user
- 收件箱 API（列表/分页/已读/删除）
- WebSocket 系统消息总线——一条 WS 端点承载所有实时消息类型
- 等级 × 优先级路由矩阵（all / important / muted）
- 离线消息处理（建链时推送 missed count）
- Web 端 `/inbox` 收件箱页面 + `/my/subscriptions` 订阅管理页面
- Platform Shell 🔔 订阅按钮（条件渲染 + 4 种状态）
- Manifest 字段扩展（`notify.enabled` + `notify.permission`），并贯通 CLI upload → server meta → Platform Shell
- 通知持久化到共享 SQLite
- **不引入 publish token**

**Non-Goals:**

- **cli-daemon**（Rust daemon binary）：独立变更，依赖本变更的 WS 总线
- Tauri 桌面应用
- SDK 的 `notify()` 函数封装
- CLI 的 `localapp subscribe` / `localapp unsubscribe` 命令
- 浏览器端 WebSocket 客户端（原生浏览器不能为 WebSocket 设置 `Authorization` header；本提案 WS 面向 daemon/API-key client）
- 通知去重、合并、TTL 等高级特性
- 开机自启（daemon 侧 MVP 不做）

## Decisions

### 决策 1-8：Publish 侧（已完成，详见首次 proposal）

端点路径、无 publish token、三层权限模型、系统表约定、共享 SQLite 存储、Rate limit、URL 同源校验、内存计数器。设计不变。

---

### Subscribe 侧决策

### 决策 9：WebSocket 作为系统消息总线

**选择**：`GET /api/ws` — 单一 WS 端点承载所有实时消息，非 notify 专属

**消息信封**：

```json
{
  "type": "<namespace>:<event>",
  "data": { ... }
}
```

当前支持的类型：`bus:ready`、`bus:ping`、`bus:pong`、`notify:notification`、`notify:missed`。未来可扩展 `crud:row_changed`、`presence:user_online` 等。

**理由**：
- 一个连接搞定所有实时需求，客户端不用为每个功能开一条 WS
- 新增实时能力只需新增 type，不动 WS 基础设施
- 鉴权一次到位（建链时 Authorization header），之后所有消息自动信任

**Alternatives 考虑**：
- notify 专属 WS（`/api/notifications`）—— 每次加新实时能力都要新端点，碎片化
- SSE —— 单向推送够用但不如 WS 灵活，且不能双向（如未来 ack 需求）

### 决策 10：等级 × 优先级路由矩阵

**选择**：

| | priority=normal | priority=high |
|---|---|---|
| all | 入库 + WS 推送 | 入库 + WS 推送 |
| important | 仅入库 | 入库 + WS 推送 |
| muted | 仅入库 | 仅入库 |
| 未订阅 | 静默丢弃 | 静默丢弃 |

**理由**：
- `muted` 声明了用户意图"别打扰我"，即使 high 也不应突破——用户主权优先于发布者紧急程度
- `important` 作为折中态："平时别推，重要的推"
- muted 仍写入 inbox（用户随时可主动查看），与 unsubscribe 有本质区别

**Alternatives 考虑**：
- high 突破 muted —— 违反用户明确意图
- muted 完全不写入 inbox —— 与 unsubscribe 无区别，三档退化成两档

### 决策 11：通知路由的 `to` 字段

**选择**：payload 可选 `to: ["bob", "charlie"]`

Server 行为：

```
if (payload.to === undefined) {
  // 广播模式：发给所有订阅者
  recipients = SELECT user_id FROM subscriptions WHERE app_owner=? AND app_name=?
} else {
  // 定向模式：发给 to 中已订阅的用户
  recipients = payload.to.filter(u => isSubscribed(u, app_owner, app_name))
  // 未订阅的 to 目标 → 静默丢弃
}
```

**理由**：
- 支持两种最常见的业务模式：博客通知（广播）和工作分配（定向）
- 定向模式下未被订阅的用户不报错（避免暴露订阅列表），但也不接收

### 决策 12：订阅及收件箱 API 端点

**选择**：

订阅管理（需 cookie 或 api_key 鉴权）：
- `POST /api/subscriptions` — body: `{ app_owner, app_name, level }` → 创建或更新
- `DELETE /api/subscriptions/:app_owner/:app_name` → 退订
- `GET /api/subscriptions` → 当前用户所有订阅
- `GET /api/subscriptions/:app_owner/:app_name/status` → 单条状态（给 🔔 按钮用）

收件箱（需 cookie 或 api_key 鉴权）：
- `GET /api/inbox?limit=20&cursor=xxx` → 游标分页列表
- `GET /api/inbox/unread-count` → `{ count: N }`
- `PATCH /api/inbox/:id` — body: `{ read: true }` → 标记已读
- `DELETE /api/inbox/:id` → 软删除（`deleted_at` 置位）
- `POST /api/inbox/read-all` → 批量标记已读

**理由**：
- RESTful 风格与现有 API 一致
- 游标分页而非 offset（数据量大时性能稳定）
- 软删除保留审计能力，用户手动清理

### 决策 13：WS 鉴权方式

**选择**：建链时 `Authorization: Bearer <api_key>` header，建链后不再验证

**理由**：
- 复用已有 api_key 体系，不需要额外 token
- URL 不出现密钥（与 query 参数方案相比）
- 建链后信任连接，不每条消息验签（性能好）
- 明确限定为 daemon/API-key client 使用；Platform Shell 和浏览器页面不直接连接 `/api/ws`

**Alternatives 考虑**：
- `?api_key=xxx` query 参数 —— 简单但密钥进 server 日志
- Cookie 方式 —— daemon 不在浏览器里，没 cookie

**浏览器边界**：
- 原生浏览器 `WebSocket` API 无法设置 `Authorization` header，因此本提案不要求 Web/Shell 实时接收 WS 消息
- Web/Shell 的 MVP 体验通过 `GET /api/inbox/unread-count`、`GET /api/inbox` 等 HTTP API 获取状态
- 若未来需要浏览器实时徽标，可独立变更新增 cookie 鉴权 WS 或 SSE

### 决策 14：离线消息处理

**选择**：daemon 建链后 server 立即推送 `notify:missed = { count: N }`

Daemon 收到后弹一次窗："你错过了 N 条通知"（不逐条弹）。点击打开浏览器到 `/inbox`。

**理由**：
- 离线可能积压数十条，逐条弹窗是噪音
- 汇总弹窗一次告知，用户主动查看 inbox
- 与用户之前确认的"持久化入收件箱 + 登录时弹错过了 N 条"一致

### 决策 15：多设备 fanout 策略

**选择**：广播给所有活跃连接（`user_id → Set<WebSocket>` 映射）

同一用户同时在公司 + 家里跑 daemon，两边都收到同一条通知并弹窗。已读同步（点开一个设备后清除其他设备的弹窗）留待未来。

**理由**：
- 实现简单（无 last_seen、无设备选择逻辑）
- 用户场景下多数只有一台机器常驻 daemon
- 少数多设备场景下多弹一次窗可接受

### 决策 16：软删除

**选择**：`notifications.deleted_at` 置位，查询默认过滤 `deleted_at IS NULL`

**理由**：
- 可恢复（用户误删）
- 审计需要
- 不自动清理，用户手动清

### 决策 17：Daemon 二进制设计（供 cli-daemon 变更参考）

虽然 daemon 本身在独立变更 `cli-daemon` 中实施，其架构决策已在本 design 中记录：

- **单一二进制**：`localapp` 是唯一二进制，daemon 是其默认行为（无子命令时启动 daemon）
- **全局单例**：用 `single-instance` crate（平台无关）
- **极简 IPC**：named pipe（Windows `\\.\pipe\localapp-daemon` / Unix `~/.localapp/daemon.sock`）只为发 `stop` 和 `reload` 两个命令
- **不通信复杂数据**：CLI 一次性命令直接 HTTP 调 server，不通过 daemon 转发
- **api_key 变更**：`localapp login` 完成后通过 named pipe 发 `reload`，daemon 收到后重读 config 并重连 WS
- **默认后台**：`localapp` 直接启动 → fork 后台。`localapp -f / --foreground` → 前台打日志
- **前台日志**：INFO 级别输出连接状态、通知摘要、重连信息；`-v` 切 DEBUG 含 ping RTT
- **Tray 右键菜单**：Status / Open Inbox / Open Subscriptions / Pause 1h / Restart / Quit
- **不作开机自启**：MVP 不做
- **不用 Tauri**：daemon 是纯 Rust 进程（tray-icon + notify-rust + tokio + tungstenite），不引入 WebView

## Risks / Trade-offs

- **[风险] 共享 SQLite 写放大** → 高频通知场景下写入压力大。Mitigation：Rate limit 100/hr；大规模部署需迁独立 DB（未来工作）。

- **[风险] Referer 校验可被 Referrer-Policy 削弱** → 若 app 设了 `Referrer-Policy: no-referrer`，Referer 缺失。Mitigation：缺失时拒绝请求。

- **[风险] Level 3 自定义 SQL 配置错误或注入式 where** → owner 可配置 SQL 片段，但仍可能误写破坏性片段。Mitigation：`table`/`userColumn` 必须通过标识符白名单校验；`where` 禁止分号、注释、DML/DDL 关键字和多语句；查询只用 `SELECT 1 ... LIMIT 1` 模板并通过 prepared statement 绑定当前用户。

- **[风险] Rate limit 内存态** → Server 重启后重置。Mitigation：单实例可接受。

- **[风险] WS 连接泄漏** → 客户端断线不走 close 协议（网络断开）导致 server 端连接残留。Mitigation：30s ping + 60s pong timeout，超时主动断连。

  > **实施修订（心跳方向）**：本变更实际落地为 **client（daemon）主动发 `bus:ping`、server 回 `bus:pong`**，server 端暂不实现主动 ping 定时器与超时检测。原因：Fastify 4 + Node 22 + @fastify/websocket v8 在测试环境中触发 `handler` 不执行的兼容性问题，端到端 WS 测试无法稳定运行（见 tasks 17.4/17.5/21.4/21.5 标记暂缓）。daemon 端通过指数退避重连兜底——连接异常断开时主动重连并触发 `notify:missed` 流程，间接清理 server 端残留连接。`cli-daemon` 独立变更将验证重连策略有效性，必要时再回到 server 主动 ping 模式。

  > **超集字段移除**：spec `notify:missed` 仅要求 `data.count`；初版实现多塞了 `items` 数组（daemon 收到后须另行拉 inbox 详情），为对齐 spec 已在 commit 中去掉 items，daemon 收到 `notify:missed` 后调 `GET /api/inbox` 获取详情。

- **[权衡] 多设备弹窗重复** → 同一通知多设备都弹。MVP 可接受。

- **[权衡] 不做 publish token** → 简化实现，未来非浏览器发布者需补 token。预留 Level 3 manifest 字段可扩展。

## Migration Plan

**部署**：
- 纯增量变更，无破坏性
- 现有 app（无 `notify` 字段）行为完全不变（Level 0）
- 新上传 app 的 `manifest.notify` 通过 CLI 的 `notifyConfig` 字段写入 `meta.notify`；旧 app 无 `meta.notify` 时按关闭处理
- 共享 SQLite 新增 `notifications`、`subscriptions` 表，启动时自动迁移
- 新增 WS 端点不影响现有 HTTP 路由

**回滚**：
- 删除新增表
- 移除新增路由注册
- 现有 app 不受影响
