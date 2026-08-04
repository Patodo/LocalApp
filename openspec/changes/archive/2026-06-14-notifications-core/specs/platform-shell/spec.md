## ADDED Requirements

### Requirement: Shell 🔔 订阅按钮（条件渲染 + 状态机）

Platform Shell 导航栏 SHALL 在 `manifest.notify.enabled === true` 时渲染 🔔 订阅按钮。按钮 SHALL 根据用户认证状态和订阅状态展示 4 种不同的 UI。

按钮位置：导航栏右侧，与 ★ 收藏按钮同级。

#### Scenario: notify.enabled = false 时不渲染

- **WHEN** 当前 app 的 `manifest.notify.enabled` 为 false 或缺省
- **THEN** 导航栏不显示 🔔 按钮

#### Scenario: 用户未登录

- **WHEN** `manifest.notify.enabled = true`，当前访客未登录
- **THEN** 显示 🔔 按钮，文案为"登录后订阅"，点击弹出登录模态框

#### Scenario: 用户已登录、未订阅

- **WHEN** `manifest.notify.enabled = true`，当前用户已登录但未订阅该 app
- **THEN** 显示 🔔 按钮，展开菜单含三个等级选项（All / Important / Muted）+ 订阅确认按钮

#### Scenario: 用户已订阅

- **WHEN** `manifest.notify.enabled = true`，当前用户已订阅该 app（如 level=all）
- **THEN** 显示 🔔 按钮，文案为"已订阅 (All)"，展开菜单含等级切换选项 + 退订按钮

#### Scenario: 点击等级切换

- **WHEN** 用户展开订阅菜单并选择不同等级（如从 All 切到 Important）
- **THEN** 调用 `POST /api/subscriptions` 更新等级，按钮文案同步更新

#### Scenario: 点击退订

- **WHEN** 用户展开订阅菜单并点击"退订"
- **THEN** 调用 `DELETE /api/subscriptions/:owner/:name`，按钮回复到"未订阅"状态

### Requirement: 导航栏未读通知徽标

当 `manifest.notify.enabled = true` 且用户已登录时，Platform Shell SHALL 调用 `GET /api/inbox/unread-count` 获取未读数。若 `count > 0`，在 🔔 按钮上显示红色徽标。

#### Scenario: 有未读通知

- **WHEN** `GET /api/inbox/unread-count` 返回 `{ count: 3 }`
- **THEN** 🔔 按钮上显示红色圆点 + 数字 3

#### Scenario: 无未读通知

- **WHEN** `GET /api/inbox/unread-count` 返回 `{ count: 0 }`
- **THEN** 🔔 按钮上无徽标

#### Scenario: 查询失败

- **WHEN** `GET /api/inbox/unread-count` 网络错误
- **THEN** 静默降级：不显示徽标，不阻塞页面渲染
