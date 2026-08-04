## Why

普通用户登录后，在浏览器里只能修改个人资料（/profile），无法查看自己的应用列表、管理 API Key 或删除应用。当前这些操作只能通过 CLI 完成。对于不熟悉命令行的用户，缺少一个可视化的管理入口。需要扩展现有的 Profile SPA，加入应用管理和 API Key 管理功能，让用户在浏览器里就能完成日常管理操作。

## What Changes

- 扩展 `/profile` SPA，从单一资料页改为带 Tab 切换的用户面板，新增"我的应用"和"API Key"两个 Tab
- "我的应用" Tab：展示当前用户的应用列表（名称、版本、更新时间、访问级别），支持删除应用，点击应用可展开查看 Schema 列表和版本历史
- "API Key" Tab：展示当前用户的 API Key 列表（含完整 Key），支持创建新 Key，提供复制到剪贴板功能
- 后端修改：`GET /api/keys` 返回完整 Key（当前只返回前缀），用户需要在前端看到完整 Key 以粘贴到 CLI 进行登录
- 创建应用、上传部署仍仅支持 CLI，浏览器不提供这些功能

## Capabilities

### New Capabilities
- `user-dashboard-ui`: 用户面板 UI — Tab 布局的 /profile 页面扩展，包含应用列表、API Key 管理、个人资料三个 Tab

### Modified Capabilities
- `api-key-auth`: GET /api/keys 需要返回完整 Key（不只是前缀），以便用户在前端复制用于 CLI 登录

## Impact

- **packages/profile/**: Profile SPA 扩展（新增 Apps.tsx、ApiKeys.tsx 页面组件和 API 客户端）
- **packages/server/src/routes/keys.ts**: 修改 POST /api/keys 支持 session 认证用户为自己创建 Key；GET /api/keys 通过 meta-sqlite 返回完整 key
- **packages/server/src/lib/meta-sqlite.ts**: 修改 listApiKeysByUser 查询，返回完整 key 字段
- **packages/server/src/plugins/auth.ts**: authPlugin 支持 session cookie 认证 fallback；version check 跳过 session 认证请求
- **packages/server/tests/e2e/keys.test.ts**: 更新测试以验证完整 Key 返回和 session 认证创建
- **packages/server/tests/e2e-ui/profile.test.ts**: 新增应用管理和 API Key 管理的 Playwright 测试
