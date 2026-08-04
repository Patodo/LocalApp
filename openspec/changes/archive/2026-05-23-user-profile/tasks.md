## 1. 数据库层 — Migration 与数据访问

- [x] 1.1 在 `meta-sqlite.ts` 中添加 migration：检测并添加 `display_name`、`avatar_url`、`bio` 列到 `users` 表
- [x] 1.2 在 `meta-sqlite.ts` 中添加 `updateUserProfile(id, displayName, bio)` 函数
- [x] 1.3 在 `meta-sqlite.ts` 中添加 `updateUserPassword(id, passwordHash)` 函数
- [x] 1.4 在 `meta-sqlite.ts` 中添加 `updateUserAvatar(id, avatarUrl)` 函数
- [x] 1.5 扩展 `UserRecord` 接口，增加 `displayName`、`avatarUrl`、`bio` 字段
- [x] 1.6 编写 migration 的单元测试（验证列存在时跳过、不存在时添加）

## 2. 后端 API — Profile 端点

- [x] 2.1 创建 `routes/profile.ts`，注册到 `index.ts`（在 session 插件之后）
- [x] 2.2 实现 `PUT /api/me/profile` — 修改昵称和简介，验证 displayName 长度 1-32
- [x] 2.3 实现 `PUT /api/me/password` — 验证旧密码、新密码≥6位、检查 provider 排除 system 用户
- [x] 2.4 实现 `POST /api/me/avatar` — multipart 上传、2MB 限制、jpg/png/webp 格式校验、存储到 `{DATA_DIR}/avatars/`
- [x] 2.5 实现 `GET /api/me/avatar` — 返回当前用户头像文件流
- [x] 2.6 实现 `GET /api/avatar/:userId` — 公开头像访问（无需认证）
- [x] 2.7 所有 profile 端点要求 session cookie 认证（拒绝仅 API Key 的请求）

## 3. 后端 — 扩展现有端点

- [x] 3.1 扩展 `GET /api/me` 返回值，增加 `displayName`、`avatarUrl`、`bio` 字段
- [x] 3.2 修改 `admin-serve.ts` 中 `__USER__` 注入，增加 `avatarUrl`、`displayName` 字段

## 4. 后端 — Profile 页面服务

- [x] 4.1 在 `admin-serve.ts` 中添加 `/profile` 路由：检查登录状态、未登录重定向到 login
- [x] 4.2 在 `admin-serve.ts` 中添加 `/profile/assets/*` 静态文件服务

## 5. 前端 — Profile SPA 脚手架

- [x] 5.1 创建 `packages/profile/` 包：package.json、vite.config.ts、tsconfig.json、tailwind.config.js、postcss.config.js
- [x] 5.2 配置 vite build 输出到 `packages/server/static/profile/`，base 路径为 `/profile/`
- [x] 5.3 创建入口文件：`src/main.tsx`、`src/App.tsx`、`src/index.css`（Tailwind）
- [x] 5.4 创建 API 客户端：`src/api/me.ts`（封装 fetch 调用）

## 6. 前端 — Profile 页面实现

- [x] 6.1 创建 `Profile.tsx` 页面：头像区域（可点击上传）、用户名/角色只读、昵称/简介可编辑
- [x] 6.2 实现头像上传交互：点击选择文件、预览、调用 `POST /api/me/avatar`
- [x] 6.3 实现昵称/简介编辑：表单输入、调用 `PUT /api/me/profile`
- [x] 6.4 实现密码修改区域：当前密码 + 新密码 + 确认密码、调用 `PUT /api/me/password`
- [x] 6.5 实现默认头像：用户无头像时显示用户名首字母占位
- [x] 6.6 添加操作反馈：成功/错误提示信息

## 7. 前端 — Admin Panel 适配

- [x] 7.1 修改 `packages/admin/src/components/Layout.tsx`：底部用户区域增加头像展示和"个人资料"链接

## 8. 前端 — 用户页面导航栏改造

- [x] 8.1 修改 `serve.ts` 中 `buildPlatformShell` 函数：已登录用户显示头像（或占位符）+ 用户名，链接到 `/profile`

## 9. 类型定义

- [x] 9.1 更新 `packages/server/src/types/models.ts` 中 `User` 接口，增加 `displayName`、`avatarUrl`、`bio`
- [x] 9.2 更新 `packages/server/src/types/api.ts` 中 `MeResponse` 和 `AuthResponse` 类型
- [x] 9.3 更新 `packages/client` 的 `User` 类型定义（如有）

## 10. E2E 测试（HTTP 级）

- [x] 10.1 编写 `tests/e2e/profile.test.ts`：测试 `PUT /api/me/profile` 成功/失败场景
- [x] 10.2 测试 `PUT /api/me/password` 成功/旧密码错误/新密码过短/OAuth 用户拒绝场景
- [x] 10.3 测试 `POST /api/me/avatar` 成功上传/文件过大/格式不支持/替换旧头像
- [x] 10.4 测试 `GET /api/me/avatar` 有头像/无头像场景
- [x] 10.5 测试 `GET /api/avatar/:userId` 公开访问
- [x] 10.6 测试 `GET /api/me` 返回新字段
- [x] 10.7 测试未登录访问 Profile 端点返回 401

## 11. Playwright 测试基础设施

- [x] 11.1 安装 `@playwright/test` 依赖到项目根目录，运行 `npx playwright install chromium`
- [x] 11.2 创建 `playwright.config.ts`：配置 Chromium、baseURL、webServer 自动启动、测试目录 `packages/server/tests/e2e-ui/`
- [x] 11.3 创建 `tests/e2e-ui/helpers.ts`：封装启动 server、注册用户、登录获取 session 的 helper 函数
- [x] 11.4 在 `package.json` 中添加 `test:e2e-ui` 脚本命令

## 12. E2E UI 测试 — Profile SPA

- [x] 12.1 编写 `tests/e2e-ui/profile.test.ts`：登录后访问 `/profile`，验证页面元素（用户名、角色、昵称、简介）
- [x] 12.2 测试编辑昵称和简介：修改 → 保存 → 验证成功提示 → 刷新后值保留
- [x] 12.3 测试上传头像：选择文件 → 上传 → 验证头像区域更新
- [x] 12.4 测试修改密码：填写当前密码和新密码 → 提交 → 验证成功提示
- [x] 12.5 测试未登录访问 `/profile`：验证重定向到登录页面

## 13. E2E UI 测试 — 登录/注册页面

- [x] 13.1 编写 `tests/e2e-ui/auth.test.ts`：测试注册新用户流程（填写表单 → 提交 → 跳转登录页）
- [x] 13.2 测试登录成功流程（填写表单 → 提交 → 跳转目标页）
- [x] 13.3 测试登录失败显示错误提示
