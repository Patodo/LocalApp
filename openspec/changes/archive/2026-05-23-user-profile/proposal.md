## Why

当前 LocalApp 的用户系统仅有注册、登录、登出功能，用户创建后无法修改任何个人信息。没有个人资料页面，无法设置昵称、头像、简介，也无法修改密码。所有用户（包括管理员和普通用户）都缺乏自助管理身份信息的能力。

## What Changes

- **扩展 users 表**：在 `meta.sqlite` 的 `users` 表新增 `display_name`、`avatar_url`、`bio` 三个可选字段
- **新增个人资料 API**：`PUT /api/me/profile`（修改昵称/简介）、`PUT /api/me/password`（修改密码）、`POST /api/me/avatar`（上传头像）、`GET /api/me/avatar`（获取头像）
- **扩展 `/api/me` 返回值**：增加 `displayName`、`avatarUrl`、`bio` 字段
- **新增独立 Profile SPA**：在 `packages/profile/` 创建 React SPA，所有已登录用户可通过 `/profile` 访问
- **改造导航栏**：用户页面顶部导航栏和 Admin 侧边栏增加头像展示和 Profile 入口
- **头像存储**：上传的头像文件存储在 `{DATA_DIR}/avatars/` 目录
- **引入 Playwright**：新增 Playwright 测试框架，支撑 UI 自动化测试，本次用于测试 Profile SPA 和登录/注册页面

## Capabilities

### New Capabilities
- `user-profile-api`: 用户个人资料 API — 密码修改、昵称/简介编辑、头像上传与访问
- `user-profile-ui`: 个人资料前端页面 — 独立 Profile SPA，所有已登录用户可访问
- `e2e-ui-testing`: Playwright UI 自动化测试框架 — 项目级基础设施，支持浏览器端到端测试

### Modified Capabilities
- `user-auth`: `/api/me` 返回值扩展，增加 displayName、avatarUrl、bio 字段
- `page-serving`: 用户页面导航栏增加头像展示和 Profile 链接入口
- `admin-panel`: Admin 侧边栏底部增加"个人资料"链接，跳转到 `/profile`

## Impact

- **后端 API**：新增 `routes/profile.ts`（4 个端点），修改 `routes/auth.ts`（扩展 /api/me），修改 `lib/meta-sqlite.ts`（migration + updateUserProfile）
- **前端**：新增 `packages/profile/` 包（React + Vite + Tailwind），修改 `packages/admin/`（Layout 加链接），修改 `routes/serve.ts`（导航栏改造）
- **存储**：新增 `{DATA_DIR}/avatars/` 目录用于头像文件存储
- **数据库**：`meta.sqlite` 的 `users` 表新增 3 列（向后兼容，使用 ALTER TABLE + 存在性检测）
- **依赖**：新增 `@playwright/test` 开发依赖；头像上传复用已有的 `@fastify/multipart`
- **测试基础设施**：新增 Playwright 配置和测试脚手架，支持启动 server → 打开浏览器 → 执行 UI 测试的完整流程
