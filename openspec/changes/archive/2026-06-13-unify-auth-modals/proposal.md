## Why

当前认证相关功能（登录、注册、强制改密）以独立页面形式存在（`/login`、`/register`、`/force-change-password`），用户必须跳转离开当前上下文才能完成认证操作。注册入口虽然在服务端 API 层已有 `allow_register` 控制（默认关闭），但前端始终显示注册链接，与服务端配置不同步。浏览器注册应完全移除，用户创建统一由 CLI 或管理员完成。同时 admin 面板缺少创建用户的功能，移除注册后管理员将无法通过浏览器创建用户。

## What Changes

- **BREAKING**: 移除 `packages/web/app/(auth)/` 目录下的所有独立认证页面（login、register、force-change-password）
- **BREAKING**: 移除 `serve.ts` 中对应的 `/login`、`/register`、`/force-change-password` GET 路由
- 移除所有前端"注册"链接和按钮（navbar、登录页、首页弹窗）
- 新建全局 `AuthProvider` Context，提供 `openLogin()` 和 `openChangePassword()` 方法，在 layout 层挂载
- 新建 `LoginDialog` 模态框组件，从首页 inline 弹窗逻辑提取
- 新建 `ChangePasswordDialog` 模态框组件，支持 force 模式（CLI 创建用户首次登录）和 profile 模式（用户主动改密），统一替换独立页面和个人资料页 inline 表单
- 将 navbar、app-shell、platform-shell 中的页面跳转（`router.push("/login")`）改为调用 `openLogin()` 弹窗
- 在 admin 用户管理页添加"添加用户"功能（仅需输入用户名，默认密码 `localapp`，设置 `mustChangePassword=true`）
- 新增 `POST /api/admin/users` 服务端端点支持管理员创建用户

## Capabilities

### New Capabilities
- `auth-modals`: 全局认证模态框系统 — AuthProvider Context + LoginDialog + ChangePasswordDialog，替代独立认证页面，支持全局任意位置触发登录和修改密码

### Modified Capabilities
- `user-auth`: 移除浏览器端注册场景，仅保留 CLI 注册路径（`X-Registration-Key`）；API 端点保持不变
- `home-page`: 公开首页的登录入口从页面跳转改为弹窗调用；移除"前往注册"链接
- `password-reset`: 强制改密从独立页面 `/force-change-password` 改为全局模态框；个人资料页改密从 inline 表单改为复用同一模态框
- `admin-api`: 新增 `POST /api/admin/users` 端点，管理员可创建用户（仅需用户名，密码默认 `localapp`）
- `platform-shell`: Navbar 中未登录用户的"登录"按钮从页面跳转改为调用 `openLogin()` 弹窗；移除"注册"按钮

## Impact

- **前端页面**: 移除 `packages/web/app/(auth)/` 目录（3 个页面文件）；新建 `auth-modals` 组件目录
- **前端组件**: 修改 `navbar.tsx`、`app-shell.tsx`、`platform-shell.tsx`、首页 `page.tsx`、个人资料页 `page.tsx`
- **服务端路由**: 移除 `serve.ts` 中 3 条 GET 路由；`auth.ts` 和 `admin.ts` 新增/修改端点
- **Admin 面板**: 修改 `Users.tsx` 添加用户创建功能
- **测试**: 清理 `/register` 相关 E2E 测试；更新 auth 测试适配模态框流程
