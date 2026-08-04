## 1. 后端修改

- [x] 1.1 修改 `listApiKeysByUser()` 查询，返回完整 `key` 字段（而非 keyPrefix）
- [x] 1.2 修改 `GET /api/keys` 路由，返回完整 key 字段给前端
- [x] 1.3 修改 `POST /api/keys` 路由，支持 session 认证用户为自己创建 Key（无 userId 时使用当前用户 ID）
- [x] 1.4 更新 `packages/server/tests/e2e/keys.test.ts`，验证 GET /api/keys 返回完整 Key

## 2. Profile SPA 重构

- [x] 2.1 创建 `packages/profile/src/components/TabLayout.tsx` — Tab 栏组件，支持三个 Tab 切换
- [x] 2.2 重构 `packages/profile/src/App.tsx` — 引入 TabLayout，将 Profile 页面作为默认 Tab 内容
- [x] 2.3 创建 `packages/profile/src/api/pages.ts` — 应用列表和删除的 API 客户端（GET /api/pages, DELETE /api/pages/:name, GET /api/pages/:name）
- [x] 2.4 创建 `packages/profile/src/api/keys.ts` — API Key 列表和创建的客户端（GET /api/keys, POST /api/keys）

## 3. 我的应用 Tab

- [x] 3.1 创建 `packages/profile/src/pages/Apps.tsx` — 应用列表页面，显示应用卡片（名称、版本、更新时间）
- [x] 3.2 实现应用详情展开/收起功能（调用 GET /api/pages/:name 获取详情）
- [x] 3.3 实现应用删除功能（确认对话框 + DELETE /api/pages/:name）
- [x] 3.4 实现空状态提示（无应用时引导用户使用 CLI）

## 4. API Key Tab

- [x] 4.1 创建 `packages/profile/src/pages/ApiKeys.tsx` — Key 列表页面，显示完整 Key 和创建时间
- [x] 4.2 实现复制到剪贴板功能（navigator.clipboard.writeText + 成功提示）
- [x] 4.3 实现创建新 Key 功能（POST /api/keys + 列表刷新）
- [x] 4.4 实现空状态提示（无 Key 时显示创建引导）

## 5. 构建与测试

- [x] 5.1 构建 Profile SPA 并部署到 `packages/server/static/profile/`
- [x] 5.2 新增 `packages/server/tests/e2e-ui/profile.test.ts` Playwright 测试 — Tab 切换、应用列表、应用删除、Key 列表、Key 创建、Key 复制
