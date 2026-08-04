## 1. 根路由实现

- [x] 1.1 在 `packages/server/src/routes/serve.ts` 的 serveRoutes 中新增 `GET /` 路由，位于 `/:userId/:name` 路由之前
- [x] 1.2 实现登录状态判断：有 visitorId → redirect `/profile`，无 visitorId → redirect `/login?redirect=/`

## 2. 测试

- [x] 2.1 编写测试：已登录用户访问 `/` → 302 到 `/profile`
- [x] 2.2 编写测试：未登录用户访问 `/` → 302 到 `/login?redirect=/`
- [x] 2.3 验证现有 `/:userId/:name` 路由不受影响
