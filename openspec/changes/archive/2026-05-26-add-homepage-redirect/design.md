## Context

当前 LocalApp 的 `/` 路径没有路由处理器。用户登录成功后，登录页 JS 执行 `location.href = params.get('redirect') || '/'`，fallback 到 `/` 导致 404。

应用内触发登录的场景（`redirectToLogin()`）已经正确传递 `redirect` 参数，登录后会跳回原应用页面，不存在问题。仅当用户直接访问 `/login` 或 fallback 到 `/` 时才会遇到 404。

profile 应用已在 `/profile` 路径下完整运行，包含个人信息、应用列表、API Key、分组管理等功能。

## Goals / Non-Goals

**Goals:**
- `/` 路径返回有效响应，不再 404
- 已登录用户访问 `/` 重定向到 `/profile`
- 未登录用户访问 `/` 重定向到 `/login?redirect=/`

**Non-Goals:**
- 不创建独立的首页/着陆页
- 不修改 client SDK
- 不修改应用内的 `redirectToLogin()` 逻辑（已正确工作）
- 不修改 profile 应用本身

## Decisions

### Decision 1: 使用 302 重定向而非渲染

**选择**: `/` 直接 302 重定向到 `/profile` 或 `/login`

**替代方案**:
- 在 `/` 渲染 profile：需要处理 profile 的静态资源路径，增加复杂度
- 在 `/` 渲染一个中间页面（"正在跳转..."）：用户体验差

**理由**: profile 已有完整的服务路径（`/profile`、`/profile/assets/*`），302 重定向最简单且无副作用。

### Decision 2: 登录页 fallback 保持 `/`

**选择**: 不修改登录页 JS 的 fallback 值（保持 `'/'`）

**理由**: `/` 现在会自动重定向到 `/profile`，所以 fallback 到 `/` 等于 fallback 到 `/profile`，只是多一次 redirect。保持代码简单，不需要改登录页模板。

### Decision 3: 根路由放在 serveRoutes 中

**选择**: 在 `serve.ts` 的 serveRoutes 中添加 `app.get("/", ...)` 处理器

**理由**: 根路径属于公开路由（与 `/login`、`/register` 同类），且需要访问 session cookie 判断登录状态，serveRoutes 已有 session 解析中间件。

## Risks / Trade-offs

**[多一次 redirect]** → Mitigation: 仅 fallback 场景多一次 redirect（`/` → `/profile`），正常应用内登录流程不受影响。性能影响可忽略。
