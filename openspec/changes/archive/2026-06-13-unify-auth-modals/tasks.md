## 1. 服务端: Admin 创建用户 API

- [x] 1.1 RED: 编写 `POST /api/admin/users` 端点的集成测试（成功创建、用户名已存在 409、格式不合法 400、非 admin 403、未认证 401）
- [x] 1.2 GREEN: 在 `packages/server/src/routes/admin.ts` 中实现 `POST /api/admin/users` 端点，复用 `createUser()` 逻辑，密码默认 `localapp`，设置 `must_change_password=1`
- [x] 1.3 验证: 运行集成测试通过，确认新用户默认密码 `localapp` 且 `mustChangePassword=true`
- [x] 1.4 commit: `feat(server): 添加管理员创建用户 API 端点 POST /api/admin/users`

## 2. 前端: AuthProvider 与模态框组件

- [x] 2.1 创建 `packages/web/components/auth-modals/auth-provider.tsx`，实现 AuthProvider Context + `useAuthModals()` hook，管理 LoginDialog 和 ChangePasswordDialog 的开关状态
- [x] 2.2 创建 `packages/web/components/auth-modals/login-dialog.tsx`，从首页 `PublicHome` 中提取 inline 登录弹窗逻辑为独立组件，处理登录成功和 `MUST_CHANGE_PASSWORD` 自动弹出改密弹窗
- [x] 2.3 创建 `packages/web/components/auth-modals/change-password-dialog.tsx`，支持 force 和 profile 两种模式，分别调用 `POST /api/auth/force-change-password` 和 `PUT /api/me/password`
- [x] 2.4 在 `packages/web/app/layout.tsx` 中挂载 AuthProvider，将 LoginDialog 和 ChangePasswordDialog 作为 Provider 内部子组件渲染
- [x] 2.5 commit: `feat(web): 添加全局 AuthProvider、LoginDialog 和 ChangePasswordDialog 模态框组件`

## 3. 前端: 迁移引用点到模态框

- [x] 3.1 修改 `packages/web/app/(dashboard)/page.tsx`（PublicHome），移除 inline 登录弹窗 JSX 和 `loginOpen` 状态，改用 `useAuthModals().openLogin()`；移除"前往注册"链接
- [x] 3.2 修改 `packages/web/components/shell/navbar.tsx`，将未登录用户的"登录" Link 改为调用 `openLogin()`，移除"注册"按钮
- [x] 3.3 修改 `packages/web/components/app-shell.tsx`，将 401 时的 `router.replace("/login")` 改为 `openLogin()`
- [x] 3.4 修改 `packages/web/components/shell/platform-shell.tsx`，将未登录时的 `router.push("/login")` 改为 `openLogin()`
- [x] 3.5 修改 `packages/web/app/(dashboard)/my/info/page.tsx`（个人资料页），移除 inline 修改密码表单，改用 `useAuthModals().openChangePassword({ mode: "profile" })` 触发弹窗
- [x] 3.6 commit: `refactor(web): 迁移所有认证入口为全局模态框调用`

## 4. 前端: 移除独立认证页面和路由

- [x] 4.1 删除 `packages/web/app/(auth)/register/page.tsx`
- [x] 4.2 删除 `packages/web/app/(auth)/login/page.tsx`
- [x] 4.3 删除 `packages/web/app/(auth)/force-change-password/page.tsx`
- [x] 4.4 移除 `packages/server/src/routes/serve.ts` 中的 `app.get("/login")`、`app.get("/register")`、`app.get("/force-change-password")` 三条路由
- [x] 4.5 commit: `refactor(web): 移除独立认证页面和 serve.ts 认证路由`

## 5. Admin 面板: 添加用户功能

- [x] 5.1 RED: 编写 `POST /api/admin/users` 的 admin 前端 API 调用函数
- [x] 5.2 GREEN: 在 `packages/admin/src/pages/Users.tsx` 中添加"添加用户"按钮和弹窗（仅输入用户名），提交后调用 API 并刷新列表
- [x] 5.3 验证: 手动测试管理员添加用户、用户名已存在错误提示、新用户状态显示"待改密"
- [x] 5.4 commit: `feat(admin): 添加管理员创建用户功能到用户管理页面`

## 6. 服务端: 简化注册端点

- [x] 6.1 修改 `packages/server/src/routes/auth.ts`，将无 `X-Registration-Key` 头的浏览器注册统一返回 403（移除 `allow_register` 配置检查，始终拒绝）
- [x] 6.2 更新 `packages/server/src/lib/config.ts` 中 `allowRegister` 的默认值为 `false` 并标注为 deprecated
- [x] 6.3 更新 `packages/server/tests/integration/register-control.test.ts` 中浏览器注册相关测试用例，验证始终返回 403
- [x] 6.4 commit: `refactor(server): 简化注册端点，浏览器注册始终拒绝`

## 7. 清理测试

- [x] 7.1 移除 `packages/server/tests/e2e-ui/auth.test.ts` 中 `/register` 页面相关的 E2E 测试
- [x] 7.2 更新 `/force-change-password` 相关测试适配模态框流程
- [x] 7.3 运行全部测试确认无回归
- [x] 7.4 commit: `test: 清理认证相关测试，移除注册 E2E 用例`
