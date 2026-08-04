## Context

当前用户登录后只能通过 `/profile` SPA 修改个人资料。应用管理（查看列表、删除应用）和 API Key 管理（查看完整 Key、创建新 Key）只能通过 CLI 完成。

已有的可复用基础设施：
- Profile SPA（React + Vite + Tailwind）已部署在 `/profile`，通过 `window.__USER__` 注入用户身份
- `GET /api/keys` 返回当前用户的 Key 列表（仅含 keyPrefix）
- `GET /api/pages` 返回当前用户的应用列表
- `DELETE /api/pages/:name` 可删除应用
- `POST /api/keys` 可创建 Key（当前无认证保护，任何已认证用户可为任意 userId 创建）

缺少的部分：
- Tab 布局的 UI 框架（当前 Profile 是单页面无路由）
- `GET /api/keys` 返回完整 Key（当前仅返回前缀）
- `DELETE /api/keys/:keyPrefix` 端点及对应的 `deleteApiKey()` 数据库函数

## Goals / Non-Goals

**Goals:**
- 将 `/profile` 从单页资料编辑器扩展为带 Tab 切换的用户面板
- 用户可在浏览器中查看自己的应用列表并删除应用
- 用户可在浏览器中查看完整 API Key、创建新 Key、复制到剪贴板
- 后端 `GET /api/keys` 返回完整 Key 字符串

**Non-Goals:**
- 不提供浏览器端的创建应用功能（仅 CLI）
- 不提供浏览器端的上传/部署功能（仅 CLI）
- 不提供应用内数据管理或 Schema 编辑
- 不引入客户端路由库（用 Tab 组件状态切换代替 URL 路由）

## Decisions

### 1. Tab 状态切换而非 react-router

**选择**：使用组件内 state 管理当前激活的 Tab，不引入 react-router。

**替代方案**：使用 react-router 实现 `/profile/apps`、`/profile/keys` 等子路由。

**理由**：当前服务端对 `/profile` 的处理是精确匹配（`GET /profile` 返回 SPA，`GET /profile/assets/*` 返回静态资源），没有 SPA fallback 机制处理 `/profile/*` 子路由。引入路由库需要同时修改服务端，增加复杂度。Tab 切换对三个页面（资料、应用、Key）的场景足够，且与 Admin Panel 的侧边栏导航模式一致。

### 2. 修改 GET /api/keys 返回完整 Key

**选择**：修改 `listApiKeysByUser()` 查询，返回完整 `key` 字段而非仅 `keyPrefix`。

**替代方案**：新增 `GET /api/keys/full` 端点专门返回完整 Key。

**理由**：用户需要在前端看到完整 Key 以复制到 CLI 进行登录。API Key 不是密码——它是程序化访问凭证，用户创建后就应该能看到完整值。增加单独端点只会增加维护成本，且当前 `GET /api/keys` 已有认证保护（只返回当前用户的 Key），安全性由认证层保证。

### 3. 不新增 DELETE /api/keys 端点

**选择**：本次变更不实现 API Key 删除功能。

**理由**：提案未要求删除 Key。用户的 Key 数量通常很少（1-3 个），删除场景优先级低。如果未来需要可通过 CLI 或新增端点实现，不影响当前设计。

### 4. Profile SPA 构建目标不变

**选择**：继续将 Profile SPA 构建到 `packages/server/static/profile/`，由 `admin-serve.ts` 在 `/profile` 路由下提供。

**理由**：沿用现有构建和部署流程，无需修改 Vite 配置或服务端静态文件服务逻辑。

## Risks / Trade-offs

- **完整 Key 暴露风险** → 缓解：`GET /api/keys` 需要认证，只返回当前用户的 Key；前端在复制操作后可建议用户妥善保管
- **Tab 切换无 URL 状态** → 缓解：三个 Tab 足够简单，用户不需要通过 URL 分享特定 Tab；刷新后回到默认的资料 Tab 是可接受的行为
- **SPA 无 fallback 限制扩展性** → 如果未来 Tab 数量增加（超过 5 个），应考虑引入路由库和 SPA fallback；当前三个 Tab 不需要
