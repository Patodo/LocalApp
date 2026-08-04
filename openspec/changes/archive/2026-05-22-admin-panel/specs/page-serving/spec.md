## MODIFIED Requirements

### Requirement: 路由优先级处理
`/admin` 路径 SHALL 不被 `/:userId/:name` 动态路由捕获。

#### Scenario: /admin 不匹配用户页面路由
- **WHEN** 请求 `GET /admin` 或 `GET /admin/*`
- **THEN** 由 admin-serve 路由处理，不进入 `/:userId/:name` 的 Shell 渲染逻辑
