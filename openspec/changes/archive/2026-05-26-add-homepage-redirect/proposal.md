## Why

用户登录成功后，前端 JS 将页面跳转到 `redirect` 参数或 fallback 到 `/`，但 `/` 路径没有路由处理器，返回 404。需要为根路径提供有效内容，并确保登录后的重定向行为正确。

## What Changes

- 新增 `GET /` 路由：已登录用户重定向到 `/profile`，未登录用户重定向到 `/login?redirect=/`
- 登录页和强制改密页的 fallback 从 `/` 改为 `/profile`（可选，因为 `/` 本身会重定向）

## Capabilities

### New Capabilities

- `homepage-redirect`: 根路径 `/` 的路由处理，根据登录状态重定向到 profile 或 login

### Modified Capabilities

- `page-serving`: 新增根路径 `/` 的路由匹配，现有 `/:userId/:name` 路由不受影响

## Impact

- **Server**: `packages/server/src/routes/serve.ts` 新增根路由处理器
- **Server**: 登录页和改密页的 JS fallback 路径（可选修改）
- **无前端影响**: 无需修改 client SDK 或 init-repo
- **无破坏性变更**: 现有路由不受影响
