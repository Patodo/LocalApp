---
name: localapp-notify
description: >
  LocalApp 通知（Notifications）能力使用指南。当用户提到"通知"、"notify"、
  "推送消息"、"桌面弹窗"、"订阅应用"、"收件箱"、"_localapp_notifiers"、
  "manifest notify"时使用。也适用于用户说"应用要发通知给订阅者"、
  "团队通知"、"怎么实现推送"等场景。
---

# LocalApp 通知能力

让订阅了本应用的用户在收件箱 / 桌面 daemon 收到本应用推送的通知。

## 启用通知（manifest.json）

在 manifest 加 `notify.enabled: true` 即可开启 **Level 1 owner-only** 模式：

```json
{
  "name": "leave-app",
  "distDir": "dist",
  "notify": { "enabled": true }
}
```

上传后 Platform Shell 会在该 app 的导航栏显示 🔔 按钮，其他用户可以订阅。
默认情况下 **只有 app owner** 能调 notify 端点推送通知。

## 三层权限模型

| Level | 配置 | 谁能发通知 |
|-------|------|-----------|
| 1 | `{ enabled: true }`（默认） | 仅 app owner |
| 2 | app 数据库建 `_localapp_notifiers` 表 | owner + 表中所有 user_id |
| 3 | `notify.permission = { table, userColumn, where? }` | owner + 自定义 SQL 命中的用户 |

### Level 2：团队通知（推荐中级用法）

在你的 app SQLite 中创建约定表（schema 固定）：

```sql
CREATE TABLE _localapp_notifiers (user_id TEXT PRIMARY KEY);
INSERT INTO _localapp_notifiers (user_id) VALUES ('alice');
INSERT INTO _localapp_notifiers (user_id) VALUES ('bob');
```

server 自动检测该表存在 → 切到 Level 2，表中 user 都能调 notify。

### Level 3：自定义 SQL（高级）

`manifest.json`:

```json
{
  "notify": {
    "enabled": true,
    "permission": {
      "table": "users",
      "userColumn": "id",
      "where": "role = 'supervisor'"
    }
  }
}
```

server 执行：`SELECT 1 FROM users WHERE id = ? AND (role = 'supervisor') LIMIT 1`

**安全约束**（违反则回退到 Level 1/2）：
- `table` / `userColumn` 必须是 `[A-Za-z_][A-Za-z0-9_]*` 标识符
- `where` 不得含分号、注释、UNION/INSERT/UPDATE/DELETE/DROP 等关键字

## 调用 notify 端点

```js
// 浏览器内（前端 JS），同源 fetch
await fetch("/serve/{owner}/{app}/api/notify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    title: "新请假申请",          // 必填，≤200
    body: "张三 提交了年假申请",   // 可选，≤1000
    url:  "/{owner}/{app}/leaves/123",  // 可选，必须相对路径
    priority: "normal",           // 可选，normal|high
    to: ["alice", "bob"],         // 可选，定向接收者；缺省广播给所有订阅者
    data: { leaveId: 123 },       // 可选，序列化 ≤4KB
  }),
});
```

**关键约束**：
- 必须带 `Referer` 头，且 pathname 以 `/{owner}/{app}/` 开头（防跨 app 冒用）
- 每个 app 限流：100/小时 + 10/分钟（突发）。超额返回 429 + Retry-After

## 等级 × 优先级路由矩阵

订阅者选的等级（all / important / muted）影响 WS 推送，但**不影响入库**：

| level \ priority | normal | high |
|------------------|--------|------|
| all              | 入库+推送 | 入库+推送 |
| important        | 仅入库 | 入库+推送 |
| muted            | 仅入库 | 仅入库 |

muted 即使 high 也不推送——用户主权优先于发布者紧急程度。

## 测试 checklist

- [ ] manifest 含 `notify.enabled: true`
- [ ] 上传后访问 `/{owner}/{app}/`，导航栏出现 🔔 按钮
- [ ] 用非 owner 账号订阅，刷新后按钮显示等级
- [ ] owner 调 notify → 订阅者收件箱可见
- [ ] 浏览器开发者工具检查请求带 `Referer` 头

## 更多

- [收件箱 API](../../../packages/server/src/routes/inbox.ts)
- [订阅 API](../../../packages/server/src/routes/subscribe.ts)
- [WS 消息总线](../../../packages/server/src/routes/ws.ts)（daemon 客户端用）
