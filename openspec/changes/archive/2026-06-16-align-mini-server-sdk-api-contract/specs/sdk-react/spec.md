## ADDED Requirements

### Requirement: React Hook 使用一致的 SDK 契约

`@localapp/sdk-react` Hook SHALL 通过 `LocalAppClient` 调用公开 SDK 方法，并继承 SDK 的 dev/prod 契约一致性。Hook SHALL 在失败时设置 `LocalAppError`，不得静默退回本地假数据。

#### Scenario: useCount 在 dev 下可用
- **WHEN** dev 应用调用 `useCount("work_items")`
- **THEN** Hook SHALL 通过 SDK 读取 mini-server 的 `/api/work_items/count`
- **AND** 返回正确 count、loading 和 error 状态

#### Scenario: useUsers 在 dev 下可用
- **WHEN** dev 应用调用 `useUsers()`
- **THEN** Hook SHALL 读取标准 `{ success, data }` 响应
- **AND** 不得因为 mini-server 将 `/api/users` 误解析为 CRUD 而失败

### Requirement: dev context 变化触发订阅型 Hook 刷新

当 Dev Toolkit 切换用户、切换时间、reset 或 restore 数据时，订阅型 Hook SHALL 刷新受影响资源。`useList`、`useGet`、`useCount`、`useTime` 和依赖当前用户的 Hook SHALL 能观察到变化。

#### Scenario: 切换用户刷新 count
- **WHEN** Dev Toolkit 将当前用户从 `alice` 切换为 `bob`
- **AND** `useCount("tasks")` 受 recordAccess.read 影响
- **THEN** Hook SHALL 刷新并显示 bob 可读记录数

#### Scenario: 固定时间刷新 useTime
- **WHEN** Dev Toolkit 固定业务时间
- **THEN** `useTime()` SHALL 刷新为固定后的日期
